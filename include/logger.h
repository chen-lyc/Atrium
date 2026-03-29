#pragma once

#include <condition_variable>
#include <fstream>
#include <iostream>
#include <mutex>
#include <queue>
#include <string_view>
#include <thread>

#define LOG_DEBUG(msg)                                                      \
    do {                                                                    \
        if (AsyncLogger::getInstance().getMinLevel() <= AsyncLogger::DEBUG) \
            AsyncLogger::getInstance().log(AsyncLogger::DEBUG, msg);        \
    } while (0)
#define LOG_INFO(msg)                                                      \
    do {                                                                   \
        if (AsyncLogger::getInstance().getMinLevel() <= AsyncLogger::INFO) \
            AsyncLogger::getInstance().log(AsyncLogger::INFO, msg);        \
    } while (0)
#define LOG_WARN(msg)                                                      \
    do {                                                                   \
        if (AsyncLogger::getInstance().getMinLevel() <= AsyncLogger::WARN) \
            AsyncLogger::getInstance().log(AsyncLogger::WARN, msg);        \
    } while (0)
#define LOG_ERROR(msg)                                                      \
    do {                                                                    \
        if (AsyncLogger::getInstance().getMinLevel() <= AsyncLogger::ERROR) \
            AsyncLogger::getInstance().log(AsyncLogger::ERROR, msg);        \
    } while (0)
#define LOG_FATAL(msg)                                                      \
    do {                                                                    \
        if (AsyncLogger::getInstance().getMinLevel() <= AsyncLogger::FATAL) \
            AsyncLogger::getInstance().log(AsyncLogger::FATAL, msg);        \
    } while (0)

class AsyncLogger {
  public:
    enum LOGLEVEL {
        DEBUG,
        INFO,
        WARN,
        ERROR,
        FATAL
    };

    static AsyncLogger &getInstance() {
        static AsyncLogger instance(5);
        return instance;
    }
    ~AsyncLogger();
    void log(LOGLEVEL level, std::string_view message);
    void setLevel(LOGLEVEL min_level) {
        m_min_level = min_level;
    }
    void setLevel(std::string_view min_level);
    LOGLEVEL getMinLevel() const {
        return m_min_level;
    }

  private:
    AsyncLogger(size_t flush_threshold);
    std::string_view levelToString(LOGLEVEL level) const;
    void backend();

  private:
    std::queue<std::string> m_front_buffer;
    std::queue<std::string> m_back_buffer;
    std::mutex m_mutex;
    std::condition_variable m_cond;
    std::thread m_backend;
    size_t m_flush_threshold;
    std::ofstream m_file;
    LOGLEVEL m_min_level;
    bool m_stop = false;
};