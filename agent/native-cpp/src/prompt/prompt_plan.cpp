#include "agent/prompt/prompt_plan.h"

#include <utility>

namespace atrium::agent {

void PromptPlan::add(PromptFragment fragment) {
    m_fragments.emplace_back(std::move(fragment));
}

void PromptPlan::addSystem(std::string name, std::string content) {
    add(PromptFragment{PromptRole::System, std::move(name), std::move(content), true});
}

void PromptPlan::addUser(std::string name, std::string content) {
    add(PromptFragment{PromptRole::User, std::move(name), std::move(content), true});
}

void PromptPlan::addAssistant(std::string name, std::string content) {
    add(PromptFragment{PromptRole::Assistant, std::move(name), std::move(content), true});
}

const std::vector<PromptFragment> &PromptPlan::fragments() const {
    return m_fragments;
}

bool PromptPlan::empty() const {
    return m_fragments.empty();
}

const char *toString(PromptRole role) {
    switch (role) {
        case PromptRole::System: return "system";
        case PromptRole::User: return "user";
        case PromptRole::Assistant: return "assistant";
        case PromptRole::Tool: return "tool";
    }
    return "unknown";
}

} // namespace atrium::agent
