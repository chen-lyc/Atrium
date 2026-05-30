#include "agent/context/in_memory_conversation_context_store.h"

#include <utility>

namespace atrium::agent {

std::optional<ConversationContextState> InMemoryConversationContextStore::load(ConversationId conversation_id) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = m_states.find(conversation_id);
    if (it == m_states.end()) {
        return std::nullopt;
    }
    return it->second;
}

ConversationContextWriteResult InMemoryConversationContextStore::save(ConversationContextState state) {
    if (state.conversation_id == 0) {
        return ConversationContextWriteResult::failure("conversation context state missing conversation_id");
    }

    std::lock_guard<std::mutex> lock(m_mutex);
    m_states[state.conversation_id] = std::move(state);
    return ConversationContextWriteResult::success();
}

void InMemoryConversationContextStore::clear() {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_states.clear();
}

std::size_t InMemoryConversationContextStore::size() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_states.size();
}

} // namespace atrium::agent

