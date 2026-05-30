#pragma once

#include "agent/context/conversation_context.h"

#include <mutex>
#include <unordered_map>

namespace atrium::agent {

class InMemoryConversationContextStore final : public ConversationContextStore {
  public:
    std::optional<ConversationContextState> load(ConversationId conversation_id) override;
    ConversationContextWriteResult save(ConversationContextState state) override;

    void clear();
    std::size_t size() const;

  private:
    mutable std::mutex m_mutex;
    std::unordered_map<ConversationId, ConversationContextState> m_states;
};

} // namespace atrium::agent

