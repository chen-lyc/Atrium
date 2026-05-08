#pragma once

#include <condition_variable>
#include <memory>
#include <mutex>
#include <mysql_connection.h>
#include <mysql_driver.h>
#include <queue>
#include <string>
#include <variant>
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

class MysqlTxnContext;

class MysqlPool {
  public:
    enum class QueryResult {
        Success,
        NotFound,
        AlreadyExists,
        SqlError,
        BadConn,
        ServerError,
    };
    struct Blob {
        std::string bytes;
        Blob(const char *data, size_t len) : bytes(data, len) {}
        Blob(std::string s) : bytes(std::move(s)) {}
    };
    using MysqlParams = std::vector<std::variant<std::string, uint64_t, int, Blob, std::nullptr_t>>;

    static MysqlPool &getInstance() {
        static MysqlPool instance(2, 8);
        return instance;
    }
    ~MysqlPool();

    QueryResult executeQuery(const std::string &sql, const MysqlParams &params, std::vector<std::vector<std::string>> &rows, size_t col_count);
    QueryResult executeQuery(const std::string &sql, const MysqlParams &params, uint64_t *id = nullptr);
    QueryResult executeUpdateAffected(const std::string &sql, const MysqlParams &params, uint64_t &affected_rows);

    enum class SqlResultMode {
        None,
        LastInsertId,
        Rows
    };
    struct ExecuteResult {
        SqlResultMode mode;
        uint64_t *id = nullptr;
        std::vector<std::vector<std::string>> &rows;
        size_t col_count;
    };
    QueryResult executeQuery(std::vector<std::string> &sqls, std::vector<MysqlParams> &params, std::vector<ExecuteResult> &result);
    QueryResult executeTransaction(std::function<QueryResult(MysqlTxnContext &)> work);

  private:
    MysqlPool(int min_connections, int max_connections);
    QueryResult executeRaw(sql::Connection *conn, const std::string &sql, const MysqlParams &params, std::vector<std::vector<std::string>> &rows, size_t col_count);
    QueryResult executeRaw(sql::Connection *conn, const std::string &sql, const MysqlParams &params, uint64_t *id = nullptr, uint64_t *affected_rows = nullptr);
    bool isBadMysqlConnection(const sql::SQLException &e);
    void notifyConnectionLost();
    void maintainConnections();

  private:
    friend class MysqlConnGuard;
    friend class MysqlTxnContext;

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

class MysqlTxnContext {
  public:
    MysqlPool::QueryResult executeQuery(const std::string &sql, MysqlPool::MysqlParams &params, std::vector<std::vector<std::string>> &rows, size_t col_count) {
        return m_pool.executeRaw(m_mysql_conn, sql, params, rows, col_count);
    }
    MysqlPool::QueryResult executeQuery(const std::string &sql, MysqlPool::MysqlParams &params, uint64_t *id = nullptr) {
        return m_pool.executeRaw(m_mysql_conn, sql, params, id);
    }

  private:
    friend class MysqlPool;
    MysqlTxnContext(MysqlPool &pool, sql::Connection *conn) : m_pool(pool), m_mysql_conn(conn) {}
    MysqlPool &m_pool;
    sql::Connection *m_mysql_conn;
};
