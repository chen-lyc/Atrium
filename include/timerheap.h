#pragma once

#include <functional>
#include <unordered_map>
#include <vector>

struct Timer {
    int fd;
    long long expire_time;

    Timer(int f, long long e) : fd(f), expire_time(e) {}
};

class TimerHeap {
  public:
    TimerHeap(const std::vector<Timer> &timers);
    TimerHeap();
    void add(int fd, long long timeout);
    void tick();
    int getNextTimeout();
    std::vector<int> getExpired() {
        return move(m_expired);
    }
    void update(int fd, long long timeout);
    void remove(int fd);

  private:
    int siftDown(int index);
    int siftUp(int index);

  private:
    std::vector<Timer> m_timers;
    std::unordered_map<int, int> m_timers_index;
    std::vector<int> m_expired;
};

extern TimerHeap timer_heap;