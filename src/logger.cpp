#include "logger.h"
#include <cstring>
using namespace std;

AsyncLogger::AsyncLogger(size_t flush_threshold) : m_flush_threshold(flush_threshold), m_stop(false) {
    m_file.open("logs/server.log", ios::app);
    if (!m_file.is_open()) {
        std::cerr << "log file open failed!" << std::endl;
    }

    m_backend = thread(&AsyncLogger::backend, this);
}

AsyncLogger::~AsyncLogger() {
    {
        lock_guard<mutex> lock(m_mutex);
        m_stop = true;
    }

    m_cond.notify_one();
    if (m_backend.joinable()) {
        m_backend.join();
    }
}

void AsyncLogger::log(LOGLEVEL level, const string &message) {
    string entry = getTimestamp() + " " + levelToString(level) + " " + message;
    if (level == ERROR) {
        entry.append(": " + string(strerror(errno)));
    }

    {
        lock_guard<mutex> lock(m_mutex);
        m_front_buffer.push(entry);
        if (m_front_buffer.size() > m_flush_threshold) {
            m_cond.notify_one();
        }
    }
}

string AsyncLogger::getTimestamp() {
    auto now = chrono::system_clock::now();
    auto ms = chrono::duration_cast<chrono::milliseconds>(now.time_since_epoch()) % 1000;
    time_t t = chrono::system_clock::to_time_t(now);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", localtime(&t));
    return string(buf) + "." + to_string(ms.count());
}

string AsyncLogger::levelToString(AsyncLogger::LOGLEVEL level) {
    switch (level) {
    case DEBUG:
        return "DEBUG";
    case INFO:
        return "INFO";
    case WARN:
        return "WARN";
    case ERROR:
        return "ERROR";
    case FATAL:
        return "FATAL";
    default:
        return "UNKNOWN";
    }
}

void AsyncLogger::backend() {
    while (1) {
        {
            unique_lock<mutex> lock(m_mutex);
            m_cond.wait_for(lock, std::chrono::seconds(3), [this] { return m_stop || m_front_buffer.size() >= m_flush_threshold; });

            m_back_buffer.swap(m_front_buffer);
        }

        while (!m_back_buffer.empty()) {
            m_file << m_back_buffer.front() << '\n';
            m_back_buffer.pop();
        }
        m_file.flush();

        if (m_stop) {
            return;
        }
    }
}

AsyncLogger logger(5);