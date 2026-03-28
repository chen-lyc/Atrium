#include "utils.h"
using namespace std;

hash<string> hasher;

string escapeSqlString(string_view s) {
    string result;
    result.reserve(s.size() * 2);

    for (char c : s) {
        if (c == '\'') {
            result += "''";
        } else {
            result += c;
        }
    }
    return result;
}

string generateSalt(size_t len) {
    static const char charset[] = "abcdefghijklmnopqrstuvwxyz0123456789";
    string salt;
    salt.reserve(len);
    srand(time(nullptr));
    for (int i = 0; i < len; i++) {
        salt += charset[rand() % (sizeof(charset) - 1)];
    }
    return salt;
}