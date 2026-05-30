#include "agent/context/conversation_context.h"

#include <algorithm>
#include <utility>

namespace atrium::agent {

bool ConversationContextState::empty() const {
    return summary.empty() && entries.empty();
}

ConversationContextWriteResult ConversationContextWriteResult::success() {
    return ConversationContextWriteResult{true, ""};
}

ConversationContextWriteResult ConversationContextWriteResult::failure(std::string error) {
    return ConversationContextWriteResult{false, std::move(error)};
}

std::vector<ConversationContextEntry> entriesByKind(const ConversationContextState &state, ConversationContextEntryKind kind, bool include_inactive) {
    std::vector<ConversationContextEntry> entries;
    for (const auto &entry : state.entries) {
        if (entry.kind != kind) {
            continue;
        }
        if (!include_inactive && entry.status != ConversationContextEntryStatus::Active) {
            continue;
        }
        entries.emplace_back(entry);
    }

    std::sort(entries.begin(), entries.end(), [](const ConversationContextEntry &lhs, const ConversationContextEntry &rhs) {
        if (lhs.priority != rhs.priority) {
            return lhs.priority > rhs.priority;
        }
        return lhs.updated_at_ms > rhs.updated_at_ms;
    });

    return entries;
}

const char *toString(ConversationContextEntryKind kind) {
    switch (kind) {
        case ConversationContextEntryKind::Goal: return "goal";
        case ConversationContextEntryKind::Constraint: return "constraint";
        case ConversationContextEntryKind::Decision: return "decision";
        case ConversationContextEntryKind::RejectedOption: return "rejected_option";
        case ConversationContextEntryKind::OpenQuestion: return "open_question";
        case ConversationContextEntryKind::Risk: return "risk";
        case ConversationContextEntryKind::KeyFact: return "key_fact";
        case ConversationContextEntryKind::ProgressNote: return "progress_note";
    }
    return "unknown";
}

const char *toString(ConversationContextEntryStatus status) {
    switch (status) {
        case ConversationContextEntryStatus::Active: return "active";
        case ConversationContextEntryStatus::Superseded: return "superseded";
        case ConversationContextEntryStatus::Resolved: return "resolved";
        case ConversationContextEntryStatus::Rejected: return "rejected";
    }
    return "unknown";
}

} // namespace atrium::agent

