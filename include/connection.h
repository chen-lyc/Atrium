#pragma once

#include <cstdint>
#include <string>
#include <unordered_set>

enum ProtocolType {
    PROTO_HTTP,
    PROTO_BINARY,
    PROTO_WEBSOCKET
};

struct Connection {
    int fd;
    int file_fd = -1;
    size_t file_size = 0;
    off_t file_offset = 0;
    uint64_t user_id = 0;
    std::string username;
    std::unordered_set<uint64_t> conversation_ids;
    std::string inbuf;
    std::string outbuf;
    bool readClosed = false;
    bool keepAlive = true;
    bool shouldClose = false;
    ProtocolType protocol;
};