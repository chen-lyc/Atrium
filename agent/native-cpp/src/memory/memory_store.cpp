#include "agent/memory/memory_store.h"

#include <utility>

namespace atrium::agent {

MemoryWriteResult MemoryWriteResult::success(std::string id) {
    return MemoryWriteResult{true, std::move(id), ""};
}

MemoryWriteResult MemoryWriteResult::failure(std::string error) {
    return MemoryWriteResult{false, "", std::move(error)};
}

std::vector<MemoryRecord> MemoryStore::loadForTurn(const AgentProfile &agent, const TurnContext &turn) {
    return search(buildMemoryQueryForTurn(agent, turn));
}

MemoryQuery buildMemoryQueryForTurn(const AgentProfile &agent, const TurnContext &turn) {
    MemoryQuery query;
    query.agent_id = agent.id;
    query.user_id = turn.user_id;
    query.room_id = turn.room_id;
    query.conversation_id = turn.conversation_id;
    query.limit = 8;

    if (!turn.messages.empty()) {
        query.text = turn.messages.back().content;
    }

    return query;
}

const char *toString(MemoryScope scope) {
    switch (scope) {
        case MemoryScope::Global: return "global";
        case MemoryScope::Agent: return "agent";
        case MemoryScope::User: return "user";
        case MemoryScope::Room: return "room";
        case MemoryScope::Conversation: return "conversation";
    }
    return "unknown";
}

const char *toString(MemoryKind kind) {
    switch (kind) {
        case MemoryKind::Fact: return "fact";
        case MemoryKind::Preference: return "preference";
        case MemoryKind::Summary: return "summary";
        case MemoryKind::Instruction: return "instruction";
        case MemoryKind::Observation: return "observation";
    }
    return "unknown";
}

} // namespace atrium::agent

