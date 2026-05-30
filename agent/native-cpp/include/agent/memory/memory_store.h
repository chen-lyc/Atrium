#pragma once

#include "agent/core/agent_types.h"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace atrium::agent {

enum class MemoryScope {
    Global,
    Agent,
    User,
    Room,
    Conversation,
};

enum class MemoryKind {
    Fact,
    Preference,
    Summary,
    Instruction,
    Observation,
};

struct MemoryRecord {
    std::string id;
    std::string key;
    std::string content;
    MemoryScope scope = MemoryScope::Conversation;
    MemoryKind kind = MemoryKind::Fact;
    AgentId agent_id = 0;
    UserId user_id = 0;
    RoomId room_id = 0;
    ConversationId conversation_id = 0;
    MessageId source_message_id = 0;
    std::uint64_t created_at_ms = 0;
    std::uint64_t updated_at_ms = 0;
    std::vector<std::string> tags;
    double weight = 1.0;
    double relevance = 0.0;
    bool pinned = false;
};

struct MemoryQuery {
    AgentId agent_id = 0;
    UserId user_id = 0;
    RoomId room_id = 0;
    ConversationId conversation_id = 0;
    std::string text;
    std::vector<std::string> tags;
    std::size_t limit = 8;
    bool include_global = true;
};

struct MemoryWriteResult {
    bool ok = false;
    std::string id;
    std::string error;

    static MemoryWriteResult success(std::string id);
    static MemoryWriteResult failure(std::string error);
};

class MemoryStore {
  public:
    virtual ~MemoryStore() = default;
    virtual std::vector<MemoryRecord> search(const MemoryQuery &query) = 0;
    virtual MemoryWriteResult upsert(MemoryRecord record) = 0;
    virtual MemoryWriteResult forget(const std::string &id) = 0;

    virtual std::vector<MemoryRecord> loadForTurn(const AgentProfile &agent, const TurnContext &turn);
};

class NullMemoryStore final : public MemoryStore {
  public:
    std::vector<MemoryRecord> search(const MemoryQuery &query) override {
        (void)query;
        return {};
    }

    MemoryWriteResult upsert(MemoryRecord record) override {
        (void)record;
        return MemoryWriteResult::failure("null memory store is read-only");
    }

    MemoryWriteResult forget(const std::string &id) override {
        (void)id;
        return MemoryWriteResult::failure("null memory store is read-only");
    }
};

MemoryQuery buildMemoryQueryForTurn(const AgentProfile &agent, const TurnContext &turn);
const char *toString(MemoryScope scope);
const char *toString(MemoryKind kind);

} // namespace atrium::agent
