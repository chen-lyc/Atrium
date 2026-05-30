#include "agent/context/in_memory_conversation_context_store.h"
#include "agent/providers/model_gateway.h"
#include "agent/runtime/agent_runtime.h"

#include <cassert>

using namespace atrium::agent;

class CapturingModelGateway final : public ModelGateway {
  public:
    AgentResponse complete(const ModelRequest &request, ModelChunkHandler on_chunk) override {
        (void)on_chunk;
        last_request = request;
        return AgentResponse::reply("ok");
    }

    ModelRequest last_request;
};

int main() {
    InMemoryConversationContextStore context_store;
    ConversationContextState state;
    state.conversation_id = 5;
    state.summary = "Long-running discussion about Atrium layout.";

    ConversationContextEntry constraint;
    constraint.kind = ConversationContextEntryKind::Constraint;
    constraint.content = "Keep agent development separated from backend development.";
    constraint.sources.push_back(SourceAnchor{9, "boundary"});
    state.entries.push_back(constraint);

    assert(context_store.save(state).ok);

    CapturingModelGateway gateway;
    AgentRuntime runtime({.model_gateway = &gateway, .conversation_context_store = &context_store});

    AgentProfile agent;
    agent.id = 2;
    agent.display_name = "DeepSeek";

    TurnContext turn;
    turn.conversation_id = 5;
    turn.messages.push_back(MessageRef{10, ParticipantRef{1, ParticipantKind::User, "lyc"}, "继续"});

    AgentResponse response = runtime.runTurn(agent, turn);
    assert(response.decision == AgentDecision::Reply);

    bool found_context = false;
    bool found_user = false;
    for (const auto &fragment : gateway.last_request.prompt.fragments()) {
        if (fragment.name == "conversation-context" && fragment.content.find("Keep agent development") != std::string::npos) {
            found_context = true;
        }
        if (fragment.role == PromptRole::User && fragment.content == "继续") {
            found_user = true;
        }
    }

    assert(found_context);
    assert(found_user);

    return 0;
}

