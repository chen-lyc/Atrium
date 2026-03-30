#pragma once

#include <string>

enum ProtocolType {
    PROTO_HTTP,
    PROTO_BINARY
};

struct Connection {
    int fd;
    int file_fd = 0;
    size_t file_size;
    std::string inbuf;
    std::string outbuf;
    bool readClosed = false;
    bool keepAlive = true;
    ProtocolType protocol;
};