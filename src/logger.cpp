#include "logger.h"
#include <cstring>
using namespace std;

static string getTimestamp() {
    auto now = chrono::system_clock::now();
    auto ms = chrono::duration_cast<chrono::milliseconds>(now.time_since_epoch()) % 1000;
    time_t t = chrono::system_clock::to_time_t(now);
    string buf;
    buf.resize(32);
    size_t len = strftime(buf.data(), buf.capacity(), "%Y-%m-%d %H:%M:%S", localtime(&t));
    buf.resize(len);
    buf += ".";
    buf += to_string(ms.count());
    return buf;
}

AsyncLogger::AsyncLogger(size_t flush_threshold) : m_flush_threshold(flush_threshold), m_min_level(INFO) {
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

void AsyncLogger::log(LOGLEVEL level, string_view message) {
    if (level < m_min_level) return;

    string entry;
    entry.reserve(128);
    entry += getTimestamp();
    entry += " ";
    entry += levelToString(level);
    entry += " ";
    entry += message;

    if (level == ERROR) {
        entry += ": ";
        entry += strerror(errno);
    }

    {
        lock_guard<mutex> lock(m_mutex);
        m_front_buffer.push(entry);
        if (m_front_buffer.size() > m_flush_threshold) {
            m_cond.notify_one();
        }
    }
}

void AsyncLogger::setLevel(string_view min_level) {
    if (min_level == "DEBUG") m_min_level = DEBUG;
    else if (min_level == "INFO") m_min_level = INFO;
    else if (min_level == "WARN") m_min_level = WARN;
    else if (min_level == "ERROR") m_min_level = ERROR;
    else if (min_level == "FATAL") m_min_level = FATAL;
    else {
        this->log(ERROR, "no level");
    }
}

string_view AsyncLogger::levelToString(AsyncLogger::LOGLEVEL level) const {
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