#include "redis_pool.h"
#include "logger.h"
using namespace std;

RedisPool::RedisPool(int max_connections) {
    for (int i = 0; i < max_connections; i++) {
        redisContext *connfd = redisConnect("127.0.0.1", 6379);
        if (connfd == nullptr || connfd->err) {
            LOG_ERROR("Redis connect failed");
            continue;
        }

        m_ready_queue.emplace(connfd);
    }
}

RedisPool::~RedisPool() {
    {
        lock_guard<mutex> lock(m_mutex);
        m_stop = true;

        while (!m_ready_queue.empty()) {
            redisFree(m_ready_queue.front());
            m_ready_queue.pop();
        }
    }
    m_cond.notify_all();
}

bool RedisPool::executeCommand(const string &command) {
    redisReply *reply = executeRaw(command);
    if (reply == nullptr) {
        return false;
    }

    freeReplyObject(reply);
    return true;
}

bool RedisPool::executeCommand(const string &command, string &result_value) {
    redisReply *reply = executeRaw(command);
    if (reply == nullptr) {
        return false;
    }

    result_value.assign(reply->str, reply->len);
    freeReplyObject(reply);
    return true;
}

redisReply *RedisPool::executeRaw(const string &command) {
    RedisConnGuard guard(*this);
    redisContext *redis_conn = guard.get();
    if (redis_conn == nullptr) {
        return nullptr;
    }

    redisReply *reply = (redisReply *)redisCommand(redis_conn, command.c_str());

    if (reply == nullptr) {
        LOG_WARN("redisCommand return null");
        return nullptr;
    }

    if (reply->type == REDIS_REPLY_NIL) {
        LOG_ERROR("redis cache failed");
        freeReplyObject(reply);
        return nullptr;
    }

    return reply;
}

RedisConnGuard::RedisConnGuard(RedisPool &pool) : m_pool(pool) {
    {
        unique_lock<mutex> lock(pool.m_mutex);
        pool.m_cond.wait(lock, [&pool] {
            return !pool.m_ready_queue.empty() || pool.m_stop;
        });

        if (pool.m_stop) {
            m_redis_conn = nullptr;
            return;
        }

        m_redis_conn = pool.m_ready_queue.front();
        pool.m_ready_queue.pop();
    }
}

RedisConnGuard::~RedisConnGuard() {
    if (m_redis_conn == nullptr) {
        return;
    }
    {
        lock_guard<mutex> lock(m_pool.m_mutex);
        m_pool.m_ready_queue.emplace(m_redis_conn);
    }
    m_pool.m_cond.notify_one();
}

RedisPool redis_pool(5);