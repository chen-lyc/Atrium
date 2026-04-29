#include "mysql_pool.h"
#include "logger.h"
#include <cppconn/exception.h>
#include <cppconn/prepared_statement.h>
#include <cppconn/resultset.h>
#include <cppconn/statement.h>
#include <cstring>
#include <sstream>
using namespace std;

MysqlPool::MysqlPool(int min_connections, int max_connections) : m_min_connections(min_connections), m_max_connections(max_connections), m_max_fail_count(3 * min_connections) {
    int fail_count = 0;
    while (m_connections < min_connections) {
        try {
            sql::mysql::MySQL_Driver *driver = sql::mysql::get_mysql_driver_instance();
            unique_ptr<sql::Connection> conn(driver->connect("tcp://127.0.0.1:3306", "lyc", "lYc@123456"));
            conn->setSchema("webserver");

            m_ready_queue.emplace(move(conn));
            ++m_connections;
            fail_count = 0;
        } catch (const sql::SQLException &e) {
            LOG_ERROR("mysql init failed: %s, code = %d, state = %s",
                      e.what(),
                      e.getErrorCode(),
                      e.getSQLState().c_str());
            if (++fail_count > m_max_fail_count) {
                LOG_ERROR("mysql connect failed too much");
                m_init_all_fail = true;
                return;
            }
            continue;
        }
    }

    m_maintenance_thread = thread(&MysqlPool::maintainConnections, this);
}

MysqlPool::~MysqlPool() {
    {
        lock_guard<mutex> lock(m_mutex);
        m_stop = true;
    }

    m_need_refill_cond.notify_all();
    m_conn_available_cond.notify_all();

    if (m_maintenance_thread.joinable()) {
        m_maintenance_thread.join();
    }
}

MysqlPool::QueryResult MysqlPool::executeQuery(const string &sql, const string &username, vector<string> &result, uint64_t &user_id) {
    MysqlConnGuard guard(*this);
    sql::Connection *conn = guard.get();
    if (conn == nullptr) {
        return MysqlPool::QueryResult::ServerError;
    }

    try {
        unique_ptr<sql::PreparedStatement> stmt(conn->prepareStatement(sql));
        stmt->setString(1, username);

        unique_ptr<sql::ResultSet> res(stmt->executeQuery());
        if (!res->next()) {
            LOG_DEBUG("login: user not found");
            return MysqlPool::QueryResult::NotFound;
        }

        user_id = res->getUInt64("id");
        result.emplace_back(res->getString("salt"));
        result.emplace_back(res->getString("password_hash"));
        return MysqlPool::QueryResult::Success;
    } catch (const sql::SQLException &e) {
        LOG_WARN("select failed: %s, code = %d, state = %s",
                 e.what(),
                 e.getErrorCode(),
                 e.getSQLState().c_str());
        if (isBadMysqlConnection(e)) {
            guard.discardConnection();

            {
                {
                    lock_guard<mutex> lock(m_mutex);
                    --m_connections;
                }
            }
            m_need_refill_cond.notify_one();
        }
        return MysqlPool::QueryResult::ServerError;
    }
}

MysqlPool::QueryResult MysqlPool::executeQuery(const string &sql, const std::string &username, const std::string &salt, const std::string &hash, uint64_t &user_id) {
    MysqlConnGuard guard(*this);
    sql::Connection *conn = guard.get();
    if (conn == nullptr) {
        return MysqlPool::QueryResult::ServerError;
    }

    try {
        unique_ptr<sql::PreparedStatement> stmt(conn->prepareStatement(sql));
        stmt->setString(1, username);
        istringstream salt_stream(salt);
        stmt->setBlob(2, &salt_stream);
        istringstream hash_stream(hash);
        stmt->setBlob(3, &hash_stream);

        stmt->executeUpdate();

        unique_ptr<sql::Statement> id_stmt(conn->createStatement());
        unique_ptr<sql::ResultSet> rs(
            id_stmt->executeQuery("SELECT LAST_INSERT_ID()"));

        if (rs->next()) {
            user_id = rs->getUInt64(1);
        } else {
            return MysqlPool::QueryResult::ServerError;
        }

        return MysqlPool::QueryResult::Success;
    } catch (const sql::SQLException &e) {
        if (e.getErrorCode() == 1062) {
            return MysqlPool::QueryResult::AlreadyExists;
        }
        LOG_WARN("insert failed: %s, code = %d, state = %s",
                 e.what(),
                 e.getErrorCode(),
                 e.getSQLState().c_str());
        if (isBadMysqlConnection(e)) {
            guard.discardConnection();

            {
                lock_guard<mutex> lock(m_mutex);
                --m_connections;
            }
            m_need_refill_cond.notify_one();
        }
        return MysqlPool::QueryResult::ServerError;
    }
}

bool MysqlPool::isBadMysqlConnection(const sql::SQLException &e) {
    return e.getErrorCode() == 2006 || e.getErrorCode() == 2013 || e.getSQLState() == "08S01";
}

MysqlConnGuard::MysqlConnGuard(MysqlPool &pool) : m_pool(pool) {
    {
        unique_lock<mutex> lock(pool.m_mutex);
        if (pool.m_ready_queue.empty()) {
            ++m_pool.m_waiters;
            pool.m_need_refill_cond.notify_one();
            pool.m_conn_available_cond.wait(lock, [&pool] {
                return !pool.m_ready_queue.empty() || pool.m_unreachable || pool.m_stop || pool.m_init_all_fail;
            });

            if (pool.m_unreachable || pool.m_stop || pool.m_init_all_fail) {
                m_mysql_conn = nullptr;
                --pool.m_waiters;
                return;
            }
        }

        m_mysql_conn = move(pool.m_ready_queue.front());
        pool.m_ready_queue.pop();
    }
}

MysqlConnGuard::~MysqlConnGuard() {
    if (m_mysql_conn == nullptr) {
        return;
    }
    {
        lock_guard<mutex> lock(m_pool.m_mutex);
        m_pool.m_ready_queue.emplace(move(m_mysql_conn));
        if (m_pool.m_waiters > 0) --m_pool.m_waiters;
    }
    m_pool.m_conn_available_cond.notify_one();
}

void MysqlPool::maintainConnections() {
    while (true) {
        unique_lock<mutex> lock(m_mutex);
        m_need_refill_cond.wait(lock, [&] {
            return m_connections < m_min_connections || (m_waiters > 0 && m_connections < m_max_connections) || m_stop;
        });

        if (m_stop) return;

        int fail_count = 0;
        while (m_connections < m_min_connections || (m_waiters > 0 && m_connections < m_max_connections)) {
            lock.unlock();
            unique_ptr<sql::Connection> mysql_conn;
            while (mysql_conn == nullptr) {
                try {
                    sql::mysql::MySQL_Driver *driver = sql::mysql::get_mysql_driver_instance();
                    mysql_conn.reset(driver->connect("tcp://127.0.0.1:3306", "lyc", "lYc@123456"));
                    mysql_conn->setSchema("webserver");
                } catch (const sql::SQLException &e) {
                    LOG_ERROR("mysql init failed: %s, code = %d, state = %s",
                              e.what(),
                              e.getErrorCode(),
                              e.getSQLState().c_str());
                    mysql_conn = nullptr;
                    if (++fail_count > m_max_fail_count) {
                        LOG_ERROR("mysql connect failed too much in maintainConnections");
                        break;
                    }
                    continue;
                }
            }
            if (mysql_conn == nullptr) {
                break;
            }
            fail_count = 0;

            lock.lock();
            m_ready_queue.emplace(move(mysql_conn));
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
