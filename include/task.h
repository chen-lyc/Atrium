#pragma once

#include "thread_pool.h"

struct Connection;

class Task {
  public:
    Task(Connection &conn) : m_conn(conn) {}
    void process();

  private:
    Connection &m_conn;
};

extern ThreadPool<Task> thread_pool;