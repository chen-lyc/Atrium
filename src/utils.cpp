#include "utils.h"
#include "logger.h"
#include "mysql_pool.h"
#include "redis_pool.h"
#include <iomanip>
#include <openssl/rand.h>
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

optional<string> url_decode(const string &s) {
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
        return RegisterResult::ServerError;
    }
    HashedPassword hp = hashed.value();
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(
        query, username,
        string(reinterpret_cast<const char *>(hp.salt.data()), hp.salt.size()),
        string(reinterpret_cast<const char *>(hp.hash.data()), hp.hash.size()));
    switch (ret) {
    case MysqlPool::QueryResult::Success:
        return RegisterResult::Success;
    case MysqlPool::QueryResult::AlreadyExists:
        return RegisterResult::UserExists;
    case MysqlPool::QueryResult::ServerError:
        return RegisterResult::ServerError;
    case MysqlPool::QueryResult::NotFound:
        return RegisterResult::ServerError;
    }
    return RegisterResult::ServerError;
}

LoginResult do_login(const string &username, const string &password) {
    vector<string> result;
    static string query = "SELECT salt, password_hash FROM users WHERE username = ?";
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(query, username, result);
    if (ret == MysqlPool::QueryResult::ServerError) {
        return LoginResult::ServerError;
    }
    if (ret == MysqlPool::QueryResult::NotFound) {
        return LoginResult::UserNotFound;
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
        return LoginResult::ServerError;
    }

    if (password_hash.size() != computed_hash.size()) {
        return LoginResult::ServerError;
    }

    if (CRYPTO_memcmp(computed_hash.data(), password_hash.data(), computed_hash.size()) != 0) {
        return LoginResult::WrongPassword;
    }

    return LoginResult::Success;
}

static std::string bytes_to_hex(const unsigned char *data, size_t len) {
    std::ostringstream oss;
    for (size_t i = 0; i < len; ++i) {
        oss << std::hex << std::setw(2) << std::setfill('0')
            << static_cast<int>(data[i]);
    }
    return oss.str();
}

SessionResult create_session(const std::string &username, string &token_out) {
    unsigned char raw[32];
    if (RAND_bytes(raw, sizeof(raw)) != 1) {
        LOG_ERROR("RAND_bytes failed in create_session");
        return SessionResult::ServerError;
    }
    std::string token = bytes_to_hex(raw, sizeof(raw));
    std::string key = "session:" + token;

    const char *argv[] = {
        "SET", key.data(), username.data(), "EX", "86400"};
    size_t argvlen[] = {3, key.size(), username.size(), 2, 5};
    int ret = RedisPool::getInstance().executeCommand(5, argv, argvlen);
    if (ret == RedisPool::CommandResult::ServerError) {
        return SessionResult::ServerError;
    }

    token_out = move(token);
    return SessionResult::Success;
}

SessionResult get_session(HttpRequest &req, string &username_out) {
    auto it = req.cookies.find("session_id");
    if (it == req.cookies.end()) {
        return SessionResult::InvalidRequest;
    }
    string &token = it->second;

    std::string key = "session:" + token;
    const char *argv[] = {"GET", key.data()};
    size_t argvlen[] = {3, key.size()};
    RedisPool::CommandResult ret = RedisPool::getInstance().executeCommand(2, argv, argvlen, username_out);
    switch (ret) {
    case RedisPool::CommandResult::Success:
        return SessionResult::Success;

    case RedisPool::CommandResult::NotFound:
        return SessionResult::TokenExpired;

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