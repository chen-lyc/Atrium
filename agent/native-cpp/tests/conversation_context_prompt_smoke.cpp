#include "agent/context/conversation_context.h"
#include "agent/prompt/conversation_context_prompt.h"
#include "agent/prompt/prompt_plan.h"

#include <cassert>
#include <string>

using namespace atrium::agent;

int main() {
    ConversationContextState state;
    state.conversation_id = 12;
    state.summary = "This conversation is a long-running frontend layout design task.";
    state.last_summarized_message_id = 88;

    ConversationContextEntry goal;
    goal.kind = ConversationContextEntryKind::Goal;
    goal.content = "Design the Atrium chat layout as a long-running discussion workspace.";
    goal.priority = 10;
    goal.sources.push_back(SourceAnchor{42, "user direction"});
    state.entries.push_back(goal);

    ConversationContextEntry constraint;
    constraint.kind = ConversationContextEntryKind::Constraint;
    constraint.content = "Agent development must stay inside agent-owned code and documents.";
    constraint.priority = 20;
    constraint.sources.push_back(SourceAnchor{43, "hard boundary"});
    state.entries.push_back(constraint);

    ConversationContextEntry rejected;
    rejected.kind = ConversationContextEntryKind::RejectedOption;
    rejected.content = "Do not model this as generic cross-room user preference memory.";
    rejected.priority = 5;
    rejected.sources.push_back(SourceAnchor{44, "scope correction"});
    state.entries.push_back(rejected);

    std::string block = buildConversationContextBlock(state);
    assert(block.find("Conversation context state for conversation #12") != std::string::npos);
    assert(block.find("Current goals") != std::string::npos);
    assert(block.find("Active constraints") != std::string::npos);
    assert(block.find("Rejected options") != std::string::npos);
    assert(block.find("#42") != std::string::npos);

    PromptPlan plan;
    appendConversationContextToPrompt(plan, state);
    assert(plan.fragments().size() == 1);
    assert(plan.fragments()[0].role == PromptRole::System);
    assert(plan.fragments()[0].name == "conversation-context");

    return 0;
}

