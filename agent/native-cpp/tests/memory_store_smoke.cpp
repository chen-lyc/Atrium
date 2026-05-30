#include "agent/memory/in_memory_memory_store.h"

#include <cassert>

using namespace atrium::agent;

int main() {
    InMemoryMemoryStore store;

    AgentProfile agent;
    agent.id = 42;
    agent.display_name = "Test Agent";

    TurnContext turn;
    turn.user_id = 7;
    turn.room_id = 3;
    turn.conversation_id = 9;
    turn.messages.push_back(MessageRef{
        100,
        ParticipantRef{7, ParticipantKind::User, "lyc"},
        "以后关于记忆功能回答要简洁一点",
    });

    MemoryRecord memory;
    memory.key = "reply-style";
    memory.content = "用户偏好：关于记忆功能的回答要简洁。";
    memory.scope = MemoryScope::User;
    memory.kind = MemoryKind::Preference;
    memory.user_id = 7;
    memory.tags = {"style", "memory"};
    memory.weight = 2.0;

    MemoryWriteResult write = store.upsert(memory);
    assert(write.ok);
    assert(!write.id.empty());

    auto loaded = store.loadForTurn(agent, turn);
    assert(loaded.size() == 1);
    assert(loaded[0].key == "reply-style");
    assert(loaded[0].relevance > 0.0);

    MemoryQuery tag_query;
    tag_query.user_id = 7;
    tag_query.tags = {"memory"};
    auto tagged = store.search(tag_query);
    assert(tagged.size() == 1);

    MemoryWriteResult removed = store.forget(write.id);
    assert(removed.ok);
    assert(store.loadForTurn(agent, turn).empty());

    return 0;
}

