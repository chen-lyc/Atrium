#include "mysql_pool.h"
#include "logger.h"
using namespace std;

MysqlPool::MysqlPool(int max_connections) {
    for (int i = 0; i < max_connections; i++) {
        MYSQL *connfd = mysql_init(nullptr);
        if (connfd == nullptr) {
            LOG_ERROR("mysql_init failed");
            continue;
        }

        MYSQL *ret = mysql_real_connect(connfd, "127.0.0.1", "root", "123456", "webserver", 3306, nullptr, 0);
        if (ret == nullptr) {
            LOG_ERROR("mysql_real_connect failed");
            mysql_close(connfd);
            continue;
        }

        m_ready_queue.push(connfd);
    }
}

MysqlPool::~MysqlPool() {
    {
        lock_guard<mutex> lock(m_mutex);
        m_stop = true;

        while (!m_ready_queue.empty()) {
            mysql_close(m_ready_queue.front());
            m_ready_queue.pop();
        }
    }
    m_cond.notify_all();
}

int MysqlPool::executeQuery(const string &sql, string &result_text) {
    ConnGuard guard(*this);
    MYSQL *mysql_conn = guard.get();
    if (mysql_conn == nullptr) {
        return -1;
    }

    int ret = mysql_query(mysql_conn, sql.c_str());
    if (ret != 0) {
        LOG_ERROR("mysql_query failed: " + string(mysql_error(mysql_conn)));
        return -1;
    }

    MYSQL_RES *result = mysql_store_result(mysql_conn);
    if (result == nullptr) {
        LOG_ERROR("mysql_store_result returned null");
        return -1;
    }

    int num_fields = mysql_num_fields(result);

    MYSQL_ROW row;
    result_text.reserve(result_text.size() + 256);
    while ((row = mysql_fetch_row(result)) != nullptr) {
        for (int i = 0; i < num_fields; i++) {
            if (row[i] != nullptr) {
                result_text.append(row[i]);
                result_text.append(" ");
            } else {
                result_text.append("NULL ");
            }
        }
    }
    if (!result_text.empty()) {
        result_text.pop_back();
    }

    mysql_free_result(result);

    return num_fields;
}

bool MysqlPool::executeQuery(const string &sql) {
    ConnGuard guard(*this);
    MYSQL *mysql_conn = guard.get();
    if (mysql_conn == nullptr) {
        return -1;
    }

    int ret = mysql_query(mysql_conn, sql.c_str());
    if (ret != 0) {
        LOG_ERROR("mysql_query failed: " + string(mysql_error(mysql_conn)));
        return false;
    } else {
        LOG_INFO("success, affected rows = " + to_string(mysql_affected_rows(mysql_conn)));
    }

    return true;
}

ConnGuard::ConnGuard(MysqlPool &pool) : m_pool(pool) {
    {
        unique_lock<mutex> lock(pool.m_mutex);
        pool.m_cond.wait(lock, [&pool] {
            return !pool.m_ready_queue.empty() || pool.m_stop;
        });

        if (pool.m_stop) {
            m_mysql_conn = nullptr;
            return;
        }

        m_mysql_conn = pool.m_ready_queue.front();
        pool.m_ready_queue.pop();
    }
}

ConnGuard::~ConnGuard() {
    if (m_mysql_conn == nullptr) {
        return;
    }
    {
        lock_guard<mutex> lock(m_pool.m_mutex);
        m_pool.m_ready_queue.emplace(m_mysql_conn);
    }
    m_pool.m_cond.notify_one();
}

MysqlPool mysql_pool(5);