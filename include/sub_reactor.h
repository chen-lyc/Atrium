#pragma once

#include "connection.h"
#include "memory_pool.h"
#include "timerheap.h"
#include <atomic>
#include <memory>
#include <protocol_frame.h>
#include <queue>
#include <sys/eventfd.h>
#include <thread>
#include <unordered_map>

class Reactor {
  public:
    Reactor(int index, std::vector<std::unique_ptr<Reactor>> &sub_reactors, size_t num_memory = 100);
    ~Reactor();
    void addConnection(int fd, ProtocolType protocol);
    void enqueueBroadcast(std::shared_ptr<const std::string> frame);
    void shutDown();

  private:
    void loop();
    void conn_notify();
    void broadcast_notify();
    void addfd(int fd);
    void modfd(int fd, uint32_t events);
    void trySend(Connection &conn, bool should_mod = true);
    void closeFile(Connection &conn);
    void closeNow(int fd);
    void process(Connection &conn);
    FrameResult checkFrame(Connection &conn);
    std::string_view getMimeType(const std::string &file_path);
    bool sendError(Connection &conn, std::string_view resp, uint64_t end_pos = 0);
    void sendError(Connection &conn, uint16_t close_code);

  private:
    int m_index;
    int m_epollfd;
    int m_conn_notifyfd;
    int m_broadcast_notifyfd;
    std::vector<std::unique_ptr<Reactor>> &m_sub_reactors;
    std::queue<std::pair<int, ProtocolType>> m_conn_queue;
    std::mutex m_queue_mutex;
    std::queue<std::shared_ptr<const std::string>> m_broadcast_queue;
    std::mutex m_broadcast_mutex;
    TimerHeap m_timer_heap;
    MemoryPool m_conn_pool;
    std::unordered_map<int, std::unique_ptr<Connection, ConnDeleter>> m_conns;
    std::thread m_thread;
    std::atomic<bool> m_running{true};
};