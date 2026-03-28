#pragma once

#include <string>
#include <string_view>

inline constexpr std::string_view error_response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";

extern const std::string body;
extern const std::string default_response;