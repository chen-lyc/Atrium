#pragma once

#include <condition_variable>
#include <memory>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

template <typename T>
class ThreadPool {
  public:
    ThreadPool(size_t threadnum = 8, size_t max_requests = 10000);
    ~ThreadPool();
    void shutDown();
    bool enqueue(std::unique_ptr<T> request);

  private:
    void worker();

  private:
    size_t m_max_requests;
    std::vector<std::thread> threads;
    std::mutex m_mutex;
    std::condition_variable m_cond;
    std::queue<std::unique_ptr<T>> m_workqueue;
    bool m_stop = false;
};

#include "thread_pool.tpp"