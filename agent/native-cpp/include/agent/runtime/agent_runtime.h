#pragma once

#include "agent/context/conversation_context.h"
#include "agent/context/context_pack.h"
#include "agent/core/agent_types.h"
#include "agent/memory/memory_store.h"
#include "agent/prompt/prompt_plan.h"
#include "agent/providers/model_gateway.h"
#include "agent/tools/tool_registry.h"

namespace atrium::agent {

struct AgentRuntimeDeps {
    ModelGateway *model_gateway = nullptr;
    ConversationContextStore *conversation_context_store = nullptr;
    MemoryStore *memory_store = nullptr;
    ToolRegistry *tool_registry = nullptr;
};

class AgentRuntime {
  public:
    explicit AgentRuntime(AgentRuntimeDeps deps);

    AgentResponse runTurn(const AgentProfile &agent, const TurnContext &turn);
    PromptPlan buildPrompt(const AgentProfile &agent, const TurnContext &turn, const ContextPack &context_pack);

  private:
    AgentRuntimeDeps m_deps;
};

} // namespace atrium::agent
