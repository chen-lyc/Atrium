#include "ai_client.h"
#include "sub_reactor.h"
#include "connection_route.h"
#include "http.h"
#include "http_codec.h"
#include "http_route.h"
#include "json.hpp"
#include "logger.h"
#include "message.pb.h"
#include "mysql_pool.h"
#include "protobuf_codec.h"
#include "thread_pool.h"
#include "utils.h"
#include "websocket_codec.h"
#include <fcntl.h>
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

static uint64_t now_ms() {
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch())
            .count());
}

Reactor::Reactor(int index, vector<unique_ptr<Reactor>> &sub_reactors, size_t num_memory) : m_index(index), m_sub_reactors(sub_reactors), m_timer_heap(index), m_conn_pool(num_memory) {
    m_epollfd = epoll_create1(0);
    m_conn_notifyfd = eventfd(0, EFD_NONBLOCK);
    m_broadcast_notifyfd = eventfd(0, EFD_NONBLOCK);
    m_room_membership_notifyfd = eventfd(0, EFD_NONBLOCK);
    addfd(m_conn_notifyfd);
    addfd(m_broadcast_notifyfd);
    addfd(m_room_membership_notifyfd);
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
    close(m_broadcast_notifyfd);
    close(m_room_membership_notifyfd);
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
        m_broadcast_queue.emplace(std::move(task));
    }
    broadcast_notify();
}

void Reactor::enqueueRoomMembership(RoomMembershipUpdata updata) {
    {
        lock_guard<mutex> lock(m_room_membership_mutex);
        m_room_membership_queue.emplace(updata);
    }
    room_membership_notify();
}

void Reactor::loop() {
    const size_t maxevents = 1024;
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
                    m_conns.emplace(conn_fd, std::move(conn_ptr));
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
                    const uint64_t room_id = broadcast_queue.front().room_id;
                    for (int fd : fds) {
                        if (!m_conns.contains(fd) || m_conns[fd]->protocol != PROTO_WEBSOCKET || !m_conns[fd]->room_ids.contains(room_id)) continue;
                        LOG_DEBUG("reactor[%d] broadcast frame size = %zu to fd = %d",
                            m_index,
                            frame.size(),
                            fd);
                        m_conns[fd]->outbuf += frame;
                        trySend(*m_conns[fd]);
                    }
                    broadcast_queue.pop();
                }
            } else if (fd == m_room_membership_notifyfd) {
                queue<RoomMembershipUpdata> room_membership_queue;
                {
                    lock_guard<mutex> lock(m_room_membership_mutex);
                    room_membership_queue.swap(m_room_membership_queue);
                }
                while (!room_membership_queue.empty()) {
                    const uint64_t room_id = room_membership_queue.front().room_id;
                    const vector<int> fds = room_membership_queue.front().target_fds;
                    const bool join = room_membership_queue.front().join;
                    for (int fd : fds) {
                        if (!m_conns.contains(fd) || m_conns[fd]->protocol != PROTO_WEBSOCKET) continue;
                        if (join) {
                            m_conns[fd]->room_ids.emplace(room_id);
                            ConnRoute::getInstance().addRoomConn(room_id, m_index, fd);
                        } else {
                            if (!m_conns[fd]->room_ids.contains(room_id)) continue;
                            m_conns[fd]->room_ids.erase(room_id);
                            ConnRoute::getInstance().removeRoomConn(room_id, m_index, fd);
                        }
                    }
                    room_membership_queue.pop();
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
        uint64_t room_id = 0;
        string broadcast_frame;
        unordered_map<int, vector<int>> reactor_to_fds;

        http::MembershipAction membership_action = http::MembershipAction::None;

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
                methodToString(req.method).data(),
                req.target.c_str(),
                req.version.c_str());

            if (ret == PARSE_ERROR) {
                LOG_DEBUG("HTTP parse failed, fd = %d", conn.fd);
                sendError(conn, resp_bad_request);
                return;
            } else if (req.upgrade == "websocket" && req.connection == "upgrade") {
                if (req.method != Method::GET || req.sec_websocket_version != 13 || !isValidSecWebSocketKey(req.sec_websocket_key)) {
                    sendError(conn, resp_bad_request);
                    return;
                }

                string websocket_accept;
                websocket_accept.reserve(64);
                websocket_accept = std::move(req.sec_websocket_key);
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
                    MysqlPool::QueryResult get_ret = get_room_ids(conn.user_id, conn.room_ids);
                    if (get_ret == MysqlPool::QueryResult::NotFound || get_ret == MysqlPool::QueryResult::ServerError) {
                        if (sendError(conn, resp_server_error, res.end_pos)) continue;
                        return;
                    }
                    for (auto it = conn.room_ids.begin(); it != conn.room_ids.end(); ++it) {
                        ConnRoute::getInstance().addRoomConn(*it, m_index, conn.fd);
                    }
                    ConnRoute::getInstance().addUserConn(conn.user_id, m_index, conn.fd);

                    conn.protocol = PROTO_WEBSOCKET;
                    m_timer_heap.update(conn.fd, 60000);

                    conn.outbuf +=
                        "HTTP/1.1 101 Switching Protocols\r\n"
                        "Upgrade: websocket\r\n"
                        "Connection: Upgrade\r\n"
                        "Sec-WebSocket-Accept: ";
                    conn.outbuf += std::move(accept);
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
            } else if (req.target == "/echo" && (req.method == Method::GET || req.method == Method::HEAD)) {
                conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Length: ";
                conn.outbuf += to_string(req.body.size());
                conn.outbuf += "\r\n\r\n";
                if (req.method == Method::GET) conn.outbuf += req.body;
            } else if (req.target.starts_with("/api")) {
                string_view api_target(req.target);
                http::RequestLine line = http::parse_request_line(req.method, api_target);
                http::PathParams params;
                optional<http::Router::Route> route = m_router.find_route(line, params);
                if (route == nullopt) {
                    if (sendError(conn, resp_api_not_found, res.end_pos)) continue;
                    return;
                }

                uint64_t user_id = 0;
                string username;
                if (route->need_auth) {
                    SessionResult ret = get_session(req, user_id, username);
                    if (ret == SessionResult::TokenExpired) {
                        if (sendError(conn, resp_unauthorized, res.end_pos)) continue;
                        return;
                    } else if (ret == SessionResult::InvalidRequest) {
                        sendError(conn, resp_bad_request);
                        return;
                    } else if (ret == SessionResult::NetWorkError) {
                        if (sendError(conn, resp_server_error, res.end_pos)) continue;
                        return;
                    } else if (ret == SessionResult::ServerError) {
                        if (sendError(conn, resp_server_error, res.end_pos)) continue;
                        return;
                    }
                }
                http::RequestContext ctx(req, params, conn, user_id, std::move(username));
                http::RouteResult ret = route->handler(ctx);
                if (ret.state == http::RouteStatus::BadRequest) {
                    sendError(conn, resp_bad_request);
                    return;
                } else if (ret.state == http::RouteStatus::Unauthorized) {
                    if (sendError(conn, resp_unauthorized, res.end_pos)) continue;
                    return;
                } else if (ret.state == http::RouteStatus::NotFound) {
                    if (sendError(conn, resp_not_found, res.end_pos)) continue;
                    return;
                } else if (ret.state == http::RouteStatus::ServerError) {
                    if (sendError(conn, resp_server_error, res.end_pos)) continue;
                    return;
                }

                if (ret.membership_action != http::MembershipAction::None) {
                    for (uint64_t user_id : ret.affected_user_ids) {
                        ConnRoute::getInstance().queryByUser(user_id, reactor_to_fds);
                    }
                    room_id = ret.room_id;
                    membership_action = ret.membership_action;
                }
            } else if (req.method == Method::GET || req.method == Method::HEAD) {
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
                    conn.file_size = file_size;
                    if (req.method == Method::GET) {
                        conn.file_fd = file_fd;
                    } else {
                        close(file_fd);
                    }

                    conn.outbuf += "HTTP/1.1 200 OK\r\nContent-Type: ";
                    conn.outbuf += getMimeType(file_path);
                    conn.outbuf += "\r\nContent-Length: ";
                    conn.outbuf += to_string(file_size);
                    conn.outbuf += "\r\n\r\n";
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

            string ai_reply_body;
            auto buildResponse = [&](WebSocketOpcode opcode, string payload_data = "", bool broadcast = false, uint16_t close_code = 0) {
                if (opcode == WS_TEXT) {
                    try {
                        json in = json::parse(payload_data);
                        room_id = in["data"]["room_id"];
                        uint64_t conversation_id = in["data"]["conversation_id"];
                        LOG_DEBUG("get some data from brower");

                        if (!conn.room_ids.contains(room_id)) {
                            LOG_WARN("ws room_id not joined, fd=%d room_id=%llu", conn.fd, room_id);
                            sendError(conn, WS_PROTOCOLERROR);
                            return false;
                        }
                        uint64_t real_room_id = 0;
                        vector<AiMemberInfo> ai_members;
                        MysqlPool::QueryResult ret = get_conv_room_and_ai_members(conversation_id, real_room_id, ai_members);
                        if (ret == MysqlPool::QueryResult::NotFound) {
                            LOG_WARN("ws conversation not in room, conv=%llu room=%llu", conversation_id, room_id);
                            sendError(conn, WS_PROTOCOLERROR);
                            return false;
                        }
                        if (ret != MysqlPool::QueryResult::Success) {
                            LOG_WARN("ws get_room_from_conversations ServerError, conv=%llu", conversation_id);
                            sendError(conn, WS_SERVERERROR);
                            return false;
                        }
                        if (real_room_id != room_id) {
                            LOG_WARN("ws room mismatch, expected=%llu actual=%llu conv=%llu",
                                room_id, real_room_id, conversation_id);
                            sendError(conn, WS_PROTOCOLERROR);
                            return false;
                        }
                        reactor_to_fds = ConnRoute::getInstance().queryByRoom(room_id);
                        if (reactor_to_fds.empty()) {
                            LOG_WARN("ws empty reactor fds, room_id=%llu", room_id);
                            sendError(conn, WS_PROTOCOLERROR);
                            return false;
                        }

                        chatdb::Message msg{
                            conversation_id,
                            conn.user_id,
                            in["data"]["type"],
                            in["data"]["content"],
                            now_ms(),
                            in["data"]["client_message_id"]};
                        if (msg.type >= static_cast<int>(chatdb::MessageType::SYSTEM) || msg.type < static_cast<int>(chatdb::MessageType::TEXT)) {
                            LOG_WARN("invalid message type=%d, expected TEXT(1)/IMAGE(2)/FILE(3), conv=%llu",
                                msg.type, conversation_id);
                            sendError(conn, WS_PROTOCOLERROR);
                            return false;
                        }
                        uint64_t message_id = 0;
                        ret = insert_message(msg, message_id);
                        if (ret == MysqlPool::QueryResult::AlreadyExists) {
                            return true;
                        }
                        if (ret != MysqlPool::QueryResult::Success) {
                            sendError(conn, WS_SERVERERROR);
                            return false;
                        }

                        LOG_DEBUG("build user json to brower");
                        json data;
                        data["room_id"] = room_id;
                        data["conversation_id"] = conversation_id;
                        data["message_id"] = message_id;
                        data["user_id"] = conn.user_id;
                        data["username"] = conn.username;
                        data["type"] = msg.type;
                        data["content"] = msg.content;
                        data["send_time_ms"] = msg.send_time_ms;
                        data["client_message_id"] = msg.client_message_id.value_or("");

                        json user_json;
                        user_json["type"] = static_cast<int>(chatdb::EventType::UserMsg);
                        user_json["data"] = data;
                        payload_data = user_json.dump();
                        LOG_DEBUG("fd = %d websocket payload: %s", conn.fd, payload_data.c_str());

                        for (auto &m : ai_members) {
                                const char *api_key_ptr = nullptr;
                                if (m.provider == "deepseek") api_key_ptr = std::getenv("DEEPSEEK_API_KEY");
                                else if (m.provider == "qwen") api_key_ptr = std::getenv("QWEN_API_KEY");
                                if (!api_key_ptr || !api_key_ptr[0]) continue;

                                auto launcher = [reactor_ptr = this, conversation_id = conversation_id, user_id = conn.user_id, room_id = room_id, ai_id = m.ai_id, provider = m.provider, ai_model = m.model](uint64_t trigger_message_id, uint64_t context_until_message_id) mutable {
                                    chatdb::Message ai_msg{
                                        conversation_id,
                                        ai_id,
                                        static_cast<int>(chatdb::MessageType::TEXT),
                                        "",
                                        now_ms(),
                                        nullopt};
                                    uint64_t ai_message_id = 0;
                                    MysqlPool::QueryResult ret = insert_hidden_message(ai_msg, now_ms(), ai_message_id);
                                    if (ret != MysqlPool::QueryResult::Success) {
                                        LOG_WARN("insert hidden ai message failed, conversation_id = %llu", conversation_id);
                                        ConvAiScheduler::getInstance().finish(conversation_id, ai_id, nullopt);
                                        return;
                                    }

                                    unique_ptr<AiReplyTask> task = make_unique<AiReplyTask>(*reactor_ptr, provider, conversation_id, trigger_message_id, context_until_message_id, user_id, room_id, ai_id, ai_model, ai_message_id);
                                    ThreadPool<Reactor::AiReplyTask>::getInstance().enqueue(std::move(task));
                                };
                                ConvAiScheduler::getInstance().submit(conversation_id, m.ai_id, message_id, launcher);
                            }
                    } catch (const json::exception &e) {
                        LOG_WARN("bad json: %s", e.what());
                        sendError(conn, WS_PROTOCOLERROR);
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
                response += std::move(payload_data);
                LOG_DEBUG("fd = %d build response frame size: %zu", conn.fd, response.size());

                if (broadcast) {
                    broadcast_frame = std::move(response);
                    LOG_DEBUG("fd = %d std::move response to broadcast frame size: %zu", conn.fd, broadcast_frame.size());
                } else {
                    conn.outbuf += std::move(response);
                }

                return true;
            };

            if (ret == WS_PROTOCOLERROR) {
                LOG_DEBUG("fd = %d send websocket parse failed", conn.fd);
                sendError(conn, WS_PROTOCOLERROR);
                return;
            } else if (ret == WS_TEXT) {
                should_broadcast = true;
                if (buildResponse(WS_TEXT, std::move(req.payload_data), should_broadcast) == 0) {
                    return;
                }
            } else if (ret == WS_CLOSE) {
                buildResponse(WS_CLOSE);
                conn.shouldClose = true;
            } else if (ret == WS_PING) {
                buildResponse(WS_PONG, std::move(req.payload_data));
            }
        }
        conn.inbuf.erase(conn.inbuf.begin(), conn.inbuf.begin() + res.end_pos);
        int conn_fd = conn.fd;

        if (should_broadcast && room_id && !broadcast_frame.empty()) {
            shared_ptr<const string> frame = make_shared<string>(broadcast_frame);
            LOG_DEBUG("fd = %d, in reactor[%d], push a broadcast frame size = %zu",
                conn.fd,
                m_index,
                broadcast_frame.size());

            for (auto it = reactor_to_fds.begin(); it != reactor_to_fds.end(); ++it) {
                m_sub_reactors[it->first]->enqueueBroadcast({room_id, it->second, frame});
            }
        } else {
            if (membership_action != http::MembershipAction::None) {
                for (auto it = reactor_to_fds.begin(); it != reactor_to_fds.end(); ++it) {
                    m_sub_reactors[it->first]->enqueueRoomMembership({room_id, it->second, membership_action == http::MembershipAction::Join});
                }
            }
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

void Reactor::AiReplyTask::process() {
    ConvAiTaskGuard guard(m_conversation_id, m_ai_id);
    guard.setCompletedAiMessageId(m_ai_message_id);

    const char *api_key = nullptr;
    if (m_provider == "deepseek") api_key = std::getenv("DEEPSEEK_API_KEY");
    else if (m_provider == "qwen") api_key = std::getenv("QWEN_API_KEY");
    if (!api_key || !api_key[0]) return;
    LOG_DEBUG("build ai reply json to brower");

    uint64_t chat_ai_id = m_ai_id;
    AiChatRequest ai_request{m_conversation_id, m_trigger_message_id, m_context_until_message_id, m_user_id, api_key, m_ai_model};
    function<void(AiSseData & data)> on_chunk([this](AiSseData &data) {
        this->onChunk(data);
    });
    AiClientStatus state = m_client->chat(ai_request, chat_ai_id, on_chunk);
    if (state == AiClientStatus::NoReply) {
        LOG_DEBUG("ai reply NoReply, conv=%llu ai_id=%llu model=%s provider=%s",
            m_conversation_id,
            m_ai_id,
            m_ai_model.c_str(),
            m_provider.c_str());
        return;
    } else if (state != AiClientStatus::Success) {
        static const array<const char *, 6> kStatusNames = {
            "ModelNotRegistered",
            "BuildRequestFailed",
            "NetworkError",
            "Unauthorized",
            "ServerError",
            "QuotaExceeded"};
        const char *name = (static_cast<int>(state) >= 0 && static_cast<int>(state) < kStatusNames.size())
            ? kStatusNames[static_cast<int>(state)]
            : "Unknown";
        LOG_WARN("ai reply failed, status=%s, conv=%llu ai_id=%llu model=%s provider=%s",
            name,
            m_conversation_id,
            m_ai_id,
            m_ai_model.c_str(),
            m_provider.c_str());
        if (m_send_start_frame) sendError();
        return;
    }

    MysqlPool::QueryResult ret = complete_message_content(m_ai_message_id, m_ai_reply);
    if (ret != MysqlPool::QueryResult::Success) {
        LOG_WARN("complete ai message failed, ai reply: %s", m_ai_reply.data());
        if (m_send_start_frame) sendError();
        return;
    }

    string ai_reply_end;
    json ai_reply_end_json;
    ai_reply_end_json["room_id"] = m_room_id;
    ai_reply_end_json["conversation_id"] = m_conversation_id;
    ai_reply_end_json["message_id"] = m_ai_message_id;
    ai_reply_end_json["user_id"] = m_ai_id;
    ai_reply_end_json["sender_type"] = "ai";
    ai_reply_end_json["display_name"] = m_client->display_name();
    ai_reply_end_json["avatar_url"] = m_client->avatar_url();
    ai_reply_end_json["type"] = static_cast<int>(chatdb::MessageType::TEXT);
    ai_reply_end_json["content"] = m_ai_reply;
    ai_reply_end_json["send_time_ms"] = now_ms();
    ai_reply_end_json["provider"] = m_client->provider();
    ai_reply_end_json["model"] = m_ai_model;

    json ai_json;
    ai_json["type"] = static_cast<int>(chatdb::EventType::AiStreamEnd);
    ai_json["data"] = ai_reply_end_json;
    ai_reply_end = ai_json.dump();

    broadcastAiReply(ai_reply_end);
    dispatchToOtherAis();
}

void Reactor::AiReplyTask::onChunk(AiSseData &data) {
    if (data.content.empty()) {
        if (data.total_tokens) accumulate_user_ai_tokens(m_user_id, m_ai_id, data);
        return;
    }

    m_ai_reply += data.content;

    if (!m_send_start_frame) {
        LOG_DEBUG("ai first sse, model=%s provider=%s", m_ai_model.c_str(), m_provider.c_str());

        string ai_reply_start;
        json ai_reply;
        ai_reply["room_id"] = m_room_id;
        ai_reply["conversation_id"] = m_conversation_id;
        ai_reply["message_id"] = m_ai_message_id;
        ai_reply["avatar_url"] = m_client->avatar_url();
        ai_reply["model"] = m_ai_model;
        ai_reply["send_time_ms"] = now_ms();

        json ai_json;
        ai_json["type"] = static_cast<int>(chatdb::EventType::AiStreamStart);
        ai_json["data"] = ai_reply;
        ai_reply_start = ai_json.dump();
        if (ai_reply_start.empty()) return;

        broadcastAiReply(ai_reply_start);
        m_send_start_frame = true;
    }

    string reply;
    json ai_reply;
    ai_reply["model"] = m_ai_model;
    ai_reply["content"] = data.content;

    json ai_json;
    ai_json["type"] = static_cast<int>(chatdb::EventType::AiStreamDelta);
    ai_json["data"] = ai_reply;
    reply = ai_json.dump();
    if (reply.empty()) return;

    broadcastAiReply(reply);

    if (data.total_tokens > 0) {
        accumulate_user_ai_tokens(m_user_id, m_ai_id, data);
    }
}

void Reactor::AiReplyTask::broadcastAiReply(const std::string reply) {
    string ai_frame;
    uint8_t byte0 = 0x80 | WS_TEXT;
    ai_frame.append(reinterpret_cast<char *>(&byte0), 1);
    if (reply.size() < 126) {
        uint8_t byte1 = static_cast<uint8_t>(reply.size());
        ai_frame.append(reinterpret_cast<char *>(&byte1), 1);
    } else if (reply.size() < (1 << 16)) {
        uint8_t byte1 = 126;
        ai_frame.append(reinterpret_cast<char *>(&byte1), 1);
        uint16_t payload_length = reply.size();
        uint16_t ext = htons(payload_length);
        ai_frame.append(reinterpret_cast<char *>(&ext), 2);
    } else {
        uint8_t byte1 = 127;
        ai_frame.append(reinterpret_cast<char *>(&byte1), 1);
        uint64_t payload_length = reply.size();
        uint64_t ext = htobe64(payload_length);
        ai_frame.append(reinterpret_cast<char *>(&ext), 8);
    }
    ai_frame += std::move(reply);

    shared_ptr<const string> frame = make_shared<string>(ai_frame);
    unordered_map<int, vector<int>> reactor_to_fds = ConnRoute::getInstance().queryByRoom(m_room_id);
    for (auto it = reactor_to_fds.begin(); it != reactor_to_fds.end(); ++it) {
        m_reactor.m_sub_reactors[it->first]->enqueueBroadcast({m_room_id, it->second, frame});
    }
}

void Reactor::AiReplyTask::dispatchToOtherAis() {
    if (m_round >= 2) return;

    vector<AiMemberInfo> other_ais;
    MysqlPool::QueryResult ret = get_conversation_ai_members(m_conversation_id, other_ais);
    if (ret != MysqlPool::QueryResult::Success) return;

    for (auto &member : other_ais) {
        if (member.ai_id == m_ai_id) continue;

        const char *api_key = nullptr;
        if (member.provider == "deepseek") api_key = std::getenv("DEEPSEEK_API_KEY");
        else if (member.provider == "qwen") api_key = std::getenv("QWEN_API_KEY");
        if (!api_key || !api_key[0]) continue;

        auto launcher = [reactor_ptr = &m_reactor, conv_id = m_conversation_id, user_id = m_user_id, room_id = m_room_id, ai_id = member.ai_id, provider = member.provider, model = member.model, next_round = m_round + 1](uint64_t trigger_message_id, uint64_t context_until_message_id) mutable {
            chatdb::Message ai_msg{
                conv_id,
                ai_id,
                static_cast<int>(chatdb::MessageType::TEXT),
                "",
                now_ms(),
                nullopt};
            uint64_t msg_id = 0;
            MysqlPool::QueryResult ret = insert_hidden_message(ai_msg, now_ms(), msg_id);
            if (ret != MysqlPool::QueryResult::Success) {
                ConvAiScheduler::getInstance().finish(conv_id, ai_id, nullopt);
                return;
            }
            auto task = make_unique<AiReplyTask>(
                *reactor_ptr,
                provider,
                conv_id,
                trigger_message_id,
                context_until_message_id,
                user_id,
                room_id,
                ai_id,
                model,
                msg_id,
                next_round);
            ThreadPool<Reactor::AiReplyTask>::getInstance().enqueue(std::move(task));
        };
        ConvAiScheduler::getInstance().submit(m_conversation_id, member.ai_id, m_ai_message_id, launcher, true);
    }
}

void Reactor::AiReplyTask::sendError() {
    json err;
    err["room_id"] = m_room_id;
    err["conversation_id"] = m_conversation_id;
    err["model"] = m_ai_model;

    json frame;
    frame["type"] = static_cast<int>(chatdb::EventType::AiStreamError);
    frame["data"] = err;

    broadcastAiReply(frame.dump());
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

void Reactor::room_membership_notify() {
    uint64_t val = 1;
    write(m_room_membership_notifyfd, &val, sizeof(val));
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
    for (auto it = m_conns[fd]->room_ids.begin(); it != m_conns[fd]->room_ids.end(); ++it) {
        ConnRoute::getInstance().removeRoomConn(*it, m_index, fd);
    }
    ConnRoute::getInstance().removeUserConn(m_conns[fd]->user_id, m_index, fd);
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
            LOG_WARN("ws frame protocol error, fd=%d", conn.fd);
            sendError(conn, WS_PROTOCOLERROR);
        }
        return res;
    }
    return {FrameStatus::ProtocolError, 0};
}

Reactor::AiReplyTask::AiReplyTask(Reactor &reactor, std::string &provider, uint64_t conversation_id, uint64_t trigger_message_id, uint64_t context_until_message_id, uint64_t user_id, uint64_t room_id, uint64_t ai_id, std::string ai_model, uint64_t ai_message_id, size_t round) : m_reactor(reactor), m_provider(provider), m_client(AiClient::create(m_provider)), m_conversation_id(conversation_id), m_trigger_message_id(trigger_message_id), m_context_until_message_id(context_until_message_id), m_user_id(user_id), m_room_id(room_id), m_ai_id(ai_id), m_ai_model(ai_model), m_ai_message_id(ai_message_id), m_round(round) {}
