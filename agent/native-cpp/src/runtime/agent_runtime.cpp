#include "agent/runtime/agent_runtime.h"

#include "agent/prompt/conversation_context_prompt.h"

#include <exception>
#include <string>
#include <utility>

namespace atrium::agent {

AgentRuntime::AgentRuntime(AgentRuntimeDeps deps) : m_deps(deps) {}

AgentResponse AgentRuntime::runTurn(const AgentProfile &agent, const TurnContext &turn) {
    if (m_deps.model_gateway == nullptr) {
        return AgentResponse::failed("agent runtime missing model gateway");
    }

    ContextPack context_pack = buildContextPack(turn);
    PromptPlan prompt = buildPrompt(agent, turn, context_pack);
    ModelRequest request{agent, std::move(prompt), true};

    try {
        return m_deps.model_gateway->complete(request, nullptr);
    } catch (const std::exception &e) {
        return AgentResponse::failed(e.what());
    }
}

PromptPlan AgentRuntime::buildPrompt(const AgentProfile &agent, const TurnContext &turn, const ContextPack &context_pack) {
    PromptPlan plan;
    plan.addSystem("agent-runtime", "You are an Atrium agent participant. Decide whether to reply, stay silent, or request more context.");

    if (m_deps.conversation_context_store != nullptr) {
        auto context_state = m_deps.conversation_context_store->load(turn.conversation_id);
        if (context_state) {
            appendConversationContextToPrompt(plan, *context_state);
        }
    }

    if (m_deps.memory_store != nullptr) {
        auto memories = m_deps.memory_store->loadForTurn(agent, turn);
        for (const auto &memory : memories) {
            std::string content = "[";
            content += toString(memory.scope);
            content += "/";
            content += toString(memory.kind);
            content += "] ";
            content += memory.content;
            plan.addSystem("memory:" + memory.key, std::move(content));
        }
    }

    for (const auto &message : context_pack.messages()) {
        if (message.sender.id == agent.id) {
            plan.addAssistant(message.sender.display_name, message.content);
        } else {
            plan.addUser(message.sender.display_name, message.content);
        }
    }

    return plan;
}

} // namespace atrium::agent
