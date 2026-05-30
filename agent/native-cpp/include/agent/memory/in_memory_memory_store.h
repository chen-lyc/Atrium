#pragma once

#include "agent/memory/memory_store.h"

#include <mutex>

namespace atrium::agent {

class InMemoryMemoryStore final : public MemoryStore {
  public:
    std::vector<MemoryRecord> search(const MemoryQuery &query) override;
    MemoryWriteResult upsert(MemoryRecord record) override;
    MemoryWriteResult forget(const std::string &id) override;

    std::vector<MemoryRecord> listAll() const;
    void clear();

  private:
    bool matchesScope(const MemoryRecord &record, const MemoryQuery &query) const;
    double score(const MemoryRecord &record, const MemoryQuery &query) const;
    std::string nextId();
    std::optional<std::size_t> findSameMemory(const MemoryRecord &record) const;

  private:
    mutable std::mutex m_mutex;
    std::vector<MemoryRecord> m_records;
    std::uint64_t m_next_id = 1;
};

} // namespace atrium::agent

