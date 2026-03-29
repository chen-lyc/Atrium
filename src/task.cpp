#include "task.h"
#include "connection.h"
#include "epoll_utils.h"
#include "http.h"
#include "http_codec.h"
#include "logger.h"
#include "message.pb.h"
#include "mysql_pool.h"
#include "protobuf_codec.h"
#include "protocol.h"
#include "redis_pool.h"
#include "utils.h"
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
using namespace std;

void Task::process() {
    {
        string msg;
        msg.reserve(128);
        msg += "Task processing fd = ";
        msg += to_string(m_conn.fd);
        msg += " by thread ";
        msg += to_string(pthread_self());
        LOG_INFO(msg);
    }

    // 模拟耗时操作
    // this_thread::sleep_for(chrono::milliseconds(500));

    string request = getCompleteRequestSnapshot(m_conn);

    while (!request.empty()) {
        string response;

        int file_fd;
        size_t file_size;
        bool should_broadcast;

        {
            string msg;
            msg.reserve(32 + request.size());
            msg += "fd = ";
            msg += to_string(m_conn.fd);
            msg += " send data : ";
            msg += request;
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

        if (m_conn.protocol == PROTO_HTTP) {
            HttpRequest req;
            ParseState ret = parseHttpRequest(request, req);
            end_pos = req.end_pos;
            response.reserve(256 + req.body.size());

            LOG_DEBUG("request is HTTP and method is " + req.method + ", target is " + req.target + ", version is " + req.version);

            if (ret == PARSE_ERROR) {
                LOG_INFO("HTTP parse failed, fd = " + to_string(m_conn.fd));
                response = error_response;
            } else if (req.target == "/echo") {
                response += "HTTP/1.1 200 OK\r\nContent-Length: ";
                response += to_string(req.body.size());
                response += "\r\n\r\n";
                response += req.body;
            } else if (req.target == "/register" || req.target == "/login") {
                LOG_DEBUG("HTTP request register or login");

                static constexpr string_view username_key = "username=";
                size_t username_value_pos = req.body.find(username_key);

                static constexpr string_view password_key = "password=";
                size_t password_value_pos = req.body.find(password_key);

                if (username_value_pos == string::npos || password_value_pos == string::npos) {
                    LOG_WARN("register request not have username or password");
                    response = "HTTP/1.1 400 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: 28\r\n\r\nmissing username or password";
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
                            response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 16\r\n\r\nregister success";
                        } else {
                            response = "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: 15\r\n\r\nregister failed";
                        }
                    } else {
                        int ret = do_login(username, password);

                        if (ret) {
                            response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\nlogin success";
                        } else {
                            response = "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: 12\r\n\r\nlogin failed";
                        }
                    }
                }
            } else if (req.method == "GET") {
                string file_path = "static" + req.target;
                if (req.target == "/") file_path = "static/index.html";
                LOG_INFO("file path is " + file_path);
                file_fd = open(file_path.c_str(), O_RDONLY);
                if (file_fd == -1) {
                    response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                } else {
                    struct stat st;
                    fstat(file_fd, &st);
                    file_size = st.st_size;

                    string body(file_size, '\0');
                    read(file_fd, body.data(), file_size);

                    response += "HTTP/1.1 200 OK\r\nContent-Length: ";
                    response += to_string(file_size);
                    response += "\r\n\r\n";
                    response += body;
                    close(file_fd);
                }
            } else {
                response = default_response;
            }

            if (req.version == "HTTP/1.0" || req.connection == "close") {
                m_conn.keepAlive = false;
            }
        } else {
            ProtobufRequest req;
            MessageType ret = parseProtobufMessage(request, req);
            end_pos = req.end_pos;
            response.reserve(256);

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

            auto buildResponse = [&response](ResponseKind kind, const string &msg, const string &sender_name = "") {
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

                response.append(reinterpret_cast<char *>(&msg_type), 4);
                response.append(reinterpret_cast<char *>(&msg_length), 4);
                response.append(data);
            };

            if (ret == MSG_ERROR) {
                LOG_INFO("protobuf parse failed, fd = " + to_string(m_conn.fd));

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

        {
            lock_guard<mutex> lock(ready_mutex);
            if (should_broadcast) {
                ready_queue.emplace(m_conn.fd, move(response), should_broadcast);
            } else if (file_fd) {
                ready_queue.emplace(m_conn.fd, file_fd, file_size, move(response));
            } else {
                ready_queue.emplace(m_conn.fd, move(response));
            }
            LOG_DEBUG("enqueue readyQueue");
        }

        {
            lock_guard<mutex> lock(m_conn.inbuf_mutex);
            m_conn.inbuf.erase(m_conn.inbuf.begin(), m_conn.inbuf.begin() + end_pos);
        }

        request = getCompleteRequestSnapshot(m_conn);
    }

    uint64_t val = 1;
    write(notifyfd, &val, sizeof(val));
}

ThreadPool<Task> thread_pool(4);