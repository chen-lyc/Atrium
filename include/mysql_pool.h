#pragma once

#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <mysql_connection.h>
#include <mysql_driver.h>
#include <queue>
#include <string>
#include <vector>

class MysqlPool;

class MysqlConnGuard {
  public:
    MysqlConnGuard(MysqlPool &pool);
    ~MysqlConnGuard();
    sql::Connection *get() const {
        return m_mysql_conn.get();
    }
    void discardConnection() {
        m_mysql_conn = nullptr;
    }

  private:
    MysqlPool &m_pool;
    std::unique_ptr<sql::Connection> m_mysql_conn;
};

class MysqlPool {
    friend class MysqlConnGuard;

  public:
    enum QueryResult {
        Success,
        NotFound,
        AlreadyExists,
        ServerError,
    };

    static MysqlPool &getInstance() {
        static MysqlPool instance(2, 8);
        return instance;
    }
    ~MysqlPool();
    QueryResult executeQuery(const std::string &sql, const std::string &username, std::vector<std::string> &result, uint64_t &user_id);
    QueryResult executeQuery(const std::string &sql, const std::string &username, const std::string &salt, const std::string &hash, uint64_t &user_id);

  private:
    MysqlPool(int min_connections, int max_connections);
    bool isBadMysqlConnection(const sql::SQLException &e);
    void maintainConnections();

  private:
    int m_min_connections;
    int m_max_connections;
    int m_max_fail_count;
    int m_waiters = 0;
    int m_connections = 0;
    std::queue<std::unique_ptr<sql::Connection>> m_ready_queue;
    std::mutex m_mutex;
    std::condition_variable m_need_refill_cond;
    std::condition_variable m_conn_available_cond;
    std::thread m_maintenance_thread;
    bool m_stop = false;
    bool m_init_all_fail = false;
    bool m_unreachable = false;
};