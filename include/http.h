#pragma once

#include <string_view>

// 错误响应
inline constexpr std::string_view resp_bad_request = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
inline constexpr std::string_view resp_missing_params = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: 28\r\n\r\nmissing username or password";
inline constexpr std::string_view resp_not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
inline constexpr std::string_view resp_unauthorized = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n";
inline constexpr std::string_view resp_user_exists = "HTTP/1.1 409 Conflict\r\nContent-Type: text/plain\r\nContent-Length: 23\r\n\r\nusername already exists";
inline constexpr std::string_view resp_wrong_password = "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: 14\r\n\r\nwrong password";
inline constexpr std::string_view resp_user_not_found = "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: 14\r\n\r\nuser not found";
inline constexpr std::string_view resp_server_error = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n";

// 注册
inline constexpr std::string_view resp_header_register_sussess = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 16\r\n";

// 登入
inline constexpr std::string_view resp_header_login_success = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n";

// 默认响应
inline constexpr std::string_view default_response = "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHello";

inline constexpr std::string_view websocket_magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";