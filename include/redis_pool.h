#pragma once

#include <atomic>
#include <condition_variable>
#include <hiredis/hiredis.h>
#include <memory>
#include <mutex>
#include <optional>
#include <queue>
#include <string>

struct ReplyDeleter {
    void operator()(redisReply *r) const {
        if (r) freeReplyObject(r);
    }
};

class RedisPool;

class RedisConnGuard {
  public:
    RedisConnGuard(RedisPool &pool);
    ~RedisConnGuard();
    redisContext *get() const {
        return m_redis_conn;
    }
    bool reacquire();

  private:
    bool acquireLocked(std::unique_lock<std::mutex> &lock);

  private:
    RedisPool &m_pool;
    redisContext *m_redis_conn = nullptr;
};

class RedisPool {
    friend class RedisConnGuard;

  public:
    enum CommandResult {
        Success,
        NotFound,
        NetWorkError,
        UnexpectedType,
        CommandError,
        ServerError
    };
    using ReplyPtr = std::unique_ptr<redisReply, ReplyDeleter>;

    static RedisPool &getInstance() {
        static RedisPool instance(4, 16);
        return instance;
    }
    ~RedisPool();
    CommandResult executeCommand(int argc, const char *argv[], size_t arglen[]);
    CommandResult executeCommand(int argc, const char *argv[], size_t arglen[], std::string &value);
    CommandResult executeCommand(int argc, const char *argv[], size_t arglen[], std::vector<std::optional<std::string>> &values);

  private:
    RedisPool(int min_connections, int max_connections);
    ReplyPtr executeRaw(int argc, const char *argv[], size_t arglen[]);
    CommandResult checkReply(ReplyPtr &reply);
    void maintainConnections();

  private:
    int m_min_connections;
    int m_max_connections;
    int m_max_fail_count;
    int m_waiters = 0;
    int m_connections = 0;
    std::queue<redisContext *> m_ready_queue;
    std::mutex m_mutex;
    std::condition_variable m_need_refill_cond;
    std::condition_variable m_conn_available_cond;
    std::thread m_maintenance_thread;
    bool m_stop = false;
    bool m_init_all_fail = false;
    bool m_unreachable = false;
};