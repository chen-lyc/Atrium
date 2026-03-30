#pragma once

#include "connection.h"
#include "timerheap.h"
#include <atomic>
#include <memory>
#include <queue>
#include <sys/eventfd.h>
#include <thread>
#include <unordered_map>

class Reactor {
  public:
    Reactor(int index);
    ~Reactor();
    void addConnection(int fd, ProtocolType protocol);
    void shutDown();

  private:
    void loop();
    void notify();
    void addfd(int fd);
    void modfd(int fd, uint32_t events);
    void trySend(Connection &conn);
    void closeNow(int fd);
    void process(Connection &conn);

  private:
    int m_index;
    int m_epollfd;
    int m_notifyfd;
    std::queue<std::pair<int, ProtocolType>> m_conn_queue;
    std::mutex m_queue_mutex;
    TimerHeap m_timer_heap;
    std::unordered_map<int, std::unique_ptr<Connection>> m_conns;
    std::thread m_thread;
    std::atomic<bool> m_running{true};
};