#pragma once

#include <functional>
#include <string>
#include <string_view>

extern std::hash<std::string> hasher;

std::string escapeSqlString(std::string_view s);
std::string generateSalt(size_t len = 16);