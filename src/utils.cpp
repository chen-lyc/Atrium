#include "utils.h"
#include "http.h"
#include "json.hpp"
#include "logger.h"
#include "mysql_pool.h"
#include "redis_pool.h"
#include <iomanip>
#include <openssl/rand.h>
#include <optional>
#include <sstream>
using namespace std;
using json = nlohmann::json;

hash<string> hasher;

static uint64_t now_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(
        system_clock::now().time_since_epoch())
        .count();
}

string generateSessionId() {
    unsigned char buf[16];
    RAND_bytes(buf, 16);
    string s;
    s.reserve(32);
    static const char hex[] = "0123456789abcdef";
    for (int i = 0; i < 16; i++) {
        s += hex[buf[i] >> 4];
        s += hex[buf[i] & 0x0f];
    }
    return s;
}

int hex_char_to_int(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

optional<string> url_decode(string_view s) {
    string decoded;
    decoded.reserve(s.size());
    for (size_t i = 0; i < s.size();) {
        if (s[i] == '%') {
            if (i + 2 >= s.size()) return nullopt;
            int high = hex_char_to_int(s[i + 1]);
            int low = hex_char_to_int(s[i + 2]);
            if (high < 0 || low < 0) return nullopt;
            int byte = (high << 4) | low;
            decoded += static_cast<char>(byte);
            i += 3;
        } else if (s[i] == '+') {
            decoded += ' ';
            i++;
        } else {
            decoded += s[i];
            i++;
        }
    }
    return decoded;
}

bool is_valid_username(const string &username) {
    if (username.size() < 1 || username.size() > 32) {
        return false;
    }

    for (unsigned char c : username) {
        if (c < 0x20 || c == 0x7F) {
            return false;
        }
    }
    return true;
}

bool is_valid_password(const std::string &password) {
    if (password.size() < 1 || password.size() > 64) {
        return false;
    }

    for (unsigned char c : password) {
        if (c < 0x20 || c == 0x7F) {
            return false;
        }
    }
    return true;
}

optional<HashedPassword> hash_password(const string &password) {
    HashedPassword hp{};
    if (RAND_bytes(hp.salt.data(), hp.salt.size()) <= 0) {
        return nullopt;
    }

    if (PKCS5_PBKDF2_HMAC(password.data(), password.size(), hp.salt.data(), hp.salt.size(), 100000, EVP_sha256(), hp.hash.size(), hp.hash.data()) <= 0) {
        return nullopt;
    }

    return hp;
}

bool get_username_and_user_id(const HttpRequest &req, string &username, string &password, string_view &response) {
    response = {};
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
                return false;
            }

            size_t end = req.body.find('&', eq_pos + 1);
            if (end == string::npos) end = req.body.size();
            string_view key(req.body.data() + start, eq_pos - start);
            start = eq_pos + 1;
            string_view value(req.body.data() + start, end - start);
            start = end + 1;
            if (key == username_key) {
                if (++username_count > 1) {
                    return false;
                }
                username_value = value;
            } else if (key == password_key) {
                if (++password_count > 1) {
                    return false;
                }
                password_value = value;
            }
        }

        if (username_count == 0 || password_count == 0) {
            LOG_DEBUG("register request not have username or password");
            response = resp_missing_params;
            return false;
        }

        optional<string> username_result = url_decode(username_value);
        optional<string> password_result = url_decode(password_value);
        if (!username_result.has_value() || !password_result.has_value()) {
            response = resp_invalid_encode;
            return false;
        }

        username = std::move(username_result.value());
        password = std::move(password_result.value());
    } else if (req.content_type == "application/json") {
        try {
            json in = json::parse(req.body);
            if (!in.contains("username") || !in["username"].is_string() || !in.contains("password") || !in["password"].is_string()) {
                return false;
            }
            username = in["username"].get<string>();
            password = in["password"].get<string>();

            if (username.empty() || password.empty()) {
                return false;
            }
        } catch (const exception &e) {
            LOG_WARN("json request in login or register error, reason = %s", e.what());
            return false;
        }
    } else {
        response = resp_unsupported_media_type;
        return false;
    }

    if (!is_valid_username(username)) {
        response = resp_invalid_username;
        return false;
    }
    if (!is_valid_password(password)) {
        response = resp_invalid_password;
        return false;
    }
    return true;
}

RegisterResult do_register(const string &username, const string &password) {
    static const string sql = "INSERT INTO users (username, salt, password_hash) VALUES (?, ?, ?)";
    optional<HashedPassword> hashed = hash_password(password);
    if (!hashed.has_value()) {
        return {RegisterStatus::ServerError, 0};
    }
    HashedPassword &hp = hashed.value();
    MysqlPool::MysqlParams params{username,
        MysqlPool::Blob{reinterpret_cast<const char *>(hp.salt.data()), hp.salt.size()},
        MysqlPool::Blob{reinterpret_cast<const char *>(hp.hash.data()), hp.hash.size()}};
    uint64_t user_id = 0;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, &user_id);
    switch (ret) {
    case MysqlPool::QueryResult::Success:
        return {RegisterStatus::Success, user_id};
    case MysqlPool::QueryResult::AlreadyExists:
        return {RegisterStatus::UserExists, 0};
    default:
        return {RegisterStatus::ServerError, 0};
    }
    return {RegisterStatus::ServerError, 0};
}

LoginResult do_login(const string &username, const string &password) {
    static const string sql = "SELECT id, salt, password_hash FROM users WHERE username = ?";
    MysqlPool::MysqlParams params{username};
    vector<vector<string>> result;
    size_t col_count = 3;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, result, col_count);
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {LoginStatus::ServerError, 0};
    }
    if (ret == MysqlPool::QueryResult::NotFound) {
        LOG_DEBUG("login: user not found");
        return {LoginStatus::UserNotFound, 0};
    }

    uint64_t user_id;
    try {
        user_id = stoull(result[0][0]);
    } catch (const exception &e) {
        LOG_WARN("parsee user_id failed: value = %s, reason = %s", result[0][0].data(), e.what());
        return {LoginStatus::ServerError, 0};
    }
    string &salt = result[0][1];
    string &password_hash = result[0][2];

    array<unsigned char, 32> computed_hash;
    if (PKCS5_PBKDF2_HMAC(password.data(), password.size(), reinterpret_cast<const unsigned char *>(salt.data()), salt.size(), 100000, EVP_sha256(), computed_hash.size(), computed_hash.data()) != 1) {
        return {LoginStatus::ServerError, 0};
    }

    if (password_hash.size() != computed_hash.size()) {
        return {LoginStatus::ServerError, 0};
    }

    if (CRYPTO_memcmp(computed_hash.data(), password_hash.data(), computed_hash.size()) != 0) {
        return {LoginStatus::WrongPassword, 0};
    }

    return {LoginStatus::Success, user_id};
}

static const std::string bytes_to_hex(const unsigned char *data, size_t len) {
    std::ostringstream oss;
    for (size_t i = 0; i < len; ++i) {
        oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(data[i]);
    }
    return oss.str();
}

SessionResult create_session(uint64_t user_id, const std::string &username, string &token_out) {
    unsigned char raw[32];
    if (RAND_bytes(raw, sizeof(raw)) != 1) {
        LOG_ERROR("RAND_bytes failed in create_session");
        return SessionResult::ServerError;
    }
    std::string token = bytes_to_hex(raw, sizeof(raw));
    std::string key = "session:" + token;
    string user_id_str = to_string(user_id);

    const char *argv[] = {
        "HSET",
        key.data(),
        "user_id",
        user_id_str.data(),
        "username",
        username.data()};
    size_t argvlen[] = {4, key.size(), 7, user_id_str.size(), 8, username.size()};
    RedisPool::CommandResult ret = RedisPool::getInstance().executeCommand(6, argv, argvlen);
    if (ret == RedisPool::CommandResult::ServerError) {
        return SessionResult::ServerError;
    }

    const char *timeout_argv[] = {"EXPIRE", key.data(), "86400"};
    size_t timeout_argvlen[] = {6, key.size(), 5};
    ret = RedisPool::getInstance().executeCommand(3, timeout_argv, timeout_argvlen);
    if (ret == RedisPool::CommandResult::ServerError) {
        return SessionResult::ServerError;
    }

    token_out = std::move(token);
    return SessionResult::Success;
}

SessionResult get_session(HttpRequest &req, uint64_t &user_id, string &username) {
    auto it = req.cookies.find("session_id");
    if (it == req.cookies.end()) {
        return SessionResult::InvalidRequest;
    }
    string &token = it->second;

    vector<optional<string>> values;
    std::string key = "session:" + token;
    const char *argv[] = {"HGETALL", key.data()};
    size_t argvlen[] = {7, key.size()};
    RedisPool::CommandResult ret = RedisPool::getInstance().executeCommand(2, argv, argvlen, values);
    switch (ret) {
    case RedisPool::CommandResult::Success: {
        if (!values.empty() && values.size() % 2) return SessionResult::ServerError;

        bool find_user_id = false, find_username = false;
        for (size_t i = 0; i < values.size(); i += 2) {
            if (values[i].value() == "user_id") {
                if (!values[i + 1].has_value()) return SessionResult::ServerError;
                try {
                    user_id = stoull(values[i + 1].value());
                    find_user_id = true;
                } catch (const exception &e) {
                    LOG_WARN("get_session parse user_id failed: value = %s, error = %s",
                        values[i + 1].value().data(),
                        e.what());
                    return SessionResult::ServerError;
                }
            } else if (values[i].value() == "username") {
                if (!values[i + 1].has_value()) return SessionResult::ServerError;
                username = std::move(values[i + 1].value());
                find_username = true;
            }
        }
        if (find_user_id && find_username) return SessionResult::Success;

        return SessionResult::ServerError;
    }

    case RedisPool::CommandResult::NotFound:
        return SessionResult::TokenExpired;
    case RedisPool::CommandResult::CommandError:
        return SessionResult::ServerError;
    case RedisPool::CommandResult::NetWorkError:
        return SessionResult::NetWorkError;
    case RedisPool::CommandResult::UnexpectedType:
        return SessionResult::ServerError;
    case RedisPool::CommandResult::ServerError:
        return SessionResult::ServerError;
    }
    return SessionResult::ServerError;
}

void destroy_session(const std::string &token) {
    std::string key = "session:" + token;
    const char *argv[] = {"DEL", key.data()};
    size_t argvlen[] = {3, key.size()};
    RedisPool::getInstance().executeCommand(2, argv, argvlen);
}

MysqlPool::QueryResult get_room_ids(uint64_t user_id, std::vector<uint64_t> &ids) {
    static const string sql = "SELECT room_id FROM room_members where user_id = ?";
    MysqlPool::MysqlParams params{user_id};
    vector<vector<string>> result;
    size_t col_count = 1;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, result, col_count);
    if (ret == MysqlPool::QueryResult::ServerError || ret == MysqlPool::QueryResult::NotFound) {
        return ret;
    }

    for (size_t i = 0; i < result.size(); ++i) {
        try {
            ids.emplace_back(stoull(result[i][0]));
        } catch (const exception &e) {
            LOG_WARN("parse room_id failed: room_id = %s, reason = %s", result[i][0].data(), e.what());
            return MysqlPool::QueryResult::ServerError;
        }
    }
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult get_room_ids(uint64_t user_id, std::unordered_set<uint64_t> &ids) {
    static const string sql = "SELECT room_id FROM room_members where user_id = ?";
    MysqlPool::MysqlParams params{user_id};
    vector<vector<string>> result;
    size_t col_count = 1;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, result, col_count);
    if (ret == MysqlPool::QueryResult::ServerError || ret == MysqlPool::QueryResult::NotFound) {
        return ret;
    }

    for (size_t i = 0; i < result.size(); ++i) {
        try {
            ids.emplace(stoull(result[i][0]));
        } catch (const exception &e) {
            LOG_WARN("parse room_id failed: room_id = %s, reason = %s", result[i][0].data(), e.what());
            return MysqlPool::QueryResult::ServerError;
        }
    }
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult get_room_data(uint64_t room_id, string &room_name, uint64_t &main_conversation_id) {
    static const string sql = "SELECT name, main_conversation_id FROM rooms WHERE id = ?";
    MysqlPool::MysqlParams params{room_id};
    vector<vector<string>> result;
    size_t col_count = 2;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, result, col_count);
    if (ret == MysqlPool::QueryResult::ServerError || ret == MysqlPool::QueryResult::NotFound) {
        return MysqlPool::QueryResult::ServerError;
    }

    room_name = std::move(result[0][0]);
    try {
        main_conversation_id = stoull(result[0][1]);
    } catch (const exception &e) {
        LOG_WARN("parse main_conversation_id failed: value = %s, reason = %s", result[0][1].data(), e.what());
        return MysqlPool::QueryResult::ServerError;
    }
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult create_personal_chatroom(uint64_t &room_id, uint64_t &main_conversation_id, uint64_t user_id) {
    uint64_t time_ms = now_ms();
    main_conversation_id = 0;
    static const string sql = "INSERT INTO rooms (name, main_conversation_id, owner_id, created_at_ms) VALUES (?, ?, ?, ?)";
    MysqlPool::MysqlParams params{string("我的个人讨论室"), main_conversation_id, user_id, time_ms};
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, &room_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return MysqlPool::QueryResult::ServerError;
    }
    static const string cm_sql = "INSERT INTO room_members (room_id, user_id, role, join_at_ms) VALUES (?, ?, ?, ?)";
    params = {room_id, user_id, 0, now_ms()};
    ret = MysqlPool::getInstance().executeQuery(cm_sql, params);
    if (ret != MysqlPool::QueryResult::Success) {
        return MysqlPool::QueryResult::ServerError;
    }

    ret = create_conversation(room_id, user_id, main_conversation_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return MysqlPool::QueryResult::ServerError;
    }

    static const string up_sql = "UPDATE rooms SET main_conversation_id = ? WHERE id = ?";
    params = {main_conversation_id, room_id};
    ret = MysqlPool::getInstance().executeQuery(up_sql, params);
    if (ret != MysqlPool::QueryResult::Success) {
        return MysqlPool::QueryResult::ServerError;
    }
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult create_personal_chatroom(uint64_t &room_id, uint64_t user_id) {
    uint64_t main_conversation_id = 0;
    return create_personal_chatroom(room_id, main_conversation_id, user_id);
}

MysqlPool::QueryResult create_personal_chatroom(uint64_t user_id) {
    uint64_t room_id = 0;
    uint64_t main_conversation_id = 0;
    return create_personal_chatroom(room_id, main_conversation_id, user_id);
}

MysqlPool::QueryResult insert_public_chatroom(uint64_t &room_id, uint64_t &main_conversation_id, uint64_t user_id) {
    room_id = 1;
    main_conversation_id = 1;
    return insert_public_chatroom(user_id);
}

MysqlPool::QueryResult insert_public_chatroom(uint64_t &room_id, uint64_t user_id) {
    room_id = 1;
    return insert_public_chatroom(user_id);
}

MysqlPool::QueryResult insert_public_chatroom(uint64_t user_id) {
    static const string sql = "INSERT INTO room_members (room_id, user_id, role, join_at_ms) VALUES (1, ?, 2, ?)";
    MysqlPool::MysqlParams params{user_id, now_ms()};
    return MysqlPool::getInstance().executeQuery(sql, params);
}

MysqlPool::QueryResult create_conversation(uint64_t room_id, uint64_t created_by, uint64_t &conversation_id) {
    static const string sql =
        "INSERT INTO conversations (room_id, title, created_by, created_at_ms) "
        "VALUES (?, '个人讨论室', ?, ?)";
    MysqlPool::MysqlParams params{room_id, created_by, now_ms()};
    return MysqlPool::getInstance().executeQuery(sql, params, &conversation_id);
}

MysqlPool::QueryResult get_room_from_conversations(uint64_t &room_id, uint64_t conversation_id) {
    static const string sql = "SELECT room_id FROM conversations WHERE id = ?";
    MysqlPool::MysqlParams params{conversation_id};
    vector<vector<string>> rows;
    size_t col_count = 1;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, rows, col_count);
    if (ret != MysqlPool::QueryResult::Success) {
        return ret;
    }
    if (rows.empty() || rows[0].empty()) {
        return MysqlPool::QueryResult::ServerError;
    }
    try {
        room_id = stoull(rows[0][0]);
    } catch (const exception &e) {
        LOG_WARN("parse room_id in verify_conversation_member failed, value = %s, reason = %s",
            rows[0][0].data(),
            e.what());
        return MysqlPool::QueryResult::ServerError;
    }
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult verify_room_member(uint64_t room_id, uint64_t user_id) {
    static const string sql =
        "SELECT EXISTS ("
        "SELECT 1 FROM room_members "
        "WHERE  room_id = ? AND user_id = ?)";

    MysqlPool::MysqlParams params{room_id, user_id};
    vector<vector<string>> rows;
    size_t col_count = 1;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, rows, col_count);
    if (ret != MysqlPool::QueryResult::Success) {
        return ret;
    }
    if (rows.empty() || rows[0].empty()) {
        return MysqlPool::QueryResult::ServerError;
    }
    if (rows[0][0] != "1") {
        return MysqlPool::NotFound;
    }
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult verify_conversation_member(uint64_t conversation_id, uint64_t user_id) {
    uint64_t room_id = 0;
    MysqlPool::QueryResult ret = get_room_from_conversations(room_id, conversation_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return ret;
    }
    return verify_room_member(room_id, user_id);
}

MysqlPool::QueryResult get_list_conversations_by_room_id(uint64_t room_id, std::vector<uint64_t> &ids, std::vector<std::string> &titles) {
    static const string sql = "SELECT id, title FROM conversations WHERE room_id = ?";
    MysqlPool::MysqlParams params{room_id};
    vector<vector<string>> rows;
    size_t col_count = 2;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, rows, col_count);
    if (ret != MysqlPool::QueryResult::Success) {
        return MysqlPool::QueryResult::ServerError;
    }
    for (size_t i = 0; i < rows.size(); ++i) {
        try {
            ids.emplace_back(stoull(rows[i][0]));
            titles.emplace_back(rows[i][1]);
        } catch (const exception &e) {
            LOG_WARN("parse conversations data failed: reason = %s", e.what());
            return MysqlPool::QueryResult::ServerError;
        }
    }
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult insert_message(chatdb::Message &msg, uint64_t &message_id) {
    static const string sql =
        "INSERT INTO messages (conversation_id, send_id, type, content, send_time_ms, "
        "client_message_id) VALUES (?, ?, ?, ?, ?, ?)";
    MysqlPool::MysqlParams params{msg.conversation_id, msg.send_id, msg.type, msg.content, msg.send_time_ms, msg.client_message_id};
    return MysqlPool::getInstance().executeQuery(sql, params, &message_id);
}

MysqlPool::QueryResult get_recent_messages(uint64_t conversation_id, std::optional<chatdb::Cursor> cursor, int limit, std::vector<std::vector<std::string>> &rows) {
    static const string first_page_sql =
        "SELECT id, send_id, type, content, send_time_ms FROM messages "
        "WHERE conversation_id = ? "
        "ORDER BY send_time_ms DESC, id DESC LIMIT ?";
    static const string before_cursor_sql =
        "SELECT id, send_id, type, content, send_time_ms FROM messages "
        "WHERE conversation_id = ? AND (send_time_ms, id) < (?, ?) "
        "ORDER BY send_time_ms DESC, id DESC LIMIT ?";

    size_t col_count = 5;
    if (cursor == nullopt) {
        MysqlPool::MysqlParams params{conversation_id, limit};
        return MysqlPool::getInstance().executeQuery(first_page_sql, params, rows, col_count);
    } else if (cursor.has_value()) {
        MysqlPool::MysqlParams params{conversation_id, cursor->before_time_ms, cursor->before_message_id, limit};
        return MysqlPool::getInstance().executeQuery(before_cursor_sql, params, rows, col_count);
    }
    return MysqlPool::QueryResult::SqlError;
}
