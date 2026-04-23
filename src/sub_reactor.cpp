#include "sub_reactor.h"
#include "http.h"
#include "http_codec.h"
#include "logger.h"
#include "message.pb.h"
#include "mysql_pool.h"
#include "protobuf_codec.h"
#include "redis_pool.h"
#include "utils.h"
#include "websocket_codec.h"
#include <fcntl.h>
#include <json.hpp>
#include <netinet/in.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <openssl/evp.h>
#include <openssl/sha.h>
#include <optional>
#include <sys/epoll.h>
#include <sys/sendfile.h>
#include <sys/socket.h>
#include <sys/stat.h>
using namespace std;
using json = nlohmann::json;

Reactor::Reactor(int index, vector<unique_ptr<Reactor>> &sub_reactors, size_t num_memory) : m_index(index), m_sub_reactors(sub_reactors), m_timer_heap(index), m_conn_pool(num_memory) {
    m_epollfd = epoll_create1(0);
    m_conn_notifyfd = eventfd(0, EFD_NONBLOCK);
    m_broadcast_notifyfd = eventfd(0, EFD_NONBLOCK);
    addfd(m_conn_notifyfd);
    addfd(m_broadcast_notifyfd);
    m_thread = thread(&Reactor::loop, this);
}

Reactor::~Reactor() {
    if (m_running) {
        shutDown();
    }
}

void Reactor::shutDown() {
    m_running = false;
    conn_notify();
    if (m_thread.joinable()) {
        m_thread.join();
    }
    for (auto &[fd, conn] : m_conns) {
        close(fd);
    }
    close(m_epollfd);
    close(m_conn_notifyfd);
}

void Reactor::addConnection(int fd, ProtocolType protocol) {
    {
        lock_guard<mutex> lock(m_queue_mutex);
        m_conn_queue.emplace(fd, protocol);
    }
    conn_notify();
}

void Reactor::enqueueBroadcast(shared_ptr<const string> frame) {
    {
        lock_guard<mutex> lock(m_broadcast_mutex);
        m_broadcast_queue.emplace(frame);
    }
    broadcast_notify();
}

void Reactor::loop() {
    size_t maxevents = 1024;
    epoll_event events[maxevents];
    while (m_running) {
        int number = epoll_wait(m_epollfd, events, maxevents, m_timer_heap.getNextTimeout());
        if (number < 0) {
            if (errno == EINTR && m_running == false) {
                LOG_INFO("reactor[%d]server stopped by signal SIGINT or SIGTERM", m_index);
            } else {
                LOG_ERROR("epoll_wait failed");
            }
            continue;
        } else if (number == 0) {
            m_timer_heap.tick();
            for (auto fd : m_timer_heap.getExpired()) {
                LOG_DEBUG("close inactive connection, fd = %d", fd);
                closeNow(fd);
            }
            continue;
        }

        for (int i = 0; i < number; i++) {
            int fd = events[i].data.fd;
            LOG_DEBUG("reactor[%d], event fd = %d", m_index, fd);
            if (fd == m_conn_notifyfd) {
                uint64_t val;
                read(m_conn_notifyfd, &val, sizeof(val));

                if (!m_running) {
                    LOG_INFO("reactor[%d] close", m_index);
                    return;
                }

                queue<pair<int, ProtocolType>> conn_queue;
                {
                    lock_guard<mutex> lock(m_queue_mutex);
                    conn_queue.swap(m_conn_queue);
                }
                while (!conn_queue.empty()) {
                    auto [conn_fd, protocol] = conn_queue.front();
                    conn_queue.pop();

                    LOG_DEBUG("fd = %d assigned to reactor[%d]", conn_fd, m_index);

                    unique_ptr<Connection, ConnDeleter> conn_ptr = m_conn_pool.create();
                    conn_ptr->fd = conn_fd;
                    conn_ptr->protocol = protocol;
                    m_conns.emplace(conn_fd, move(conn_ptr));
                    addfd(conn_fd);
                    m_timer_heap.add(conn_fd, 6000);
                }
            } else if (fd == m_broadcast_notifyfd) {
                uint64_t val;
                read(m_broadcast_notifyfd, &val, sizeof(val));

                queue<shared_ptr<const string>> broadcast_queue;
                {
                    lock_guard<mutex> lock(m_broadcast_mutex);
                    broadcast_queue.swap(m_broadcast_queue);
                }
                LOG_DEBUG("reactor[%d] start to broadcast", m_index);
                while (!broadcast_queue.empty()) {
                    const auto &frame = *broadcast_queue.front();
                    for (auto it = m_conns.begin(); it != m_conns.end();) {
                        auto current = it++;
                        if (current->second->protocol != PROTO_WEBSOCKET) continue;
                        LOG_DEBUG("reactor[%d] broadcast frame size = %zu to fd = %d",
                                  m_index,
                                  frame.size(),
                                  current->second->fd);
                        current->second->outbuf += frame;
                        trySend(*current->second);
                    }
                    broadcast_queue.pop();
                }
            } else if (events[i].events & EPOLLIN) {
                if (!m_conns.contains(fd)) continue;

                if (m_conns[fd]->protocol == PROTO_WEBSOCKET) {
                    m_timer_heap.update(fd, 60000);
                } else {
                    m_timer_heap.update(fd, 6000);
                }

                const int buf_size = 4096;
                char buf[buf_size];
                while (true) {
                    int n = recv(fd, buf, buf_size, 0);
                    if (n > 0) {
                        m_conns[fd]->inbuf.append(buf, n);
                    } else if (n == 0) {
                        LOG_DEBUG("client closed writing, fd = %d", fd);
                        m_conns[fd]->readClosed = true;
                        process(*m_conns[fd]);
                        break;
                    } else {
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            process(*m_conns[fd]);
                            break;
                        } else {
                            LOG_DEBUG("read failed");
                            closeNow(fd);
                            break;
                        }
                    }
                }
            } else if (events[i].events & EPOLLOUT) {
                if (!m_conns.contains(fd)) continue;

                trySend(*m_conns[fd]);
                if (!m_conns.contains(fd)) continue;
                if (!m_conns[fd]->inbuf.empty() && m_conns[fd]->outbuf.empty() && m_conns[fd]->file_offset == m_conns[fd]->file_size) {
                    process(*m_conns[fd]);
                }
            } else {
                LOG_DEBUG("something else happened");
            }
        }
    }
}

void Reactor::process(Connection &conn) {
    FrameResult res;
    while ((res = checkFrame(conn)).status == FrameStatus::Complete) {
        bool should_broadcast = false;
        string broadcast_frame;

        LOG_DEBUG("fd = %d send data : %.*s",
                  conn.fd,
                  static_cast<int>(conn.inbuf.size()),
                  conn.inbuf.c_str());

        if (conn.protocol == PROTO_HTTP) {
            HttpRequest req;
            ParseState ret = parseHttpRequest(conn.inbuf, req);
            conn.outbuf.reserve(conn.outbuf.size() + 256);

            LOG_DEBUG("request is HTTP and method is %s, target is %s, version is %s",
                      req.method.c_str(),
                      req.target.c_str(),
                      req.version.c_str());

            if (ret == PARSE_ERROR) {
                LOG_DEBUG("HTTP parse failed, fd = %d", conn.fd);
                sendError(conn, resp_bad_request);
                return;
            } else if (req.is_websocket) {
                string websocket_accept;
                websocket_accept.reserve(64);
                websocket_accept = move(req.sec_websocket_key);
                websocket_accept += websocket_magic;

                unsigned char hash[SHA_DIGEST_LENGTH];
                SHA1(reinterpret_cast<const unsigned char *>(websocket_accept.data()), websocket_accept.size(), hash);

                BIO *b64 = BIO_new(BIO_f_base64());
                BIO *mem = BIO_new(BIO_s_mem());
                b64 = BIO_push(b64, mem);
                BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
                BIO_write(b64, hash, SHA_DIGEST_LENGTH);
                BIO_flush(b64);

                BUF_MEM *buf;
                BIO_get_mem_ptr(b64, &buf);
                string accept(buf->data, buf->length);
                LOG_DEBUG("websocket accpet size: %zu, accept = %s", accept.size(), accept.c_str());
                BIO_free_all(b64);

                SessionResult ret = get_session(req, conn.username);
                if (ret == SessionResult::Success) {
                    conn.protocol = PROTO_WEBSOCKET;
                    m_timer_heap.update(conn.fd, 60000);
                    conn.outbuf += "HTTP/1.1 101 Switching Protocols\r\n";
                    conn.outbuf += "Upgrade: websocket\r\n";
                    conn.outbuf += "Connection: Upgrade\r\n";
                    conn.outbuf += "Sec-WebSocket-Accept: ";
                    conn.outbuf += move(accept);
                    conn.outbuf += "\r\n\r\n";
                } else if (ret == SessionResult::TokenExpired) {
                    conn.outbuf += resp_unauthorized;
                } else if (ret == SessionResult::InvalidRequest) {
                    sendError(conn, resp_bad_request);
                    return;
                } else if (ret == SessionResult::ServerError) {
                    conn.outbuf += resp_server_error;
                }
            } else if (req.target == "/echo") {
                conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Length: ";
                conn.outbuf += to_string(req.body.size());
                conn.outbuf += "\r\n\r\n";
                conn.outbuf += req.body;
            } else if (req.target == "/me") {
                SessionResult ret = get_session(req, conn.username);
                if (ret == SessionResult::Success) {
                    json out;
                    out["nickname"] = conn.username;
                    string body = out.dump();
                    conn.outbuf += "HTTP/1.1 200 OK\r\n";
                    conn.outbuf += "Content-Type: application/json\r\n";
                    conn.outbuf += "Content-Length: ";
                    conn.outbuf += to_string(body.size());
                    conn.outbuf += "\r\n\r\n";
                    conn.outbuf += body;
                } else if (ret == SessionResult::TokenExpired) {
                    conn.outbuf += resp_unauthorized;
                } else if (ret == SessionResult::InvalidRequest) {
                    sendError(conn, resp_bad_request);
                    return;
                } else if (ret == SessionResult::ServerError) {
                    conn.outbuf += resp_server_error;
                }
            } else if (req.method == "GET") {
                string file_path = "static" + req.target;
                if (req.target == "/" || req.target == "/login" || req.target == "/register" || req.target == "/chat") {
                    file_path = "static/index.html";
                }
                LOG_DEBUG("file path is %s", file_path.c_str());
                int file_fd = open(file_path.c_str(), O_RDONLY);
                if (file_fd == -1) {
                    conn.outbuf += resp_not_found;
                } else {
                    struct stat st;
                    fstat(file_fd, &st);
                    size_t file_size = st.st_size;
                    conn.file_fd = file_fd;
                    conn.file_size = file_size;

                    conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Type: ";
                    conn.outbuf += getMimeType(file_path);
                    conn.outbuf += "\r\nContent-Length: ";
                    conn.outbuf += to_string(file_size);
                    conn.outbuf += "\r\n\r\n";
                }
            } else if (req.target == "/register" || req.target == "/login") {
                LOG_DEBUG("HTTP request register or login");

                static constexpr string_view username_key = "username=";
                size_t username_value_pos = req.body.find(username_key);

                static constexpr string_view password_key = "password=";
                size_t password_value_pos = req.body.find(password_key);

                if (username_value_pos == string::npos || password_value_pos == string::npos) {
                    LOG_DEBUG("register request not have username or password");
                    conn.outbuf += resp_missing_params;
                } else {
                    size_t username_start = username_value_pos + username_key.size();
                    size_t username_end = req.body.find("&", username_start);
                    optional<string> username_result = url_decode(req.body.substr(username_start, username_end - username_start));

                    size_t password_start = password_value_pos + password_key.size();
                    size_t password_end = req.body.find("&", password_start);
                    optional<string> password_result = url_decode(req.body.substr(password_start, password_end - password_start));
                    if (!username_result.has_value() || !password_result.has_value()) {
                        sendError(conn, resp_invalid_encode, res.end_pos);
                        return;
                    }
                    if (!is_valid_username(username_result.value())) {
                        sendError(conn, resp_invalid_username, res.end_pos);
                        return;
                    }
                    if (!is_valid_password(password_result.value())) {
                        sendError(conn, resp_invalid_password, res.end_pos);
                        return;
                    }

                    string &username = username_result.value();
                    string &password = password_result.value();
                    if (req.target == "/register") {
                        RegisterResult ret = do_register(username, password);

                        if (ret == RegisterResult::Success) {
                            string token;
                            SessionResult ret = create_session(username, token);
                            if (ret == SessionResult::Success) {
                                conn.outbuf += resp_header_register_success;
                                conn.outbuf += "Set-Cookie: session_id=";
                                conn.outbuf += token;
                                conn.outbuf += "\r\n\r\nregister success";
                            } else if (ret == SessionResult::ServerError) {
                                conn.outbuf += resp_server_error;
                            }
                        } else if (ret == RegisterResult::ServerError) {
                            conn.outbuf += resp_server_error;
                        } else if (ret == RegisterResult::UserExists) {
                            conn.outbuf += resp_user_exists;
                        }
                    } else {
                        LoginResult ret = do_login(username, password);

                        if (ret == LoginResult::Success) {
                            string token;
                            SessionResult ret = create_session(username, token);
                            if (ret == SessionResult::Success) {
                                conn.outbuf += resp_header_login_success;
                                conn.outbuf += "Set-Cookie: session_id=";
                                conn.outbuf += token;
                                conn.outbuf += "\r\n\r\nlogin success";
                            } else if (ret == SessionResult::ServerError) {
                                conn.outbuf += resp_server_error;
                            }
                        } else if (ret == LoginResult::ServerError) {
                            conn.outbuf += resp_server_error;
                        } else if (ret == LoginResult::UserNotFound) {
                            conn.outbuf += resp_user_not_found;
                        } else if (ret == LoginResult::WrongPassword) {
                            conn.outbuf += resp_wrong_password;
                        }
                    }
                }
            } else {
                conn.outbuf += default_response;
            }

            if (req.version == "HTTP/1.0" || req.connection == "close") {
                conn.keepAlive = false;
            }
        } else if (conn.protocol == PROTO_BINARY) {
            ProtobufRequest req;
            MessageType ret = parseProtobufMessage(conn.inbuf, req);
            conn.outbuf.reserve(conn.outbuf.size() + 256);

            LOG_DEBUG("parsed data: %u %u usernamne=%s password=%s",
                      static_cast<unsigned int>(req.msg_type),
                      static_cast<unsigned int>(req.msg_length),
                      req.username.c_str(),
                      req.password.c_str());

            enum ResponseKind {
                REGISTER,
                LOGIN,
                CHAT,
                ERROR
            };

            auto buildResponse = [&conn](ResponseKind kind, const string &msg, const string &sender_name = "") {
                string data;
                MessageType type;

                if (kind == REGISTER) {
                    RegisterResponse resp;
                    resp.set_msg(msg);
                    resp.SerializeToString(&data);
                    type = MSG_REGISTER_RESP;
                } else if (kind == LOGIN) {
                    LoginResponse resp;
                    resp.set_msg(msg);
                    resp.SerializeToString(&data);
                    type = MSG_LOGIN_RESP;
                } else if (kind == CHAT) {
                    ChatMessage chat_msg;
                    chat_msg.set_sender_name(sender_name);
                    chat_msg.set_msg(msg);
                    chat_msg.SerializeToString(&data);
                    type = MSG_CHAT_MSG;
                } else {
                    ErrorResponse resp;
                    resp.set_msg(msg);
                    resp.SerializeToString(&data);
                    type = MSG_ERROR;
                }

                uint32_t msg_type = static_cast<uint32_t>(type);
                uint32_t msg_length = static_cast<uint32_t>(data.size());

                conn.outbuf.append(reinterpret_cast<char *>(&msg_type), 4);
                conn.outbuf.append(reinterpret_cast<char *>(&msg_length), 4);
                conn.outbuf.append(data);
            };

            if (ret == MSG_ERROR) {
                LOG_DEBUG("protobuf parse failed, fd = %d", conn.fd);
                buildResponse(ERROR, "parse error");
            } else if (ret == MSG_REGISTER_REQ) {
                RegisterResult ret = do_register(req.username, req.password);
                if (ret == RegisterResult::Success) {
                    buildResponse(REGISTER, "register success");
                } else {
                    buildResponse(ERROR, "register failed");
                }
            } else if (ret == MSG_LOGIN_REQ) {
                LoginResult ret = do_login(req.username, req.password);
                if (ret == LoginResult::Success) {
                    buildResponse(LOGIN, "login success");
                } else {
                    buildResponse(ERROR, "login failed");
                }
            } else if (ret == MSG_CHAT_MSG) {
                buildResponse(CHAT, req.msg, req.sender_name);
                should_broadcast = true;
            }
        } else if (conn.protocol == PROTO_WEBSOCKET) {
            WebSocketRequest req;
            WebSocketOpcode ret = parseWebSocketFrame(conn.inbuf, req);
            conn.outbuf.reserve(conn.outbuf.size() + 256);

            auto buildResponse = [&](WebSocketOpcode opcode, string payload_data = "", bool broadcast = false, uint16_t close_code = 0) {
                if (opcode == WS_TEXT) {
                    try {
                        json in = json::parse(payload_data);

                        json out;
                        out["nickname"] = conn.username;
                        out["text"] = in["text"];
                        out["timestamp"] = chrono::duration_cast<chrono::milliseconds>(chrono::system_clock::now().time_since_epoch()).count();

                        payload_data = out.dump();
                        LOG_DEBUG("fd = %d websocket payload: %s", conn.fd, payload_data.c_str());
                    } catch (const json::exception &e) {
                        LOG_WARN("bad json: %s", e.what());
                        return;
                    }
                }

                if (close_code) {
                    uint16_t code = htons(close_code);
                    payload_data.append(reinterpret_cast<char *>(&code), 2);
                }

                string response;
                response.reserve(10 + payload_data.size());

                uint8_t byte0 = 0x80 | (uint8_t)opcode;
                response.append(reinterpret_cast<char *>(&byte0), 1);
                if (payload_data.size() < 126) {
                    uint8_t byte1 = payload_data.size();
                    response.append(reinterpret_cast<char *>(&byte1), 1);
                } else if (payload_data.size() < (1 << 16)) {
                    uint8_t byte1 = 126;
                    response.append(reinterpret_cast<char *>(&byte1), 1);
                    uint16_t payload_length = payload_data.size();
                    uint16_t ext = htons(payload_length);
                    response.append(reinterpret_cast<char *>(&ext), 2);
                } else {
                    uint8_t byte1 = 127;
                    response.append(reinterpret_cast<char *>(&byte1), 1);
                    uint64_t payload_length = payload_data.size();
                    uint64_t ext = htobe64(payload_length);
                    response.append(reinterpret_cast<char *>(&ext), 8);
                }
                response += move(payload_data);
                LOG_DEBUG("fd = %d build response frame size: %zu", conn.fd, response.size());

                if (broadcast) {
                    broadcast_frame = move(response);
                    LOG_DEBUG("fd = %d move response to broadcast frame size: %zu", conn.fd, broadcast_frame.size());
                } else {
                    conn.outbuf += move(response);
                }
            };

            if (ret == WS_PROTOCOLERROR) {
                LOG_DEBUG("fd = %d send websocket parse failed", conn.fd);
                buildResponse(WS_CLOSE, "", false, WS_PROTOCOLERROR);
                conn.shouldClose = true;
                trySend(conn);
                return;
            } else if (ret == WS_TEXT) {
                should_broadcast = true;
                buildResponse(WS_TEXT, move(req.payload_data), should_broadcast);
            } else if (ret == WS_CLOSE) {
                buildResponse(WS_CLOSE);
                conn.shouldClose = true;
            } else if (ret == WS_PING) {
                buildResponse(WS_PONG, move(req.payload_data));
            }
        }
        conn.inbuf.erase(conn.inbuf.begin(), conn.inbuf.begin() + res.end_pos);

        if (should_broadcast && !broadcast_frame.empty()) {
            shared_ptr<const string> frame = make_shared<string>(broadcast_frame);
            LOG_DEBUG("reactor[%d] push a broadcast frame size = %zu to other sub reactor",
                      m_index,
                      broadcast_frame.size());
            for (auto &peer : m_sub_reactors) {
                if (peer.get() == this) continue;
                peer->enqueueBroadcast(frame);
            }

            for (auto it = m_conns.begin(); it != m_conns.end();) {
                LOG_DEBUG("send broadcast to fd = %d", it->second->fd);
                auto current = it++;
                if (current->second->protocol != PROTO_WEBSOCKET) continue;
                current->second->outbuf += broadcast_frame;
                trySend(*current->second);
            }
        } else {
            trySend(conn);
        }

        int conn_fd = conn.fd;
        if (!m_conns.contains(conn_fd)) {
            return;
        }

        if (!conn.outbuf.empty() || conn.file_offset < conn.file_size) {
            return;
        }
    }
}

string_view Reactor::getMimeType(const string &file_path) {
    static const string_view unkonwn_type = "application/octet-stream";
    static const unordered_map<string_view, string_view> mime_table = {
        {"html", "text/html; charset=utf-8"},
        {"css", "text/css; charset=utf-8"},
        {"js", "application/javascript; charset=utf-8"},
        {"json", "application/json; charset=utf-8"},
        {"png", "image/png"},
        {"jpg", "image/jpeg"},
        {"jpeg", "image/jpeg"},
        {"svg", "image/svg+xml"},
        {"ico", "image/x-icon"}};

    size_t pos = file_path.rfind('.');
    if (pos == string::npos || file_path.size() < pos + 2) {
        return unkonwn_type;
    }

    string_view ext(file_path.data() + pos + 1, file_path.size() - pos - 1);
    auto it = mime_table.find(ext);
    if (it == mime_table.end()) {
        return unkonwn_type;
    }
    return it->second;
};

void Reactor::conn_notify() {
    uint64_t val = 1;
    write(m_conn_notifyfd, &val, sizeof(val));
}

void Reactor::broadcast_notify() {
    uint64_t val = 1;
    write(m_broadcast_notifyfd, &val, sizeof(val));
}

static void setnonblocking(int fd) {
    int old_option = fcntl(fd, F_GETFL);
    int new_option = old_option | O_NONBLOCK;
    fcntl(fd, F_SETFL, new_option);
}

void Reactor::addfd(int fd) {
    epoll_event event;
    event.events = EPOLLET | EPOLLIN;
    event.data.fd = fd;
    epoll_ctl(m_epollfd, EPOLL_CTL_ADD, fd, &event);
    setnonblocking(fd);
}

void Reactor::modfd(int fd, uint32_t events) {
    epoll_event event;
    event.events = events;
    event.data.fd = fd;
    epoll_ctl(m_epollfd, EPOLL_CTL_MOD, fd, &event);
}

void Reactor::trySend(Connection &conn) {
    if (conn.outbuf.empty() && conn.file_offset == conn.file_size) {
        return;
    }

    LOG_DEBUG("fd = %d, will send packet size: %zu, packet: %.*s",
              conn.fd,
              conn.outbuf.size(),
              static_cast<int>(conn.outbuf.size()),
              conn.outbuf.c_str());

    size_t sent = 0;
    while (sent < conn.outbuf.size()) {
        ssize_t n = send(conn.fd, conn.outbuf.data() + sent, conn.outbuf.size() - sent, 0);
        if (n > 0) {
            sent += n;
        } else if (n == -1 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            LOG_DEBUG("write would block, enable EPOLLOUT and send later");
            modfd(conn.fd, EPOLLET | EPOLLIN | EPOLLOUT);
            conn.outbuf.erase(0, sent);
            return;
        } else {
            LOG_DEBUG("write failed");
            if (conn.file_fd > 0) closeFile(conn);
            closeNow(conn.fd);
            return;
        }
    }
    conn.outbuf.erase(0, sent);

    while (conn.file_offset < conn.file_size) {
        ssize_t n = sendfile(conn.fd, conn.file_fd, &conn.file_offset, conn.file_size - conn.file_offset);
        if (n > 0) {
        } else if (n == -1 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            LOG_DEBUG("sendfile would block, enable EPOLLOUT and send later");
            modfd(conn.fd, EPOLLET | EPOLLIN | EPOLLOUT);
            return;
        } else {
            LOG_DEBUG("sendfile failed");
            closeFile(conn);
            closeNow(conn.fd);
            return;
        }
    }
    closeFile(conn);

    if (conn.readClosed || conn.shouldClose) {
        LOG_DEBUG("send complete, close fd = %d", conn.fd);
        closeNow(conn.fd);
        return;
    } else if (!conn.keepAlive) {
        LOG_DEBUG("client not keep alive, send complete, close fd = %d", conn.fd);
        closeNow(conn.fd);
        return;
    } else {
        LOG_DEBUG("fd = %d, send complete", conn.fd);
        modfd(conn.fd, EPOLLET | EPOLLIN);
    }
}

void Reactor::sendError(Connection &conn, string_view resp, uint64_t end_pos) {
    if (resp == resp_bad_request) {
        conn.outbuf = resp;
        conn.shouldClose = true;
        modfd(conn.fd, EPOLLET | EPOLLOUT);
    } else {
        conn.inbuf.erase(conn.inbuf.begin(), conn.inbuf.begin() + end_pos);
        conn.outbuf += resp;
    }
    trySend(conn);
}

void Reactor::closeFile(Connection &conn) {
    close(conn.file_fd);
    conn.file_fd = -1;
    conn.file_size = 0;
    conn.file_offset = 0;
}

void Reactor::closeNow(int fd) {
    epoll_ctl(m_epollfd, EPOLL_CTL_DEL, fd, nullptr);
    m_timer_heap.remove(fd);
    close(fd);
    m_conns.erase(fd);
}

FrameResult Reactor::checkFrame(Connection &conn) {
    if (conn.protocol == PROTO_HTTP) {
        FrameResult res = checkHttpFrame(conn.inbuf, conn.fd);
        if (res.status == FrameStatus::ProtocolError) {
            sendError(conn, resp_bad_request);
        }
        return res;
    }
    if (conn.protocol == PROTO_BINARY) return checkProtobufFrame(conn.inbuf, conn.fd);
    if (conn.protocol == PROTO_WEBSOCKET) return checkWebSocketFrame(conn.inbuf, conn.fd);
    return {FrameStatus::ProtocolError, 0};
}
