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

            m_ready_queue.emplace(std::move(conn));
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

MysqlPool::QueryResult MysqlPool::executeQuery(const std::string &sql, MysqlParams &params, std::vector<std::vector<std::string>> &rows, size_t col_count) {
    MysqlConnGuard guard(*this);
    sql::Connection *conn = guard.get();
    if (conn == nullptr) {
        return MysqlPool::QueryResult::ServerError;
    }

    try {
        unique_ptr<sql::PreparedStatement> stmt(conn->prepareStatement(sql));

        for (size_t i = 0; i < params.size(); ++i) {
            if (holds_alternative<string>(params[i])) {
                stmt->setString(i + 1, get<string>(params[i]));
            } else if (holds_alternative<uint64_t>(params[i])) {
                stmt->setUInt64(i + 1, get<uint64_t>(params[i]));
            } else if (holds_alternative<int>(params[i])) {
                stmt->setInt(i + 1, get<int>(params[i]));
            } else if (holds_alternative<Blob>(params[i])) {
                Blob &blob = get<Blob>(params[i]);
                istringstream iss(blob.bytes);
                stmt->setBlob(i + 1, &iss);
            }
        }

        unique_ptr<sql::ResultSet> rs(stmt->executeQuery());
        if (!rs->next()) {
            return MysqlPool::QueryResult::NotFound;
        }
        do {
            vector<string> row;
            for (size_t i = 0; i < col_count; ++i) {
                row.emplace_back(rs->getString(i + 1));
            }
            rows.emplace_back(std::move(row));
        } while (rs->next());
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

MysqlPool::QueryResult MysqlPool::executeQuery(const string &sql, MysqlParams &params, uint64_t *id) {
    MysqlConnGuard guard(*this);
    sql::Connection *conn = guard.get();
    if (conn == nullptr) {
        return MysqlPool::QueryResult::ServerError;
    }

    try {
        unique_ptr<sql::PreparedStatement> stmt(conn->prepareStatement(sql));

        vector<unique_ptr<istringstream>> blob_stream;
        for (size_t i = 0; i < params.size(); ++i) {
            if (holds_alternative<string>(params[i])) {
                stmt->setString(i + 1, get<string>(params[i]));
            } else if (holds_alternative<uint64_t>(params[i])) {
                stmt->setUInt64(i + 1, get<uint64_t>(params[i]));
            } else if (holds_alternative<int>(params[i])) {
                stmt->setInt(i + 1, get<int>(params[i]));
            } else if (holds_alternative<Blob>(params[i])) {
                Blob &blob = get<Blob>(params[i]);
                blob_stream.emplace_back(make_unique<istringstream>(blob.bytes));
                stmt->setBlob(i + 1, blob_stream.back().get());
            }
        }

        stmt->executeUpdate();

        if (id != nullptr) {
            unique_ptr<sql::Statement> id_stmt(conn->createStatement());
            unique_ptr<sql::ResultSet> rs(
                id_stmt->executeQuery("SELECT LAST_INSERT_ID()"));

            if (rs->next()) {
                *id = rs->getUInt64(1);
            } else {
                return MysqlPool::QueryResult::ServerError;
            }
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

        m_mysql_conn = std::move(pool.m_ready_queue.front());
        pool.m_ready_queue.pop();
    }
}

MysqlConnGuard::~MysqlConnGuard() {
    if (m_mysql_conn == nullptr) {
        return;
    }
    {
        lock_guard<mutex> lock(m_pool.m_mutex);
        m_pool.m_ready_queue.emplace(std::move(m_mysql_conn));
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
            m_ready_queue.emplace(std::move(mysql_conn));
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
