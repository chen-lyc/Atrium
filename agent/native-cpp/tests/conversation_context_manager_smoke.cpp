#include "agent/context/conversation_context_manager.h"
#include "agent/context/in_memory_conversation_context_store.h"

#include <cassert>

using namespace atrium::agent;

int main() {
    ConversationContextManager manager({.max_unsummarized_messages = 10});

    ConversationContextState state;
    state.conversation_id = 77;
    state.last_summarized_message_id = 100;

    ConversationContextPatch patch;
    patch.conversation_id = 77;
    patch.updated_at_ms = 1000;

    ConversationContextPatchItem summary;
    summary.operation = ConversationContextPatchOperation::UpdateSummary;
    summary.summary = "This conversation is about building Atrium's agent context system.";
    patch.items.push_back(summary);

    ConversationContextEntry decision;
    decision.kind = ConversationContextEntryKind::Decision;
    decision.content = "Use structured conversation context as the main long-task state.";
    decision.sources.push_back(SourceAnchor{101, "user accepted direction"});

    ConversationContextPatchItem upsert;
    upsert.operation = ConversationContextPatchOperation::UpsertEntry;
    upsert.entry = decision;
    patch.items.push_back(upsert);

    auto applied = manager.applyPatch(state, patch);
    assert(applied.ok);
    assert(applied.state.summary.find("agent context") != std::string::npos);
    assert(applied.state.entries.size() == 1);
    assert(!applied.state.entries[0].id.empty());

    const auto entry_id = applied.state.entries[0].id;

    ConversationContextPatch close_patch;
    close_patch.conversation_id = 77;
    close_patch.updated_at_ms = 1100;
    ConversationContextPatchItem mark;
    mark.operation = ConversationContextPatchOperation::MarkEntryStatus;
    mark.target_entry_id = entry_id;
    mark.status = ConversationContextEntryStatus::Superseded;
    close_patch.items.push_back(mark);

    auto closed = manager.applyPatch(applied.state, close_patch);
    assert(closed.ok);
    assert(closed.state.entries[0].status == ConversationContextEntryStatus::Superseded);

    assert(!manager.needsSummarization(closed.state, 105));
    assert(manager.needsSummarization(closed.state, 111));

    InMemoryConversationContextStore store;
    auto saved = store.save(closed.state);
    assert(saved.ok);
    auto loaded = store.load(77);
    assert(loaded.has_value());
    assert(loaded->entries.size() == 1);
    assert(store.size() == 1);

    return 0;
}

