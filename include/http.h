#pragma once

#include <string_view>

// 错误响应
inline constexpr std::string_view resp_bad_request = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
inline constexpr std::string_view resp_missing_params = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: 28\r\n\r\nmissing username or password";
inline constexpr std::string_view resp_not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";

// 注册
inline constexpr std::string_view resp_register_sussess = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 16\r\n\r\nregister success";
inline constexpr std::string_view resp_register_failed = "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: 15\r\n\r\nregister failed";

// 登入
inline constexpr std::string_view resp_login_success = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\nlogin success";
inline constexpr std::string_view resp_login_failed = "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: 12\r\n\r\nlogin failed";

// 默认响应
inline constexpr std::string_view default_response = "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHello";