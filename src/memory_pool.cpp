#include "memory_pool.h"
using namespace std;

void ConnDeleter::operator()(Connection *p) {
    p->~Connection();
    pool->deallocate(p);
}

MemoryPool::MemoryPool(size_t n) : m_n(n) {
    expand(n);
}

MemoryPool::~MemoryPool() {
    for (char *block : m_blocks) {
        delete[] block;
    }
}

unique_ptr<Connection, ConnDeleter> MemoryPool::create() {
    Connection *raw = allocate();
    new (raw) Connection();
    return unique_ptr<Connection, ConnDeleter>(raw, ConnDeleter{this});
}

Connection *MemoryPool::allocate() {
    if (m_free_list == nullptr) {
        expand(m_n);
        m_n *= 2;
    }
    Connection *p = reinterpret_cast<Connection *>(m_free_list);
    m_free_list = *reinterpret_cast<void **>(m_free_list);
    return p;
}

void MemoryPool::deallocate(Connection *p) {
    *reinterpret_cast<void **>(p) = m_free_list;
    m_free_list = p;
}

void MemoryPool::expand(size_t n) {
    char *new_block = new char[n * sizeof(Connection)];
    m_blocks.emplace_back(new_block);

    char *slot = new_block;
    for (size_t i = 0; i < n - 1; i++) {
        char *next_slot = slot + sizeof(Connection);
        *reinterpret_cast<void **>(slot) = next_slot;
        slot = next_slot;
    }
    *reinterpret_cast<void **>(slot) = m_free_list;
    m_free_list = new_block;
}