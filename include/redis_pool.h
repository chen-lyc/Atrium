#pragma once

#include <condition_variable>
#include <hiredis/hiredis.h>
#include <mutex>
#include <queue>
#include <string>

class RedisPool;

class RedisConnGuard {
  public:
    RedisConnGuard(RedisPool &pool);
    ~RedisConnGuard();
    redisContext *get() const {
        return m_redis_conn;
    }

  private:
    RedisPool &m_pool;
    redisContext *m_redis_conn;
};

class RedisPool {
    friend class RedisConnGuard;

  public:
    static RedisPool &getInstance() {
        static RedisPool instance(5);
        return instance;
    }
    ~RedisPool();
    bool executeCommand(const std::string &command);
    bool executeCommand(const std::string &command, std::string &result_value);

  private:
    RedisPool(int max_connections);
    redisReply *executeRaw(const std::string &command);

  private:
    std::queue<redisContext *> m_ready_queue;
    std::mutex m_mutex;
    std::condition_variable m_cond;
    bool m_stop = false;
};