#pragma once

#include "http_codec.h"
#include <array>
#include <optional>
#include <string>
#include <string_view>

extern std::hash<std::string> hasher;

std::string generateSessionId();

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

enum class SessionResult {
    Success,
    TokenExpired,
    InvalidRequest,
    ServerError
};

struct HashedPassword {
    std::array<unsigned char, 16> salt;
    std::array<unsigned char, 32> hash;
};

std::optional<std::string> url_decode(const std::string &s);
bool is_valid_username(const std::string &username);
bool is_valid_password(const std::string &password);
std::optional<HashedPassword> hash_password(const std::string &password);

RegisterResult do_register(const std::string &username, const std::string &password);
LoginResult do_login(const std::string &username, const std::string &password);

SessionResult create_session(const std::string &username, std::string &token_out);
SessionResult get_session(HttpRequest &req, std::string &username_out);
void destroy_session(const std::string &token);