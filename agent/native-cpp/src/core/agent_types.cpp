#include "agent/core/agent_types.h"

#include <utility>

namespace atrium::agent {

AgentResponse AgentResponse::noReply() {
    return AgentResponse{AgentDecision::NoReply, "", ""};
}

AgentResponse AgentResponse::reply(std::string content) {
    return AgentResponse{AgentDecision::Reply, std::move(content), ""};
}

AgentResponse AgentResponse::failed(std::string error) {
    return AgentResponse{AgentDecision::Failed, "", std::move(error)};
}

std::string_view toString(ParticipantKind kind) {
    switch (kind) {
        case ParticipantKind::User: return "user";
        case ParticipantKind::Agent: return "agent";
        case ParticipantKind::System: return "system";
    }
    return "unknown";
}

std::string_view toString(TurnSource source) {
    switch (source) {
        case TurnSource::UserMessage: return "user_message";
        case TurnSource::AgentMessage: return "agent_message";
        case TurnSource::SystemEvent: return "system_event";
    }
    return "unknown";
}

std::string_view toString(AgentDecision decision) {
    switch (decision) {
        case AgentDecision::NoReply: return "no_reply";
        case AgentDecision::Reply: return "reply";
        case AgentDecision::UseTool: return "use_tool";
        case AgentDecision::NeedsContext: return "needs_context";
        case AgentDecision::Failed: return "failed";
    }
    return "unknown";
}

} // namespace atrium::agent
