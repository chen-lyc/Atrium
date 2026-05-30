#include "agent/context/conversation_context_manager.h"

#include <algorithm>
#include <sstream>
#include <utility>

namespace atrium::agent {

ConversationContextApplyResult ConversationContextApplyResult::success(ConversationContextState state) {
    return ConversationContextApplyResult{true, "", std::move(state)};
}

ConversationContextApplyResult ConversationContextApplyResult::failure(std::string error, ConversationContextState state) {
    return ConversationContextApplyResult{false, std::move(error), std::move(state)};
}

ConversationContextManager::ConversationContextManager(ConversationContextPolicy policy) : m_policy(policy) {}

ConversationContextApplyResult ConversationContextManager::applyPatch(ConversationContextState state, const ConversationContextPatch &patch) const {
    if (patch.conversation_id == 0) {
        return ConversationContextApplyResult::failure("patch missing conversation_id", std::move(state));
    }
    if (state.conversation_id != 0 && state.conversation_id != patch.conversation_id) {
        return ConversationContextApplyResult::failure("patch conversation_id does not match state", std::move(state));
    }
    if (state.conversation_id == 0) {
        state.conversation_id = patch.conversation_id;
    }

    for (const auto &item : patch.items) {
        switch (item.operation) {
            case ConversationContextPatchOperation::UpsertEntry: {
                if (!upsertEntry(state, item.entry, patch.updated_at_ms)) {
                    return ConversationContextApplyResult::failure("failed to upsert conversation context entry", std::move(state));
                }
                break;
            }
            case ConversationContextPatchOperation::MarkEntryStatus: {
                if (!markEntryStatus(state, item.target_entry_id, item.status, patch.updated_at_ms)) {
                    return ConversationContextApplyResult::failure("conversation context entry not found: " + item.target_entry_id, std::move(state));
                }
                break;
            }
            case ConversationContextPatchOperation::RemoveEntry: {
                if (!removeEntry(state, item.target_entry_id)) {
                    return ConversationContextApplyResult::failure("conversation context entry not found: " + item.target_entry_id, std::move(state));
                }
                break;
            }
            case ConversationContextPatchOperation::UpdateSummary: {
                state.summary = item.summary;
                break;
            }
            case ConversationContextPatchOperation::SetLastSummarizedMessage: {
                state.last_summarized_message_id = item.message_id;
                break;
            }
        }
    }

    if (patch.updated_at_ms != 0) {
        state.updated_at_ms = patch.updated_at_ms;
    }

    return ConversationContextApplyResult::success(std::move(state));
}

bool ConversationContextManager::needsSummarization(const ConversationContextState &state, MessageId latest_message_id) const {
    if (latest_message_id == 0 || latest_message_id <= state.last_summarized_message_id) {
        return false;
    }
    return latest_message_id - state.last_summarized_message_id >= m_policy.max_unsummarized_messages;
}

bool ConversationContextManager::upsertEntry(ConversationContextState &state, ConversationContextEntry entry, std::uint64_t updated_at_ms) const {
    if (entry.content.empty()) {
        return false;
    }
    if (entry.id.empty()) {
        entry.id = nextEntryId(state);
    }
    if (updated_at_ms != 0) {
        entry.updated_at_ms = updated_at_ms;
        if (entry.created_at_ms == 0) {
            entry.created_at_ms = updated_at_ms;
        }
    }

    auto it = std::find_if(state.entries.begin(), state.entries.end(), [&entry](const ConversationContextEntry &existing) {
        return existing.id == entry.id;
    });

    if (it == state.entries.end()) {
        state.entries.emplace_back(std::move(entry));
        return true;
    }

    if (entry.created_at_ms == 0) {
        entry.created_at_ms = it->created_at_ms;
    }
    *it = std::move(entry);
    return true;
}

bool ConversationContextManager::markEntryStatus(ConversationContextState &state, const std::string &entry_id, ConversationContextEntryStatus status, std::uint64_t updated_at_ms) const {
    auto it = std::find_if(state.entries.begin(), state.entries.end(), [&entry_id](const ConversationContextEntry &entry) {
        return entry.id == entry_id;
    });
    if (it == state.entries.end()) {
        return false;
    }
    it->status = status;
    if (updated_at_ms != 0) {
        it->updated_at_ms = updated_at_ms;
    }
    return true;
}

bool ConversationContextManager::removeEntry(ConversationContextState &state, const std::string &entry_id) const {
    auto before = state.entries.size();
    state.entries.erase(std::remove_if(state.entries.begin(), state.entries.end(), [&entry_id](const ConversationContextEntry &entry) {
        return entry.id == entry_id;
    }), state.entries.end());
    return state.entries.size() != before;
}

std::string ConversationContextManager::nextEntryId(const ConversationContextState &state) const {
    std::ostringstream out;
    out << "ctx_" << state.conversation_id << "_" << (state.entries.size() + 1);
    return out.str();
}

const char *toString(ConversationContextPatchOperation operation) {
    switch (operation) {
        case ConversationContextPatchOperation::UpsertEntry: return "upsert_entry";
        case ConversationContextPatchOperation::MarkEntryStatus: return "mark_entry_status";
        case ConversationContextPatchOperation::RemoveEntry: return "remove_entry";
        case ConversationContextPatchOperation::UpdateSummary: return "update_summary";
        case ConversationContextPatchOperation::SetLastSummarizedMessage: return "set_last_summarized_message";
    }
    return "unknown";
}

} // namespace atrium::agent

