#include "thread_pool.h"
using namespace std;

template <typename T>
ThreadPool<T>::ThreadPool(int threadnum, int max_requests) : m_max_requests(max_requests), m_stop(false) {
    for (int i = 0; i < threadnum; i++) {
        threads.emplace_back([this] { worker(); });
    }
}

template <typename T>
ThreadPool<T>::~ThreadPool() {
    {
        lock_guard<mutex> lock(m_mutex);
        m_stop = true;
    }
    m_cond.notify_all();
    for (auto &t : threads) {
        if (t.joinable()) {
            t.join();
        }
    }
}
template <typename T>
bool ThreadPool<T>::enqueue(unique_ptr<T> request) {
    {
        lock_guard<mutex> lock(m_mutex);
        if (m_workqueue.size() >= m_max_requests) {
            return false;
        }
        m_workqueue.emplace(move(request));
    }
    m_cond.notify_one();
    return true;
}

template <typename T>
void ThreadPool<T>::worker() {
    while (1) {
        unique_ptr<T> request;
        {
            unique_lock<mutex> lock(m_mutex);
            m_cond.wait(lock, [this] {
                return m_stop || !m_workqueue.empty();
            });

            if (m_stop && m_workqueue.empty()) {
                return;
            }

            request = move(m_workqueue.front());
            m_workqueue.pop();
        }
        if (request) {
            request->process();
        }
    }
}