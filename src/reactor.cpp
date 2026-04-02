#include "reactor.h"
#include "http.h"
#include "http_codec.h"
#include "logger.h"
#include "message.pb.h"
#include "mysql_pool.h"
#include "protobuf_codec.h"
#include "redis_pool.h"
#include "utils.h"
#include <fcntl.h>
#include <sys/epoll.h>
#include <sys/sendfile.h>
#include <sys/socket.h>
#include <sys/stat.h>
using namespace std;

static bool isRequestComplete(Connection &conn);

Reactor::Reactor(int index, size_t num_memory) : m_index(index), m_conn_pool(num_memory) {
    m_epollfd = epoll_create1(0);
    m_notifyfd = eventfd(0, EFD_NONBLOCK);
    addfd(m_notifyfd);
    m_thread = thread(&Reactor::loop, this);
}

Reactor::~Reactor() {
    if (m_running) {
        shutDown();
    }
}

void Reactor::shutDown() {
    m_running = false;
    notify();
    if (m_thread.joinable()) {
        m_thread.join();
    }
    for (auto &[fd, conn] : m_conns) {
        close(fd);
    }
    close(m_epollfd);
    close(m_notifyfd);
}

void Reactor::addConnection(int fd, ProtocolType protocol) {
    {
        lock_guard<mutex> lock(m_queue_mutex);
        m_conn_queue.emplace(fd, protocol);
    }
    notify();
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
                LOG_INFO("close inactive connection, fd = " + to_string(fd));
                closeNow(fd);
            }
            continue;
        }

        for (int i = 0; i < number; i++) {
            int fd = events[i].data.fd;
            LOG_DEBUG("reactor[" + to_string(m_index) + "], event fd = " + to_string(fd));
            if (fd == m_notifyfd) {
                uint64_t val;
                read(m_notifyfd, &val, sizeof(val));

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

                    string msg;
                    msg.reserve(32);
                    msg += "fd = ";
                    msg += to_string(conn_fd);
                    msg += " assigned to ";
                    msg += "reactor[";
                    msg += to_string(m_index);
                    msg += ']';
                    LOG_INFO(msg);

                    unique_ptr<Connection, ConnDeleter> conn_ptr = m_conn_pool.create();
                    conn_ptr->fd = conn_fd;
                    conn_ptr->protocol = protocol;
                    m_conns.emplace(conn_fd, move(conn_ptr));
                    addfd(conn_fd);
                    m_timer_heap.add(conn_fd, 6000);
                }
            } else if (events[i].events & EPOLLIN) {
                if (!m_conns.contains(fd)) continue;
                m_timer_heap.update(fd, 6000);

                const int buf_size = 4096;
                char buf[buf_size];
                while (true) {
                    int n = recv(fd, buf, buf_size, 0);
                    if (n > 0) {
                        m_conns[fd]->inbuf.append(buf, n);
                    } else if (n == 0) {
                        LOG_INFO("client closed writing, fd = " + to_string(fd));
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
            } else if (events[i].events & EPOLLOUT) {
                if (m_conns.contains(fd)) {
                    trySend(*m_conns[fd]);
                }
            } else {
                LOG_WARN("something else happened");
            }
        }
    }
}

void Reactor::process(Connection &conn) {
    while (isRequestComplete(conn)) {
        bool should_broadcast = false;

        {
            string msg;
            msg.reserve(32 + conn.inbuf.size());
            msg += "fd = ";
            msg += to_string(conn.fd);
            msg += " send data : ";
            msg += conn.inbuf;
            LOG_INFO(msg);
        }

        size_t end_pos;

        auto do_register = [](const string &username, const string &password) {
            string salt = generateSalt();
            string password_hash = to_string(hasher(password + salt));

            string query;
            query.reserve(128);
            query += "INSERT INTO users (username, password_hash, salt) VALUES ('";
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
            }

            return ret;
        };

        auto do_login = [](const string &username, const string &password) {
            string command;
            command.reserve(56);
            command += "GET user:";
            command += username;
            string result_value;
            int ret = RedisPool::getInstance().executeCommand(command, result_value);
            if (ret) {
                LOG_INFO("login cache hit in Redis");

                size_t separator_pos = result_value.find(':');
                string password_hash = result_value.substr(0, separator_pos);
                string salt = result_value.substr(separator_pos + 1, result_value.size() - separator_pos);

                return to_string(hasher(password + salt)) == password_hash;
            }

            string result_text;
            {
                string query;
                query.reserve(56);
                query += "SELECT password_hash, salt FROM users WHERE username = '";
                query += username;
                query += '\'';
                query += result_text;
                MysqlPool::getInstance().executeQuery(query);
            }

            if (result_text.empty()) {
                LOG_WARN("login: user not found");
                return false;
            }

            string password_hash = result_text.substr(0, result_text.find(' '));
            result_text.erase(result_text.begin(), result_text.begin() + password_hash.size() + 1);

            string salt = result_text;

            command.clear();
            command += "SET user:";
            command += username;
            command += ' ';
            command += password_hash;
            command += ':';
            command += salt;
            RedisPool::getInstance().executeCommand(command);

            return to_string(hasher(password + salt)) == password_hash;
        };

        if (conn.protocol == PROTO_HTTP) {
            HttpRequest req;
            ParseState ret = parseHttpRequest(conn.inbuf, req);
            end_pos = req.end_pos;
            conn.outbuf.reserve(256 + req.body.size());

            LOG_DEBUG("request is HTTP and method is " + req.method + ", target is " + req.target + ", version is " + req.version);

            if (ret == PARSE_ERROR) {
                LOG_INFO("HTTP parse failed, fd = " + to_string(conn.fd));
                conn.outbuf = resp_bad_request;
            } else if (req.target == "/echo") {
                conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Length: ";
                conn.outbuf += to_string(req.body.size());
                conn.outbuf += "\r\n\r\n";
                conn.outbuf += req.body;
            } else if (req.target == "/register" || req.target == "/login") {
                LOG_DEBUG("HTTP request register or login");

                static constexpr string_view username_key = "username=";
                size_t username_value_pos = req.body.find(username_key);

                static constexpr string_view password_key = "password=";
                size_t password_value_pos = req.body.find(password_key);

                if (username_value_pos == string::npos || password_value_pos == string::npos) {
                    LOG_WARN("register request not have username or password");
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

                    if (req.target == "/register") {
                        int ret = do_register(username, password);

                        if (ret) {
                            conn.outbuf = resp_register_sussess;
                        } else {
                            conn.outbuf = resp_register_failed;
                        }
                    } else {
                        int ret = do_login(username, password);

                        if (ret) {
                            conn.outbuf = resp_login_success;
                        } else {
                            conn.outbuf = resp_login_failed;
                        }
                    }
                }
            } else if (req.method == "GET") {
                string file_path = "static" + req.target;
                if (req.target == "/") file_path = "static/index.html";
                LOG_INFO("file path is " + file_path);
                int file_fd = open(file_path.c_str(), O_RDONLY);
                if (file_fd == -1) {
                    conn.outbuf = resp_not_found;
                } else {
                    struct stat st;
                    fstat(file_fd, &st);
                    size_t file_size = st.st_size;
                    conn.file_fd = file_fd;
                    conn.file_size = file_size;

                    conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Length: ";
                    conn.outbuf += to_string(file_size);
                    conn.outbuf += "\r\n\r\n";
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

            {
                string msg;
                msg.reserve(256);
                msg += "parsed data: ";
                msg += to_string(req.msg_type);
                msg += ' ';
                msg += to_string(req.msg_length);
                msg += " usernamne=";
                msg += req.username;
                msg += " password=";
                msg += req.password;
                LOG_INFO(msg);
            }

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
                LOG_INFO("protobuf parse failed, fd = " + to_string(conn.fd));

                buildResponse(ERROR, "parse error");
            } else if (ret == MSG_REGISTER_REQ) {
                int ret = do_register(req.username, req.password);

                if (ret) {
                    buildResponse(REGISTER, "register success");
                } else {
                    buildResponse(ERROR, "register failed");
                }
            } else if (ret == MSG_LOGIN_REQ) {
                int ret = do_login(req.username, req.password);

                if (ret) {
                    buildResponse(LOGIN, "login success");
                } else {
                    buildResponse(ERROR, "login failed");
                }
            } else if (ret == MSG_CHAT_MSG) {
                buildResponse(CHAT, req.msg, req.sender_name);
                should_broadcast = true;
            }
        }
        conn.inbuf.erase(conn.inbuf.begin(), conn.inbuf.begin() + end_pos);

        int conn_fd = conn.fd;

        if (should_broadcast) {
            for (auto it = m_conns.begin(); it != m_conns.end();) {
                if (it->second->fd != conn.fd) {
                    LOG_DEBUG("send broadcast to fd = " + to_string(it->second->fd));
                    it->second->outbuf += conn.outbuf;
                    auto current = it++;
                    trySend(*current->second);
                } else {
                    it++;
                }
            }
            conn.outbuf.clear();
        } else {
            trySend(conn);
        }

        if (!m_conns.contains(conn_fd)) {
            return;
        }
    }
}

void Reactor::notify() {
    uint64_t val = 1;
    write(m_notifyfd, &val, sizeof(val));
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

    if (conn.readClosed) {
        LOG_INFO("send complete, close fd = " + to_string(conn.fd));
        closeNow(conn.fd);
        return;
    } else if (!conn.keepAlive) {
        LOG_INFO("client not keep alive, send complete, close fd = " + to_string(conn.fd));
        closeNow(conn.fd);
        return;
    } else {
        {
            string msg;
            msg.reserve(32);
            msg += "fd = ";
            msg += to_string(conn.fd);
            msg += ", send complete";
            LOG_INFO(msg);
        }
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
            LOG_WARN("protobuf type error");
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
    }

    return false;
}