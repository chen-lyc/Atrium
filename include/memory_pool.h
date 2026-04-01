#pragma once

#include <connection.h>
#include <cstddef>
#include <memory>
#include <vector>

class MemoryPool;

struct ConnDeleter {
    MemoryPool *pool;
    void operator()(Connection *p);
};

class MemoryPool {
  public:
    MemoryPool(size_t n);
    ~MemoryPool();
    std::unique_ptr<Connection, ConnDeleter> create();
    void deallocate(Connection *p);

  private:
    Connection *allocate();
    void expand(size_t n);

  private:
    size_t m_n;
    std::vector<char *> m_blocks;
    void *m_free_list = nullptr;
};