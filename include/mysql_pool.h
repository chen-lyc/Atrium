#pragma once

#include <condition_variable>
#include <mutex>
#include <mysql/mysql.h>
#include <queue>
#include <string>

class MysqlPool;

class ConnGuard {
  public:
    ConnGuard(MysqlPool &pool);
    ~ConnGuard();
    MYSQL *get() const {
        return m_mysql_conn;
    }

  private:
    MysqlPool &m_pool;
    MYSQL *m_mysql_conn;
};

class MysqlPool {
    friend class ConnGuard;

  public:
    static MysqlPool &getInstance() {
        static MysqlPool instance(5);
        return instance;
    }
    ~MysqlPool();
    int executeQuery(const std::string &sql, std::string &result_text);
    bool executeQuery(const std::string &sql);

  private:
    MysqlPool(int max_connections);

  private:
    std::queue<MYSQL *> m_ready_queue;
    std::mutex m_mutex;
    std::condition_variable m_cond;
    bool m_stop = false;
};

extern MysqlPool mysql_pool;