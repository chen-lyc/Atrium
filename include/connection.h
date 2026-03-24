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
    std::string inbuf;
    std::string outbuf;
    bool readClosed = false;
    bool processing = false;
    bool pendingClose = false;
    bool keepAlive = true;
    ProtocolType protocol;
    std::mutex inbuf_mutex;
};
extern std::unordered_map<int, std::unique_ptr<Connection>> conns;

struct TaskResult {
    int fd;
    std::string response;
    bool shoule_broadcast = false;

    TaskResult(int f, const std::string &r, bool b) : fd(f), response(r), shoule_broadcast(b) {}
};
extern std::queue<TaskResult> ready_queue;
extern std::mutex ready_mutex;