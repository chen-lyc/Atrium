#include "reactor.h"
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
#include <sys/epoll.h>
#include <sys/sendfile.h>
#include <sys/socket.h>
#include <sys/stat.h>
using namespace std;
using json = nlohmann::json;

static bool isRequestComplete(Connection &conn);

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
                LOG_INFO("server stopped by signal SIGINT or SIGTERM");
            } else {
                LOG_ERROR("epoll_wait failed");
            }
            continue;
        } else if (number == 0) {
            m_timer_heap.tick();
            for (auto fd : m_timer_heap.getExpired()) {
                LOG_DEBUG("close inactive connection, fd = " + to_string(fd));
                closeNow(fd);
            }
            continue;
        }

        for (int i = 0; i < number; i++) {
            int fd = events[i].data.fd;
            LOG_DEBUG("reactor[" + to_string(m_index) + "], event fd = " + to_string(fd));
            if (fd == m_conn_notifyfd) {
                uint64_t val;
                read(m_conn_notifyfd, &val, sizeof(val));

                if (!m_running) {
                    LOG_INFO("reactor close");
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

                    LOG_DEBUG("fd = " + to_string(conn_fd) + " assigned to " + "reactor[" + to_string(m_index) + ']');

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
                LOG_DEBUG("reactor[" + to_string(m_index) + "] start to broadcast");
                while (!broadcast_queue.empty()) {
                    const auto &frame = *broadcast_queue.front();
                    for (auto it = m_conns.begin(); it != m_conns.end();) {
                        auto current = it++;
                        if (current->second->protocol != PROTO_WEBSOCKET) continue;
                        LOG_DEBUG("reactor[" + to_string(m_index) + "] broadcast frame :" + frame + " to fd = " + to_string(current->second->fd));
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
                        LOG_DEBUG("client closed writing, fd = " + to_string(fd));
                        m_conns[fd]->readClosed = true;
                        process(*m_conns[fd]);
                        if (m_conns.contains(fd) && m_conns[fd]->outbuf.empty()) {
                            closeNow(fd);
                        }
                        break;
                    } else {
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            process(*m_conns[fd]);
                            break;
                        } else {
                            LOG_ERROR("read failed");
                            closeNow(fd);
                            break;
                        }
                    }
                }

                auto it = m_conns.find(fd);
                if (it == m_conns.end()) {
                    continue;
                }

                if (it->second->shouldClose) {
                    closeNow(fd);
                }
            } else if (events[i].events & EPOLLOUT) {
                if (m_conns.contains(fd)) {
                    trySend(*m_conns[fd]);
                }

                auto it = m_conns.find(fd);
                if (it == m_conns.end()) {
                    continue;
                }

                if (it->second->shouldClose) {
                    closeNow(fd);
                }
            } else {
                LOG_DEBUG("something else happened");
            }
        }
    }
}

void Reactor::process(Connection &conn) {
    while (isRequestComplete(conn)) {
        bool should_broadcast = false;
        string broadcast_frame;
        size_t end_pos;

        LOG_DEBUG("fd = " + to_string(conn.fd) + " send data : " + conn.inbuf);

        enum class RegisterResult {
            Success,
            UserExists,
            ServerError
        };

        enum class LoginResult {
            Success,
            UserNotFound,
            WrongPassword,
            ServerError
        };

        auto do_register = [](const string &username, const string &password, const string &session = "") {
            string result_text;
            string query = "SELECT username FROM users WHERE username = '" + username + '\'';
            MysqlPool::getInstance().executeQuery(query, result_text);
            if (!result_text.empty()) {
                return RegisterResult::UserExists;
            }

            string salt = generateSalt();
            string password_hash = to_string(hasher(password + salt));

            query.reserve(128);
            query = "INSERT INTO users (username, password_hash, salt) VALUES ('";
            query += username;
            query += "', '";
            query += password_hash;
            query += "', '";
            query += salt;
            query += "')";
            int ret = MysqlPool::getInstance().executeQuery(query);

            if (ret) {
                string command;
                command.reserve(56);
                command += "SET user:";
                command += username;
                command += ' ';
                command += password_hash;
                command += ':';
                command += salt;
                RedisPool::getInstance().executeCommand(command);

                command = "SET session:";
                command += session;
                command += ' ';
                command += username;
                command += " EX 86400";
                RedisPool::getInstance().executeCommand(command);
                return RegisterResult::Success;
            }

            return RegisterResult::ServerError;
        };

        auto do_login = [](const string &username, const string &password, const string &session = "") {
            string command;
            command.reserve(56);
            command += "GET user:";
            command += username;
            string result_value;
            int ret = RedisPool::getInstance().executeCommand(command, result_value);
            if (ret) {
                LOG_DEBUG("login cache hit in Redis");

                size_t separator_pos = result_value.find(':');
                string password_hash = result_value.substr(0, separator_pos);
                string salt = result_value.substr(separator_pos + 1, result_value.size() - separator_pos);

                if (to_string(hasher(password + salt)) == password_hash) {
                    command = "SET session:";
                    command += session;
                    command += ' ';
                    command += username;
                    command += " EX 86400";
                    RedisPool::getInstance().executeCommand(command);
                    return LoginResult::Success;
                }
                return LoginResult::WrongPassword;
            }

            string result_text;
            {
                string query;
                query.reserve(56);
                query += "SELECT password_hash, salt FROM users WHERE username = '";
                query += username;
                query += '\'';
                MysqlPool::getInstance().executeQuery(query, result_text);
            }

            if (result_text.empty()) {
                LOG_DEBUG("login: user not found");
                return LoginResult::UserNotFound;
            }

            string password_hash = result_text.substr(0, result_text.find(' '));
            result_text.erase(result_text.begin(), result_text.begin() + password_hash.size() + 1);

            string salt = result_text;

            if (to_string(hasher(password + salt)) == password_hash) {
                command = "SET user:";
                command += username;
                command += ' ';
                command += password_hash;
                command += ':';
                command += salt;
                RedisPool::getInstance().executeCommand(command);

                command = "SET session:";
                command += session;
                command += ' ';
                command += username;
                command += " EX 86400";
                RedisPool::getInstance().executeCommand(command);

                return LoginResult::Success;
            }
            return LoginResult::WrongPassword;
        };

        if (conn.protocol == PROTO_HTTP) {
            auto auth_session = [](HttpRequest &req, string &username) {
                auto it = req.cookies.find("session_id");
                if (it == req.cookies.end()) {
                    return false;
                }

                string command;
                command.reserve(32);
                command += "GET session:";
                command += it->second;
                int ret = RedisPool::getInstance().executeCommand(command, username);
                if (!ret) {
                    return false;
                }

                return true;
            };

            HttpRequest req;
            ParseState ret = parseHttpRequest(conn.inbuf, req);
            end_pos = req.end_pos;
            conn.outbuf.reserve(256);

            LOG_DEBUG("request is HTTP and method is " + req.method + ", target is " + req.target + ", version is " + req.version);

            if (ret == PARSE_ERROR) {
                LOG_DEBUG("HTTP parse failed, fd = " + to_string(conn.fd));
                conn.outbuf = resp_bad_request;
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
                LOG_DEBUG("websocket accpet size: " + to_string(accept.size()));
                BIO_free_all(b64);

                if (auth_session(req, conn.username)) {
                    conn.protocol = PROTO_WEBSOCKET;
                    m_timer_heap.update(conn.fd, 60000);
                    conn.outbuf += "HTTP/1.1 101 Switching Protocols\r\n";
                    conn.outbuf += "Upgrade: websocket\r\n";
                    conn.outbuf += "Connection: Upgrade\r\n";
                    conn.outbuf += "Sec-WebSocket-Accept: ";
                    conn.outbuf += move(accept);
                    conn.outbuf += "\r\n\r\n";
                } else {
                    conn.outbuf = resp_unauthorized;
                    conn.shouldClose = true;
                }
            } else if (req.target == "/echo") {
                conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Length: ";
                conn.outbuf += to_string(req.body.size());
                conn.outbuf += "\r\n\r\n";
                conn.outbuf += req.body;
            } else if (req.target == "/me") {
                if (auth_session(req, conn.username)) {
                    string body = R"({"username":")" + conn.username + R"("})";
                    conn.outbuf = "HTTP/1.1 200 OK\r\n";
                    conn.outbuf += "Content-Type: application/json\r\n";
                    conn.outbuf += "Content-Length: " + to_string(body.size()) + "\r\n\r\n";
                    conn.outbuf += body;
                } else {
                    conn.outbuf = resp_unauthorized;
                    conn.shouldClose = true;
                }
            } else if (req.method == "GET") {
                string file_path = "static" + req.target;
                if (req.target == "/" || req.target == "/login" || req.target == "/register" || req.target == "/chat") {
                    file_path = "static/index.html";
                }
                LOG_DEBUG("file path is " + file_path);
                int file_fd = open(file_path.c_str(), O_RDONLY);
                if (file_fd == -1) {
                    conn.outbuf = resp_not_found;
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
                    conn.outbuf = resp_missing_params;
                } else {
                    size_t username_start = username_value_pos + username_key.size();
                    size_t username_end = req.body.find("&", username_start);
                    string username = req.body.substr(username_start, username_end - username_start);
                    username = escapeSqlString(username);

                    size_t password_start = password_value_pos + password_key.size();
                    size_t password_end = req.body.find("&", password_start);
                    string password = req.body.substr(password_start, password_end - password_start);
                    password = escapeSqlString(password);

                    LOG_DEBUG("username = " + username + ", password = " + password);

                    string session(generateSessionId());
                    if (req.target == "/register") {
                        RegisterResult ret = do_register(username, password, session);

                        if (ret == RegisterResult::Success) {
                            conn.outbuf += resp_header_register_sussess;
                            conn.outbuf += "Set-Cookie: session_id=";
                            conn.outbuf += session;
                            conn.outbuf += "\r\n\r\nregister success";
                        } else if (ret == RegisterResult::ServerError) {
                            conn.outbuf = resp_server_error;
                        } else if (ret == RegisterResult::UserExists) {
                            conn.outbuf = resp_user_exists;
                        }
                    } else {
                        LoginResult ret = do_login(username, password, session);

                        if (ret == LoginResult::Success) {
                            conn.outbuf += resp_header_login_success;
                            conn.outbuf += "Set-Cookie: session_id=";
                            conn.outbuf += session;
                            conn.outbuf += "\r\n\r\nlogin success";
                        } else if (ret == LoginResult::ServerError) {
                            conn.outbuf = resp_server_error;
                        } else if (ret == LoginResult::UserNotFound) {
                            conn.outbuf = resp_user_not_found;
                        } else if (ret == LoginResult::WrongPassword) {
                            conn.outbuf = resp_wrong_password;
                        }
                    }
                }
            } else {
                conn.outbuf = default_response;
            }

            if (req.version == "HTTP/1.0" || req.connection == "close") {
                conn.keepAlive = false;
            }
        } else if (conn.protocol == PROTO_BINARY) {
            ProtobufRequest req;
            MessageType ret = parseProtobufMessage(conn.inbuf, req);
            end_pos = req.end_pos;
            conn.outbuf.reserve(256);

            LOG_DEBUG("parsed data: " + to_string(req.msg_type) + ' ' + to_string(req.msg_length) + " usernamne=" + req.username + " password=" + req.password);

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
                LOG_DEBUG("protobuf parse failed, fd = " + to_string(conn.fd));
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
            end_pos = req.end_pos;
            conn.outbuf.reserve(256);

            auto buildResponse = [&](WebSocketOpcode opcode, string payload_data = "", bool broadcast = false) {
                if (opcode == WS_TEXT) {
                    try {
                        json in = json::parse(payload_data);

                        json out;
                        out["nickname"] = conn.username;
                        out["text"] = in["text"];
                        out["timestamp"] = chrono::duration_cast<chrono::milliseconds>(chrono::system_clock::now().time_since_epoch()).count();

                        payload_data = out.dump();
                    } catch (const json::exception &e) {
                        LOG_WARN(string("bad json: ") + e.what());
                        return;
                    }
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
                LOG_DEBUG("fd = " + to_string(conn.fd) + " build response frame: " + response);

                if (broadcast) {
                    broadcast_frame = move(response);
                    LOG_DEBUG("fd = " + to_string(conn.fd) + " move response to broadcast frame: " + broadcast_frame);
                } else {
                    conn.outbuf = move(response);
                }
            };

            if (ret == WS_ERROR) {
                LOG_DEBUG("websocket parse failed, fd = " + to_string(conn.fd));
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
        conn.inbuf.erase(conn.inbuf.begin(), conn.inbuf.begin() + end_pos);

        if (should_broadcast && !broadcast_frame.empty()) {
            shared_ptr<const string> frame = make_shared<string>(broadcast_frame);
            LOG_DEBUG("reactor[" + to_string(m_index) + "] push a broadcast frame: " + broadcast_frame + " to other sub reactor");
            for (auto &peer : m_sub_reactors) {
                if (peer.get() == this) continue;
                peer->enqueueBroadcast(frame);
            }

            for (auto it = m_conns.begin(); it != m_conns.end();) {
                LOG_DEBUG("send broadcast to fd = " + to_string(it->second->fd));
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

    LOG_DEBUG("fd = " + to_string(conn.fd) + ", will send packet size: " + to_string(conn.outbuf.size()) + ", packet: " + conn.outbuf);

    ssize_t sent = 0;
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
            LOG_ERROR("write failed");
            conn.outbuf.erase(0, sent);
            closeFile(conn);
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
            LOG_ERROR("sendfile failed");
            closeFile(conn);
            return;
        }
    }
    closeFile(conn);

    if (conn.readClosed || conn.shouldClose) {
        LOG_DEBUG("send complete, close fd = " + to_string(conn.fd));
        closeNow(conn.fd);
        return;
    } else if (!conn.keepAlive) {
        LOG_DEBUG("client not keep alive, send complete, close fd = " + to_string(conn.fd));
        closeNow(conn.fd);
        return;
    } else {
        LOG_DEBUG("fd = " + to_string(conn.fd) + ", send complete");
    }
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

static bool isRequestComplete(Connection &conn) {
    if (conn.protocol == PROTO_HTTP) {
        size_t head_end_pos = conn.inbuf.find("\r\n\r\n");
        if (head_end_pos == string::npos) {
            LOG_DEBUG("HTTP header incomplete : missing CRLFCRLF");
            return false;
        }

        string header_lower(head_end_pos, '\0');
        transform(conn.inbuf.begin(), conn.inbuf.begin() + head_end_pos, header_lower.begin(), ::tolower);

        static constexpr string_view key = "content-length:";
        size_t value_pos = header_lower.find(key);
        if (value_pos == string::npos) {
            LOG_DEBUG("HTTP no body");
            return true;
        }
        value_pos += key.size();
        value_pos = conn.inbuf.find_first_not_of(' ', value_pos);

        if (value_pos == string::npos) {
            LOG_DEBUG("HTTP incomplete or error");
            return false;
        }

        size_t value_end = conn.inbuf.find("\r\n", value_pos);
        size_t value = stoi(conn.inbuf.substr(value_pos, value_end - value_pos));

        size_t body_start_pos = head_end_pos + 4;
        size_t body_size = conn.inbuf.size() - body_start_pos;
        if (body_size < value) {
            LOG_DEBUG("HTTP body incomplete, received body size = " + to_string(body_size) + " ,expected = " + to_string(value));
            return false;
        } else {
            LOG_DEBUG("HTTP received complete");
        }

        return true;
    } else if (conn.protocol == PROTO_BINARY) {
        if (conn.inbuf.size() < 8) {
            LOG_DEBUG("fd = " + to_string(conn.fd) + " ,protobuf incomplete");
            return false;
        }

        uint32_t msg_type_debug;
        memcpy(&msg_type_debug, conn.inbuf.data(), 4);
        if (msg_type_debug > MSG_ERROR) {
            LOG_DEBUG("protobuf type error");
            return false;
        }

        uint32_t msg_length;
        memcpy(&msg_length, conn.inbuf.data() + 4, 4);
        LOG_DEBUG("fd = " + to_string(conn.fd) + " ,is_request_complete: type=" + to_string(msg_type_debug) + " length=" + to_string(msg_length) + " inbuf_size=" + to_string(conn.inbuf.size()));

        size_t prefix_consumed = 0;
        while (conn.inbuf.size() >= prefix_consumed + 8) {
            uint32_t msg_length;
            memcpy(&msg_length, conn.inbuf.data() + prefix_consumed + 4, 4);

            if (msg_length == 0) {
                prefix_consumed += 8;
                continue;
            }

            if (conn.inbuf.size() < prefix_consumed + 8 + msg_length) {
                LOG_DEBUG("fd = " + to_string(conn.fd) + ", protobuf message incomplete");
                return false;
            }

            conn.inbuf.erase(0, prefix_consumed);
            return true;
        }
        conn.inbuf.erase(0, prefix_consumed);
        return false;
    } else if (conn.protocol == PROTO_WEBSOCKET) {
        int prefix_length = 2;
        if (conn.inbuf.size() < prefix_length) {
            LOG_DEBUG("fd = " + to_string(conn.fd) + ", websocket incomplete");
            return false;
        }

        uint8_t byte1 = static_cast<uint8_t>(conn.inbuf[1]);
        bool masked = byte1 & 0x80;
        uint64_t payload_length = byte1 & 0x7F;

        auto read_extended_length = [&](int len) {
            if (conn.inbuf.size() < prefix_length + len) {
                LOG_DEBUG("fd = " + to_string(conn.fd) + ", websocket payload_length incomplete");
                return false;
            }

            if (len == 2) {
                uint16_t ext;
                memcpy(&ext, conn.inbuf.data() + prefix_length, len);
                payload_length = ntohs(ext);
            } else if (len == 8) {
                uint64_t ext;
                memcpy(&ext, conn.inbuf.data() + prefix_length, len);
                payload_length = be64toh(ext);
            }
            prefix_length += len;
            return true;
        };

        if (payload_length == 126) {
            if (!read_extended_length(2)) {
                return false;
            }
        } else if (payload_length == 127) {
            if (!read_extended_length(8)) {
                return false;
            }
        }

        prefix_length += 4 * masked;

        if (conn.inbuf.size() < prefix_length + payload_length) {
            LOG_DEBUG("fd = " + to_string(conn.fd) + ", websocket payload_data incomplete");
            return false;
        }
        return true;
    }

    return false;
}
