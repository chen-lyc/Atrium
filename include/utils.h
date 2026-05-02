#pragma once

#include "http_codec.h"
#include "mysql_pool.h"
#include <array>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_set>

extern std::hash<std::string> hasher;

std::string generateSessionId();

enum class RegisterStatus {
    Success,
    UserExists,
    ServerError
};

enum class LoginStatus {
    Success,
    UserNotFound,
    WrongPassword,
    ServerError
};

enum class SessionResult {
    Success,
    TokenExpired,
    InvalidRequest,
    NetWorkError,
    ServerError
};

struct RegisterResult {
    RegisterStatus state;
    uint64_t user_id;
};

struct LoginResult {
    LoginStatus state;
    uint64_t user_id;
};

struct HashedPassword {
    std::array<unsigned char, 16> salt;
    std::array<unsigned char, 32> hash;
};

std::optional<std::string> url_decode(std::string_view s);
bool is_valid_username(const std::string &username);
bool is_valid_password(const std::string &password);
std::optional<HashedPassword> hash_password(const std::string &password);

bool get_username_and_user_id(const HttpRequest &req, std::string &username, std::string &password, std::string_view &response);
RegisterResult do_register(const std::string &username, const std::string &password);
LoginResult do_login(const std::string &username, const std::string &password);

SessionResult create_session(uint64_t user_id, const std::string &username, std::string &token_out);
SessionResult get_session(HttpRequest &req, uint64_t &user_id, std::string &username);
void destroy_session(const std::string &token);

MysqlPool::QueryResult get_conversation_ids(uint64_t user_id, std::unordered_set<uint64_t> &ids);
MysqlPool::QueryResult get_conversation_name(uint64_t conversation_id, std::string &conversatrion_name);
MysqlPool::QueryResult create_personal_chatroom(uint64_t &conversation_id, uint64_t user_id);
MysqlPool::QueryResult create_personal_chatroom(uint64_t user_id);
MysqlPool::QueryResult insert_public_chatroom(uint64_t &conversation_id, uint64_t user_id);
MysqlPool::QueryResult insert_public_chatroom(uint64_t user_id);
MysqlPool::QueryResult verify_conversation_member(uint64_t conversation_id, uint64_t user_id);

namespace chatdb {
enum class MessageType {
    TEXT = 1,
    IMAGE = 2,
    FILE = 3,
    SYSTEM = 4
};

struct Message {
    uint64_t conversation_id;
    uint64_t send_id;
    int type;
    std::string content;
    uint64_t send_time_ms;
    std::string client_message_id;
};

struct Cursor {
    uint64_t before_time_ms;
    uint64_t before_message_id;
};
} // namespace chatdb

MysqlPool::QueryResult insert_message(chatdb::Message &msg, uint64_t &message_id);
MysqlPool::QueryResult get_recent_messages(uint64_t conversation_id, std::optional<chatdb::Cursor> cursor, int limit, std::vector<std::vector<std::string>> &rows);
