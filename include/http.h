#pragma once

#include <string_view>

// 通用 HTTP 响应
inline constexpr std::string_view resp_bad_request =
    "HTTP/1.1 400 Bad Request\r\n"
    "Content-Length: 0\r\n"
    "Connection: close\r\n"
    "\r\n";

inline constexpr std::string_view resp_api_not_found =
    "HTTP/1.1 404 Not Found\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 19\r\n"
    "\r\n"
    "api route not found";

inline constexpr std::string_view resp_not_found =
    "HTTP/1.1 404 Not Found\r\n"
    "Content-Length: 0\r\n"
    "\r\n";

inline constexpr std::string_view resp_unauthorized =
    "HTTP/1.1 401 Unauthorized\r\n"
    "Content-Length: 0\r\n"
    "\r\n";

inline constexpr std::string_view resp_server_error =
    "HTTP/1.1 500 Internal Server Error\r\n"
    "Content-Length: 0\r\n"
    "\r\n";

inline constexpr std::string_view resp_unsupported_media_type =
    "HTTP/1.1 415 Unsupported Media Type\r\n"
    "Content-Length: 0\r\n"
    "\r\n";

// 认证/API 文本响应
inline constexpr std::string_view resp_missing_params =
    "HTTP/1.1 400 Bad Request\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 28\r\n"
    "\r\n"
    "missing username or password";

inline constexpr std::string_view resp_user_exists =
    "HTTP/1.1 409 Conflict\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 23\r\n"
    "\r\n"
    "username already exists";

inline constexpr std::string_view resp_wrong_password =
    "HTTP/1.1 401 Unauthorized\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 14\r\n"
    "\r\n"
    "wrong password";

inline constexpr std::string_view resp_user_not_found =
    "HTTP/1.1 401 Unauthorized\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 14\r\n"
    "\r\n"
    "user not found";

inline constexpr std::string_view resp_invalid_username =
    "HTTP/1.1 400 Bad Request\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 16\r\n"
    "\r\n"
    "invalid_username";

inline constexpr std::string_view resp_invalid_password =
    "HTTP/1.1 400 Bad Request\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 16\r\n"
    "\r\n"
    "invalid_password";

inline constexpr std::string_view resp_invalid_encode =
    "HTTP/1.1 400 Bad Request\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 14\r\n"
    "\r\n"
    "invalid_encode";

// 默认响应
inline constexpr std::string_view default_response =
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: 5\r\n"
    "\r\n"
    "Hello";

// WebSocket
inline constexpr std::string_view websocket_magic =
    "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
