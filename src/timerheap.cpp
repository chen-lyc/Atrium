#include "timerheap.h"
#include "logger.h"
#include <chrono>
#include <unistd.h>
using namespace std;

static long long getMilliseconds() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

void TimerHeap::add(int fd, long long timeout) {
    m_timers.emplace_back(fd, getMilliseconds() + timeout);
    m_timers_index[fd] = m_timers.size() - 1;
    siftUp(m_timers.size() - 1);
}

void TimerHeap::tick() {
    while (!m_timers.empty() && getMilliseconds() >= m_timers[0].expire_time) {
        LOG_DEBUG("tick: fd = %d, tick: now=%lld expire=%lld, expired",
                  m_timers[0].fd,
                  getMilliseconds(),
                  m_timers[0].expire_time);

        m_expired.push_back(m_timers[0].fd);
        swap(m_timers[0], m_timers[m_timers.size() - 1]);
        m_timers_index.erase(m_timers[m_timers.size() - 1].fd);
        m_timers.pop_back();
        if (!m_timers.empty()) {
            m_timers_index[m_timers[0].fd] = 0;
            siftDown(0);
        }
    }
}

int TimerHeap::getNextTimeout() {
    tick();

    while (!m_timers.empty()) {
        int timeout = m_timers[0].expire_time - getMilliseconds();
        if (timeout > 0) {
            LOG_DEBUG("fd = %d ,timeout = %d", m_timers[0].fd, timeout);
            return timeout;
        }

        tick();
    }

    LOG_DEBUG("reactor[%d] no timer", m_index);
    return -1;
}

void TimerHeap::update(int fd, long long timeout) {
    if (!m_timers_index.contains(fd)) {
        LOG_DEBUG("timer heap update: fd not found");
        return;
    }

    int index = m_timers_index[fd];
    int old_timeout = m_timers[index].expire_time;
    m_timers[index].expire_time = getMilliseconds() + timeout;
    LOG_DEBUG("fd = %d , expire time updata to %lld", fd, timeout);
    if (m_timers[index].expire_time > old_timeout) {
        siftDown(index);
    } else {
        siftUp(index);
    }
}

void TimerHeap::remove(int fd) {
    if (!m_timers_index.contains(fd)) {
        LOG_DEBUG("timer heap remove: fd not found");
        return;
    }

    int index = m_timers_index[fd];
    swap(m_timers[index], m_timers[m_timers.size() - 1]);
    m_timers_index.erase(fd);
    m_timers.pop_back();
    if (index < m_timers.size()) {
        m_timers_index[m_timers[index].fd] = index;
        index = siftDown(index);
        siftUp(index);
    }
}

int TimerHeap::siftDown(int index) {
    while (1) {
        int left_child = 2 * index + 1;
        int right_child = 2 * index + 2;
        int smallest = index;

        if (left_child < m_timers.size() && m_timers[left_child].expire_time < m_timers[smallest].expire_time) {
            smallest = left_child;
        }

        if (right_child < m_timers.size() && m_timers[right_child].expire_time < m_timers[smallest].expire_time) {
            smallest = right_child;
        }

        if (smallest == index) {
            break;
        }

        swap(m_timers[index], m_timers[smallest]);
        m_timers_index[m_timers[index].fd] = index;
        m_timers_index[m_timers[smallest].fd] = smallest;
        index = smallest;
    }
    return index;
}

int TimerHeap::siftUp(int index) {
    while (1) {
        int father = (index - 1) / 2;
        if (m_timers[father].expire_time > m_timers[index].expire_time) {
            swap(m_timers[father], m_timers[index]);
            m_timers_index[m_timers[index].fd] = index;
            m_timers_index[m_timers[father].fd] = father;
            index = father;
        } else {
            break;
        }
    }
    return index;
}
