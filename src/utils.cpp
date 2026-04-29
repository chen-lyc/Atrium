#include "utils.h"
#include "logger.h"
#include "mysql_pool.h"
#include "redis_pool.h"
#include <iomanip>
#include <openssl/rand.h>
#include <optional>
#include <sstream>
using namespace std;

hash<string> hasher;

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

    if (PKCS5_PBKDF2_HMAC(
            password.data(), password.size(),
            hp.salt.data(), hp.salt.size(),
            100000,
            EVP_sha256(),
            hp.hash.size(), hp.hash.data()) <= 0) {
        return nullopt;
    }

    return hp;
}

RegisterResult do_register(const string &username, const string &password) {
    static string query = "INSERT INTO users (username, salt, password_hash) VALUES (?, ?, ?)";
    optional<HashedPassword> hashed = hash_password(password);
    if (!hashed.has_value()) {
        return {RegisterStatus::ServerError, 0};
    }
    uint64_t user_id = 0;
    HashedPassword hp = hashed.value();
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(
        query, username,
        string(reinterpret_cast<const char *>(hp.salt.data()), hp.salt.size()),
        string(reinterpret_cast<const char *>(hp.hash.data()), hp.hash.size()),
        user_id);
    switch (ret) {
    case MysqlPool::QueryResult::Success:
        return {RegisterStatus::Success, user_id};
    case MysqlPool::QueryResult::AlreadyExists:
        return {RegisterStatus::UserExists, 0};
    case MysqlPool::QueryResult::ServerError:
        return {RegisterStatus::ServerError, 0};
    case MysqlPool::QueryResult::NotFound:
        return {RegisterStatus::ServerError, 0};
    }
    return {RegisterStatus::ServerError, 0};
}

LoginResult do_login(const string &username, const string &password) {
    vector<string> result;
    uint64_t user_id = 0;
    static string query = "SELECT id, salt, password_hash FROM users WHERE username = ?";
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(query, username, result, user_id);
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {LoginStatus::ServerError, 0};
    }
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {LoginStatus::UserNotFound, 0};
    }

    string &salt = result[0];
    string &password_hash = result[1];

    array<unsigned char, 32> computed_hash;
    if (PKCS5_PBKDF2_HMAC(
            password.data(), password.size(),
            reinterpret_cast<const unsigned char *>(salt.data()), salt.size(),
            100000,
            EVP_sha256(),
            computed_hash.size(), computed_hash.data()) != 1) {
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

static std::string bytes_to_hex(const unsigned char *data, size_t len) {
    std::ostringstream oss;
    for (size_t i = 0; i < len; ++i) {
        oss << std::hex << std::setw(2) << std::setfill('0')
            << static_cast<int>(data[i]);
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
        "HSET", key.data(),
        "user_id", user_id_str.data(),
        "username", username.data()};
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

    token_out = move(token);
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
                username = move(values[i + 1].value());
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