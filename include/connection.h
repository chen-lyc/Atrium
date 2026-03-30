#pragma once

#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <unordered_map>

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

struct TaskResult {
    int fd;
    int file_fd = 0;
    size_t file_size;
    std::string response;
    bool should_broadcast = false;

    TaskResult(int f, std::string r, bool b = false) : fd(f), response(std::move(r)), should_broadcast(b) {}
    TaskResult(int f, int ff, size_t fz, std::string r) : fd(f), file_fd(ff), file_size(fz), response(std::move(r)) {}
};
extern std::queue<TaskResult> ready_queue;
extern std::mutex ready_mutex;