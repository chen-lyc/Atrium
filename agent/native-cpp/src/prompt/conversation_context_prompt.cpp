#include "agent/prompt/conversation_context_prompt.h"

#include <array>
#include <sstream>

namespace atrium::agent {

namespace {

struct SectionSpec {
    ConversationContextEntryKind kind;
    const char *title;
};

constexpr std::array<SectionSpec, 8> kSections{{
    {ConversationContextEntryKind::Goal, "Current goals"},
    {ConversationContextEntryKind::Constraint, "Active constraints"},
    {ConversationContextEntryKind::Decision, "Active decisions"},
    {ConversationContextEntryKind::RejectedOption, "Rejected options"},
    {ConversationContextEntryKind::OpenQuestion, "Open questions"},
    {ConversationContextEntryKind::Risk, "Risks and conflicts"},
    {ConversationContextEntryKind::KeyFact, "Key facts"},
    {ConversationContextEntryKind::ProgressNote, "Progress notes"},
}};

void appendSources(std::ostringstream &out, const ConversationContextEntry &entry, bool include_source_ids) {
    if (!include_source_ids || entry.sources.empty()) {
        return;
    }

    out << " [sources:";
    for (std::size_t i = 0; i < entry.sources.size(); ++i) {
        if (i > 0) {
            out << ",";
        }
        out << " #" << entry.sources[i].message_id;
    }
    out << "]";
}

} // namespace

void appendConversationContextToPrompt(PromptPlan &plan, const ConversationContextState &state, ConversationContextPromptOptions options) {
    if (state.empty()) {
        return;
    }

    plan.addSystem("conversation-context", buildConversationContextBlock(state, options));
}

std::string buildConversationContextBlock(const ConversationContextState &state, ConversationContextPromptOptions options) {
    std::ostringstream out;

    out << "Conversation context state for conversation #" << state.conversation_id << ".\n";
    out << "Use this as persistent discussion state. Respect active constraints and decisions. Do not repeat rejected options unless the user reopens them.\n";

    if (state.last_summarized_message_id != 0) {
        out << "Summary covers messages through #" << state.last_summarized_message_id << ".\n";
    }

    if (!state.summary.empty()) {
        out << "\nSummary:\n";
        out << state.summary << "\n";
    }

    for (const auto &section : kSections) {
        auto entries = entriesByKind(state, section.kind, options.include_inactive_entries);
        if (entries.empty()) {
            continue;
        }

        out << "\n" << section.title << ":\n";
        std::size_t emitted = 0;
        for (const auto &entry : entries) {
            if (options.max_entries_per_kind > 0 && emitted >= options.max_entries_per_kind) {
                break;
            }
            out << "- ";
            if (entry.status != ConversationContextEntryStatus::Active) {
                out << "[" << toString(entry.status) << "] ";
            }
            out << entry.content;
            appendSources(out, entry, options.include_source_ids);
            out << "\n";
            ++emitted;
        }
    }

    return out.str();
}

} // namespace atrium::agent

