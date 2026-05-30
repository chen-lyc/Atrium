#pragma once

#include "agent/core/agent_types.h"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace atrium::agent {

enum class ConversationContextEntryKind {
    Goal,
    Constraint,
    Decision,
    RejectedOption,
    OpenQuestion,
    Risk,
    KeyFact,
    ProgressNote,
};

enum class ConversationContextEntryStatus {
    Active,
    Superseded,
    Resolved,
    Rejected,
};

struct SourceAnchor {
    MessageId message_id = 0;
    std::string note;
};

struct ConversationContextEntry {
    std::string id;
    ConversationContextEntryKind kind = ConversationContextEntryKind::KeyFact;
    ConversationContextEntryStatus status = ConversationContextEntryStatus::Active;
    std::string content;
    std::vector<SourceAnchor> sources;
    std::uint32_t priority = 0;
    std::uint64_t created_at_ms = 0;
    std::uint64_t updated_at_ms = 0;
};

struct ConversationContextState {
    ConversationId conversation_id = 0;
    std::string summary;
    std::vector<ConversationContextEntry> entries;
    MessageId last_summarized_message_id = 0;
    std::uint64_t updated_at_ms = 0;

    bool empty() const;
};

struct ConversationContextWriteResult {
    bool ok = false;
    std::string error;

    static ConversationContextWriteResult success();
    static ConversationContextWriteResult failure(std::string error);
};

class ConversationContextStore {
  public:
    virtual ~ConversationContextStore() = default;
    virtual std::optional<ConversationContextState> load(ConversationId conversation_id) = 0;
    virtual ConversationContextWriteResult save(ConversationContextState state) = 0;
};

class NullConversationContextStore final : public ConversationContextStore {
  public:
    std::optional<ConversationContextState> load(ConversationId conversation_id) override {
        (void)conversation_id;
        return std::nullopt;
    }

    ConversationContextWriteResult save(ConversationContextState state) override {
        (void)state;
        return ConversationContextWriteResult::failure("null conversation context store is read-only");
    }
};

std::vector<ConversationContextEntry> entriesByKind(const ConversationContextState &state, ConversationContextEntryKind kind, bool include_inactive = false);
const char *toString(ConversationContextEntryKind kind);
const char *toString(ConversationContextEntryStatus status);

} // namespace atrium::agent

