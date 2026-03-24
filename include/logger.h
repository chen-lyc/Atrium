#pragma once

#include <condition_variable>
#include <fstream>
#include <iostream>
#include <mutex>
#include <queue>
#include <thread>

class AsyncLogger {
  public:
    enum LOGLEVEL {
        DEBUG,
        INFO,
        WARN,
        ERROR,
        FATAL
    };

    AsyncLogger(size_t flush_threshold);
    ~AsyncLogger();
    void log(LOGLEVEL level, const std::string &message);

  private:
    std::string getTimestamp();
    std::string levelToString(LOGLEVEL level);
    void backend();

  private:
    std::queue<std::string> m_front_buffer;
    std::queue<std::string> m_back_buffer;
    std::mutex m_mutex;
    std::condition_variable m_cond;
    std::thread m_backend;
    size_t m_flush_threshold;
    std::ofstream m_file;
    bool m_stop = false;
};

extern AsyncLogger logger;