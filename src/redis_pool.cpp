#include "redis_pool.h"
#include "logger.h"
using namespace std;

RedisPool::RedisPool(int min_connections, int max_connections) : m_min_connections(min_connections), m_max_connections(max_connections), m_max_fail_count(3 * min_connections) {
    int fail_count = 0;
    while (m_connections < min_connections) {
        redisContext *ctx = redisConnect("127.0.0.1", 6379);
        if (ctx == nullptr || ctx->err) {
            LOG_ERROR("Redis connect failed");
            if (ctx) redisFree(ctx);
            if (++fail_count > m_max_fail_count) {
                LOG_ERROR("redis connect failed too much");
                m_init_all_fail = true;
                return;
            }
            continue;
        }
        fail_count = 0;

        m_ready_queue.emplace(ctx);
        ++m_connections;
    }

    m_maintenance_thread = thread(&RedisPool::maintainConnections, this);
}

RedisPool::~RedisPool() {
    {
        lock_guard<mutex> lock(m_mutex);
        m_stop = true;
    }

    m_need_refill_cond.notify_all();
    m_conn_available_cond.notify_all();

    if (m_maintenance_thread.joinable()) {
        m_maintenance_thread.join();
    }

    {
        lock_guard<mutex> lock(m_mutex);
        while (!m_ready_queue.empty()) {
            redisFree(m_ready_queue.front());
            m_ready_queue.pop();
        }
    }
}

RedisPool::CommandResult RedisPool::executeCommand(int argc, const char *argv[], size_t arglen[]) {
    RedisPool::ReplyPtr reply = executeRaw(argc, argv, arglen);
    return checkReply(reply);
}

RedisPool::CommandResult RedisPool::executeCommand(int argc, const char *argv[], size_t arglen[], string &result_value) {
    RedisPool::ReplyPtr reply = executeRaw(argc, argv, arglen);
    RedisPool::CommandResult status = checkReply(reply);
    if (status != RedisPool::CommandResult::Success) {
        return status;
    }

    if (reply->type != REDIS_REPLY_STRING) {
        LOG_ERROR("unexpected reply type: %d", reply->type);
        return RedisPool::CommandResult::ServerError;
    }

    result_value.assign(reply->str, reply->len);
    return RedisPool::CommandResult::Success;
}

RedisPool::ReplyPtr RedisPool::executeRaw(int argc, const char *argv[], size_t arglen[]) {
    RedisConnGuard guard(*this);
    redisContext *redis_conn = guard.get();
    if (redis_conn == nullptr) {
        return nullptr;
    }

    RedisPool::ReplyPtr reply(static_cast<redisReply *>(redisCommandArgv(redis_conn, argc, argv, arglen)));

    int fail_count = 0;
    while (reply == nullptr && fail_count < 3) {
        ++fail_count;
        LOG_DEBUG("redisCommand return null");
        if (!guard.reacquire()) {
            return nullptr;
        }
        redis_conn = guard.get();
        reply.reset(static_cast<redisReply *>(redisCommandArgv(redis_conn, argc, argv, arglen)));
    }
    return reply;
}

RedisPool::CommandResult RedisPool::checkReply(RedisPool::ReplyPtr &reply) {
    if (reply == nullptr) {
        return RedisPool::CommandResult::ServerError;
    }

    if (reply->type == REDIS_REPLY_ERROR) {
        LOG_WARN("redis command error: %.*s", static_cast<int>(reply->len), reply->str);
        return RedisPool::CommandResult::ServerError;
    }

    if (reply->type == REDIS_REPLY_NIL) {
        LOG_DEBUG("redis key not found");
        return RedisPool::CommandResult::NotFound;
    }

    return RedisPool::CommandResult::Success;
}

RedisConnGuard::RedisConnGuard(RedisPool &pool) : m_pool(pool) {
    {
        unique_lock<mutex> lock(pool.m_mutex);
        acquireLocked(lock);
    }
}

RedisConnGuard::~RedisConnGuard() {
    if (m_redis_conn == nullptr) return;

    {
        lock_guard<mutex> lock(m_pool.m_mutex);
        m_pool.m_ready_queue.emplace(m_redis_conn);
        if (m_pool.m_waiters > 0) --m_pool.m_waiters;
    }
    m_pool.m_conn_available_cond.notify_one();
}

bool RedisConnGuard::reacquire() {
    if (m_redis_conn) {
        redisFree(m_redis_conn);
    }
    m_redis_conn = nullptr;
    {
        unique_lock<mutex> lock(m_pool.m_mutex);
        --m_pool.m_connections;
        m_pool.m_need_refill_cond.notify_one();
        return acquireLocked(lock);
    }
}

bool RedisConnGuard::acquireLocked(unique_lock<mutex> &lock) {
    if (m_pool.m_ready_queue.empty()) {
        ++m_pool.m_waiters;
        m_pool.m_need_refill_cond.notify_one();
        m_pool.m_conn_available_cond.wait(lock, [this] {
            return !m_pool.m_ready_queue.empty() || m_pool.m_unreachable || m_pool.m_stop || m_pool.m_init_all_fail;
        });

        if (m_pool.m_unreachable || m_pool.m_stop || m_pool.m_init_all_fail) {
            --m_pool.m_waiters;
            return false;
        }
    }

    m_redis_conn = m_pool.m_ready_queue.front();
    m_pool.m_ready_queue.pop();
    return true;
}

void RedisPool::maintainConnections() {
    while (true) {
        unique_lock<mutex> lock(m_mutex);
        m_need_refill_cond.wait(lock, [&] {
            return m_connections < m_min_connections || (m_waiters > 0 && m_connections < m_max_connections) || m_stop;
        });

        if (m_stop) {
            return;
        }

        int fail_count = 0;
        while (m_connections < m_min_connections || (m_waiters > 0 && m_connections < m_max_connections)) {
            lock.unlock();
            redisContext *ctx = redisConnect("127.0.0.1", 6379);
            while (ctx == nullptr || ctx->err) {
                if (ctx) redisFree(ctx);
                if (++fail_count > m_max_fail_count) {
                    LOG_ERROR("redis connect failed too much in maintainConnections");
                    break;
                }
                ctx = redisConnect("127.0.0.1", 6379);
            }
            if (ctx == nullptr || ctx->err) {
                break;
            }
            fail_count = 0;

            lock.lock();
            m_ready_queue.emplace(ctx);
            ++m_connections;
            if (m_waiters > 0) --m_waiters;
            m_conn_available_cond.notify_one();
        }
        if (fail_count > m_max_fail_count) {
            {
                lock_guard<mutex> lock(m_mutex);
                m_unreachable = true;
            }
            m_conn_available_cond.notify_all();

            this_thread::sleep_for(chrono::seconds(5));

            {
                lock_guard<mutex> lock(m_mutex);
                m_unreachable = false;
            }
        }
    }
}
