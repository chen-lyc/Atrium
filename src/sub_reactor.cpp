#include "sub_reactor.h"
#include "connection_route.h"
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

void Reactor::enqueueBroadcast(BroadcastTask task) {
    {
        lock_guard<mutex> lock(m_broadcast_mutex);
        m_broadcast_queue.emplace(move(task));
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

                queue<BroadcastTask> broadcast_queue;
                {
                    lock_guard<mutex> lock(m_broadcast_mutex);
                    broadcast_queue.swap(m_broadcast_queue);
                }
                LOG_DEBUG("reactor[%d] start to broadcast", m_index);
                while (!broadcast_queue.empty()) {
                    const auto &frame = *broadcast_queue.front().frame;
                    const vector<int> &fds = broadcast_queue.front().target_fds;
                    const uint64_t conversation_id = broadcast_queue.front().conversation_id;
                    for (int fd : fds) {
                        if (!m_conns.contains(fd) || m_conns[fd]->protocol != PROTO_WEBSOCKET || !m_conns[fd]->conversation_ids.contains(conversation_id)) continue;
                        LOG_DEBUG("reactor[%d] broadcast frame size = %zu to fd = %d",
                                  m_index,
                                  frame.size(),
                                  fd);
                        m_conns[fd]->outbuf += frame;
                        trySend(*m_conns[fd]);
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
                        if (m_conns[fd]->file_offset == m_conns[fd]->file_size) {
                            process(*m_conns[fd]);
                        }
                        break;
                    } else {
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            if (m_conns[fd]->file_offset == m_conns[fd]->file_size) {
                                process(*m_conns[fd]);
                            }
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
        uint64_t conversation_id = 0;
        string broadcast_frame;
        unordered_map<int, vector<int>> reactor_to_fds;

        LOG_DEBUG("fd = %d send data : %.*s",
                  conn.fd,
                  static_cast<int>(conn.inbuf.size()),
                  conn.inbuf.c_str());

        if (conn.protocol == PROTO_HTTP) {
            HttpRequest req;
            ParseState ret = parseHttpRequest(conn.inbuf, req);
            conn.outbuf.reserve(conn.outbuf.size() + 256);

            if (req.version != "HTTP/1.0" && req.version != "HTTP/1.1") {
                sendError(conn, resp_bad_request);
                return;
            }

            LOG_DEBUG("request is HTTP and method is %s, target is %s, version is %s",
                      req.method.c_str(),
                      req.target.c_str(),
                      req.version.c_str());

            if (ret == PARSE_ERROR) {
                LOG_DEBUG("HTTP parse failed, fd = %d", conn.fd);
                sendError(conn, resp_bad_request);
                return;
            } else if (req.upgrade == "websocket" && req.connection == "upgrade") {
                if (req.method != "GET" || req.sec_websocket_version != 13 || !isValidSecWebSocketKey(req.sec_websocket_key)) {
                    sendError(conn, resp_bad_request);
                    return;
                }

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

                SessionResult ret = get_session(req, conn.user_id, conn.username);
                if (ret == SessionResult::Success) {
                    MysqlPool::QueryResult get_ret = get_conversation_ids(conn.user_id, conn.conversation_ids);
                    if (get_ret == MysqlPool::QueryResult::NotFound || get_ret == MysqlPool::QueryResult::ServerError) {
                        if (sendError(conn, resp_server_error, res.end_pos)) continue;
                        return;
                    }

                    conn.protocol = PROTO_WEBSOCKET;
                    m_timer_heap.update(conn.fd, 60000);

                    conn.outbuf += "HTTP/1.1 101 Switching Protocols\r\n"
                                   "Upgrade: websocket\r\n"
                                   "Connection: Upgrade\r\n"
                                   "Sec-WebSocket-Accept: ";
                    conn.outbuf += move(accept);
                    conn.outbuf += "\r\n\r\n";
                } else if (ret == SessionResult::TokenExpired) {
                    conn.outbuf += resp_unauthorized;
                } else if (ret == SessionResult::InvalidRequest) {
                    sendError(conn, resp_bad_request);
                    return;
                } else if (ret == SessionResult::NetWorkError) {
                    conn.outbuf += resp_server_error;
                } else if (ret == SessionResult::ServerError) {
                    conn.outbuf += resp_server_error;
                }
            } else if (req.target == "/echo" && (req.method == "GET" || req.method == "HEAD")) {
                conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Length: ";
                conn.outbuf += to_string(req.body.size());
                conn.outbuf += "\r\n\r\n";
                if (req.method == "GET") conn.outbuf += req.body;
            } else if (req.target == "/me" && (req.method == "GET" || req.method == "HEAD")) {
                SessionResult ret = get_session(req, conn.user_id, conn.username);
                if (ret == SessionResult::Success) {
                    int get_ret = get_conversation_ids(conn.user_id, conn.conversation_ids);
                    if (get_ret == MysqlPool::QueryResult::Success) {
                        optional<string> build_ret = buildConversationListJson(conn);
                        if (!build_ret.has_value()) {
                            if (sendError(conn, resp_server_error, res.end_pos)) continue;
                            return;
                        }
                        string &body = build_ret.value();
                        conn.outbuf += "HTTP/1.1 200 OK\r\n";
                        conn.outbuf += "Content-Type: application/json\r\n";
                        conn.outbuf += "Content-Length: ";
                        conn.outbuf += to_string(body.size());
                        conn.outbuf += "\r\n\r\n";
                        if (req.method == "GET") conn.outbuf += body;
                    } else if (get_ret == MysqlPool::QueryResult::NotFound || get_ret == MysqlPool::QueryResult::ServerError) {
                        if (sendError(conn, resp_server_error, res.end_pos)) continue;
                        return;
                    }
                } else if (ret == SessionResult::TokenExpired) {
                    conn.outbuf += resp_unauthorized;
                } else if (ret == SessionResult::InvalidRequest) {
                    sendError(conn, resp_bad_request);
                    return;
                } else if (ret == SessionResult::NetWorkError) {
                    conn.outbuf += resp_server_error;
                } else if (ret == SessionResult::ServerError) {
                    conn.outbuf += resp_server_error;
                }
            } else if (req.method == "GET" || req.method == "HEAD") {
                if (req.target.find("..") != string::npos) {
                    sendError(conn, resp_bad_request);
                    return;
                }

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
                    if (req.method == "GET") {
                        conn.file_fd = file_fd;
                        conn.file_size = file_size;
                    } else {
                        close(file_fd);
                    }

                    conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Type: ";
                    conn.outbuf += getMimeType(file_path);
                    conn.outbuf += "\r\nContent-Length: ";
                    conn.outbuf += to_string(file_size);
                    conn.outbuf += "\r\n\r\n";
                }
            } else if (req.target == "/register" || req.target == "/login") {
                LOG_DEBUG("fd = %d send HTTP request register or login", conn.fd);

                string username, password;
                if (req.content_type == "application/x-www-form-urlencoded") {
                    static constexpr string_view username_key = "username";
                    static constexpr string_view password_key = "password";
                    string_view username_value;
                    string_view password_value;
                    size_t username_count = 0;
                    size_t password_count = 0;

                    size_t start = 0;
                    while (start < req.body.size()) {
                        size_t eq_pos = req.body.find('=', start);
                        if (eq_pos == string::npos) {
                            sendError(conn, resp_bad_request);
                            return;
                        }

                        size_t end = req.body.find('&', eq_pos + 1);
                        if (end == string::npos) end = req.body.size();
                        string_view key(req.body.data() + start, eq_pos - start);
                        start = eq_pos + 1;
                        string_view value(req.body.data() + start, end - start);
                        start = end + 1;
                        if (key == username_key) {
                            if (++username_count > 1) {
                                sendError(conn, resp_bad_request);
                                return;
                            }
                            username_value = move(value);
                        } else if (key == password_key) {
                            if (++password_count > 1) {
                                sendError(conn, resp_bad_request);
                                return;
                            }
                            password_value = move(value);
                        }
                    }

                    if (username_count == 0 || password_count == 0) {
                        LOG_DEBUG("register request not have username or password");
                        conn.outbuf += resp_missing_params;
                        if (sendError(conn, resp_missing_params, res.end_pos)) continue;
                        return;
                    }

                    optional<string> username_result = url_decode(username_value);
                    optional<string> password_result = url_decode(password_value);
                    if (!username_result.has_value() || !password_result.has_value()) {
                        if (sendError(conn, resp_invalid_encode, res.end_pos)) continue;
                        return;
                    }

                    username = move(username_result.value());
                    password = move(password_result.value());
                } else if (req.content_type == "application/json") {
                    try {
                        json in = json::parse(req.body);
                        if (!in.contains("username") || !in["username"].is_string() || !in.contains("password") || !in["password"].is_string()) {
                            sendError(conn, resp_bad_request);
                            return;
                        }
                        username = in["username"].get<string>();
                        password = in["password"].get<string>();

                        if (username.empty() || password.empty()) {
                            sendError(conn, resp_bad_request);
                            return;
                        }
                    } catch (const exception &e) {
                        LOG_WARN("json request in login or register error, reason = %s", e.what());
                        sendError(conn, resp_bad_request);
                        return;
                    }
                } else {
                    sendError(conn, resp_unsupported_media_type, res.end_pos);
                    continue;
                }

                if (!is_valid_username(username)) {
                    if (sendError(conn, resp_invalid_username, res.end_pos)) continue;
                    else return;
                }
                if (!is_valid_password(password)) {
                    if (sendError(conn, resp_invalid_password, res.end_pos)) continue;
                    else return;
                }

                if (req.target == "/register") {
                    RegisterResult ret = do_register(username, password);

                    if (ret.state == RegisterStatus::Success) {
                        string token;
                        SessionResult session_ret = create_session(ret.user_id, username, token);
                        if (session_ret == SessionResult::Success) {
                            conn.user_id = move(ret.user_id);
                            conn.username = move(username);

                            MysqlPool::QueryResult ret = insert_public_chatroom(conn.user_id);
                            if (ret != MysqlPool::QueryResult::Success) {
                                if (sendError(conn, resp_server_error, res.end_pos)) continue;
                                return;
                            }
                            uint64_t personal_room_id = 0;
                            ret = create_personal_chatroom(personal_room_id, conn.user_id);
                            if (ret != MysqlPool::QueryResult::Success || personal_room_id == 0) {
                                if (sendError(conn, resp_server_error, res.end_pos)) continue;
                                return;
                            }
                            conn.conversation_ids.emplace(1);
                            conn.conversation_ids.emplace(personal_room_id);
                            ConnRoute::getInstance().add(1, m_index, conn.fd);
                            ConnRoute::getInstance().add(personal_room_id, m_index, conn.fd);

                            optional<string> build_ret = buildConversationListJson(conn);
                            if (!build_ret.has_value()) {
                                if (sendError(conn, resp_server_error, res.end_pos)) continue;
                                return;
                            }
                            string &body = build_ret.value();

                            conn.outbuf += "HTTP/1.1 200 OK\r\n"
                                           "Content-Type: application/json; charset=utf-8\r\n"
                                           "Content-Length: ";
                            conn.outbuf += to_string(body.size());
                            conn.outbuf += "\r\n";
                            conn.outbuf += "Set-Cookie: session_id=";
                            conn.outbuf += token;
                            conn.outbuf += "\r\n\r\n";
                            conn.outbuf += body;
                        } else if (session_ret == SessionResult::ServerError) {
                            conn.outbuf += resp_server_error;
                        }
                    } else if (ret.state == RegisterStatus::ServerError) {
                        conn.outbuf += resp_server_error;
                    } else if (ret.state == RegisterStatus::UserExists) {
                        conn.outbuf += resp_user_exists;
                    }
                } else {
                    LoginResult ret = do_login(username, password);

                    if (ret.state == LoginStatus::Success) {
                        string token;
                        SessionResult session_ret = create_session(ret.user_id, username, token);
                        if (session_ret == SessionResult::Success) {
                            MysqlPool::QueryResult get_ret = get_conversation_ids(ret.user_id, conn.conversation_ids);
                            if (get_ret == MysqlPool::QueryResult::Success) {
                                conn.user_id = move(ret.user_id);
                                conn.username = move(username);
                                optional<string> build_ret = buildConversationListJson(conn);
                                if (!build_ret.has_value()) {
                                    if (sendError(conn, resp_server_error, res.end_pos)) continue;
                                    return;
                                }
                                string &body = build_ret.value();

                                conn.outbuf += "HTTP/1.1 200 OK\r\n"
                                               "Content-Type: application/json; charset=utf-8\r\n"
                                               "Content-Length: ";
                                conn.outbuf += to_string(body.size());
                                conn.outbuf += "\r\n";
                                conn.outbuf += "Set-Cookie: session_id=";
                                conn.outbuf += token;
                                conn.outbuf += "\r\n\r\n";
                                conn.outbuf += body;
                            } else if (get_ret == MysqlPool::QueryResult::NotFound || get_ret == MysqlPool::QueryResult::ServerError) {
                                if (sendError(conn, resp_server_error, res.end_pos)) continue;
                                return;
                            }
                        } else if (session_ret == SessionResult::ServerError) {
                            conn.outbuf += resp_server_error;
                        }
                    } else if (ret.state == LoginStatus::ServerError) {
                        conn.outbuf += resp_server_error;
                    } else if (ret.state == LoginStatus::UserNotFound) {
                        conn.outbuf += resp_user_not_found;
                    } else if (ret.state == LoginStatus::WrongPassword) {
                        conn.outbuf += resp_wrong_password;
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
                if (ret.state == RegisterStatus::Success) {
                    buildResponse(REGISTER, "register success");
                } else {
                    buildResponse(ERROR, "register failed");
                }
            } else if (ret == MSG_LOGIN_REQ) {
                LoginResult ret = do_login(req.username, req.password);
                if (ret.state == LoginStatus::Success) {
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
                        conversation_id = in["conversation_id"];
                        if (!conn.conversation_ids.contains(conversation_id)) {
                            return false;
                        }
                        reactor_to_fds = ConnRoute::getInstance().query(conversation_id);
                        if (reactor_to_fds.empty()) {
                            return false;
                        }

                        json out;
                        out["user_id"] = conn.user_id;
                        out["username"] = conn.username;
                        out["conversation_id"] = conversation_id;
                        out["text"] = in["text"];
                        out["timestamp"] = chrono::duration_cast<chrono::milliseconds>(chrono::system_clock::now().time_since_epoch()).count();

                        payload_data = out.dump();
                        LOG_DEBUG("fd = %d websocket payload: %s", conn.fd, payload_data.c_str());
                    } catch (const json::exception &e) {
                        LOG_WARN("bad json: %s", e.what());
                        return false;
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

                return true;
            };

            if (ret == WS_PROTOCOLERROR) {
                LOG_DEBUG("fd = %d send websocket parse failed", conn.fd);
                sendError(conn, WS_PROTOCOLERROR);
                return;
            } else if (ret == WS_TEXT) {
                should_broadcast = true;
                if (buildResponse(WS_TEXT, move(req.payload_data), should_broadcast) == 0) {
                    sendError(conn, WS_PROTOCOLERROR);
                    return;
                }
            } else if (ret == WS_CLOSE) {
                buildResponse(WS_CLOSE);
                conn.shouldClose = true;
            } else if (ret == WS_PING) {
                buildResponse(WS_PONG, move(req.payload_data));
            }
        }
        conn.inbuf.erase(conn.inbuf.begin(), conn.inbuf.begin() + res.end_pos);
        int conn_fd = conn.fd;

        if (should_broadcast && conversation_id && !broadcast_frame.empty()) {
            shared_ptr<const string> frame = make_shared<string>(broadcast_frame);
            LOG_DEBUG("fd = %d, in reactor[%d], push a broadcast frame size = %zu",
                      conn.fd,
                      m_index,
                      broadcast_frame.size());

            for (auto it = reactor_to_fds.begin(); it != reactor_to_fds.end(); ++it) {
                m_sub_reactors[it->first]->enqueueBroadcast({conversation_id, it->second, frame});
            }
        } else {
            trySend(conn);
        }

        if (!m_conns.contains(conn_fd)) {
            return;
        }

        if (!conn.outbuf.empty() || conn.file_offset < conn.file_size) {
            return;
        }
    }
}

std::optional<std::string> Reactor::buildConversationListJson(Connection &conn) {
    json out;
    out["user_id"] = conn.user_id;
    out["username"] = conn.username;
    json list = json::array();
    MysqlPool::QueryResult get_name_ret = MysqlPool::QueryResult::ServerError;
    for (auto it = conn.conversation_ids.begin(); it != conn.conversation_ids.end(); ++it) {
        json c;
        string name;
        get_name_ret = get_conversation_name(*it, name);
        if (get_name_ret == MysqlPool::QueryResult::ServerError) break;
        c["id"] = *it;
        c["name"] = name;
        list.emplace_back(c);
    }
    if (get_name_ret != MysqlPool::QueryResult::Success) {
        return nullopt;
    }
    out["conversations"] = list;
    return out.dump();
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

void Reactor::trySend(Connection &conn, bool should_mod) {
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
            if (should_mod) modfd(conn.fd, EPOLLET | EPOLLIN | EPOLLOUT);
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
            if (should_mod) modfd(conn.fd, EPOLLET | EPOLLIN | EPOLLOUT);
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
        if (should_mod) modfd(conn.fd, EPOLLET | EPOLLIN);
    }
}

bool Reactor::sendError(Connection &conn, string_view resp, uint64_t end_pos) {
    if (resp == resp_bad_request) {
        conn.outbuf = resp;
        conn.shouldClose = true;
        modfd(conn.fd, EPOLLET | EPOLLOUT);
        trySend(conn, false);
        return true;
    } else {
        int conn_fd = conn.fd;
        conn.inbuf.erase(conn.inbuf.begin(), conn.inbuf.begin() + end_pos);
        conn.outbuf += resp;
        trySend(conn);
        return m_conns.contains(conn_fd);
    }
}

void Reactor::sendError(Connection &conn, uint16_t close_code) {
    char buf[4];
    buf[0] = 0x88; // 0x80 | WS_CLOSE
    buf[1] = 0x02;
    uint16_t code = htons(close_code);
    memcpy(buf + 2, &code, 2);
    conn.outbuf.append(buf, 4);

    conn.shouldClose = true;
    modfd(conn.fd, EPOLLET | EPOLLOUT);
    trySend(conn, false);
}

void Reactor::closeFile(Connection &conn) {
    close(conn.file_fd);
    conn.file_fd = -1;
    conn.file_size = 0;
    conn.file_offset = 0;
}

void Reactor::closeNow(int fd) {
    for (auto it = m_conns[fd]->conversation_ids.begin(); it != m_conns[fd]->conversation_ids.end(); ++it) {
        ConnRoute::getInstance().remove(*it, m_index, fd);
    }
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
    if (conn.protocol == PROTO_WEBSOCKET) {
        FrameResult res = checkWebSocketFrame(conn.inbuf, conn.fd);
        if (res.status == FrameStatus::ProtocolError) {
            sendError(conn, WS_PROTOCOLERROR);
        }
        return res;
    }
    return {FrameStatus::ProtocolError, 0};
}
