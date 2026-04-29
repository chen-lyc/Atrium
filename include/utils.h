#pragma once

#include "http_codec.h"
#include <array>
#include <optional>
#include <string>
#include <string_view>

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

RegisterResult do_register(const std::string &username, const std::string &password);
LoginResult do_login(const std::string &username, const std::string &password);

SessionResult create_session(uint64_t user_id, const std::string &username, std::string &token_out);
SessionResult get_session(HttpRequest &req, uint64_t &user_id, std::string &username);
void destroy_session(const std::string &token);