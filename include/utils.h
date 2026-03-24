#pragma once

#include <functional>
#include <string>

extern std::hash<std::string> hasher;

std::string escapeSqlString(const std::string &s);
std::string generateSalt(int len = 16);