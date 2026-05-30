#pragma once

#include "agent/context/conversation_context.h"

#include <cstddef>
#include <string>
#include <vector>

namespace atrium::agent {

enum class ConversationContextPatchOperation {
    UpsertEntry,
    MarkEntryStatus,
    RemoveEntry,
    UpdateSummary,
    SetLastSummarizedMessage,
};

struct ConversationContextPatchItem {
    ConversationContextPatchOperation operation = ConversationContextPatchOperation::UpsertEntry;
    ConversationContextEntry entry;
    std::string target_entry_id;
    ConversationContextEntryStatus status = ConversationContextEntryStatus::Active;
    std::string summary;
    MessageId message_id = 0;
};

struct ConversationContextPatch {
    ConversationId conversation_id = 0;
    std::uint64_t updated_at_ms = 0;
    std::vector<ConversationContextPatchItem> items;
};

struct ConversationContextApplyResult {
    bool ok = false;
    std::string error;
    ConversationContextState state;

    static ConversationContextApplyResult success(ConversationContextState state);
    static ConversationContextApplyResult failure(std::string error, ConversationContextState state = {});
};

struct ConversationContextPolicy {
    std::size_t max_unsummarized_messages = 40;
};

class ConversationContextManager {
  public:
    explicit ConversationContextManager(ConversationContextPolicy policy = {});

    ConversationContextApplyResult applyPatch(ConversationContextState state, const ConversationContextPatch &patch) const;
    bool needsSummarization(const ConversationContextState &state, MessageId latest_message_id) const;

  private:
    bool upsertEntry(ConversationContextState &state, ConversationContextEntry entry, std::uint64_t updated_at_ms) const;
    bool markEntryStatus(ConversationContextState &state, const std::string &entry_id, ConversationContextEntryStatus status, std::uint64_t updated_at_ms) const;
    bool removeEntry(ConversationContextState &state, const std::string &entry_id) const;
    std::string nextEntryId(const ConversationContextState &state) const;

  private:
    ConversationContextPolicy m_policy;
};

const char *toString(ConversationContextPatchOperation operation);

} // namespace atrium::agent

