#pragma once

#include "agent/context/conversation_context.h"
#include "agent/prompt/prompt_plan.h"

#include <cstddef>
#include <string>

namespace atrium::agent {

struct ConversationContextPromptOptions {
    bool include_source_ids = true;
    bool include_inactive_entries = false;
    std::size_t max_entries_per_kind = 8;
};

void appendConversationContextToPrompt(PromptPlan &plan, const ConversationContextState &state, ConversationContextPromptOptions options = {});
std::string buildConversationContextBlock(const ConversationContextState &state, ConversationContextPromptOptions options = {});

} // namespace atrium::agent

