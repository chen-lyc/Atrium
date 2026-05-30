#pragma once

#include "agent/core/agent_types.h"

namespace atrium::agent {

struct AtriumTurnRef {
    RoomId room_id = 0;
    ConversationId conversation_id = 0;
    MessageId trigger_message_id = 0;
    MessageId context_until_message_id = 0;
    UserId user_id = 0;
};

class AtriumAgentBridge {
  public:
    virtual ~AtriumAgentBridge() = default;

    virtual TurnContext loadTurnContext(const AtriumTurnRef &ref) = 0;
    virtual void commitResponse(const AtriumTurnRef &ref, const AgentProfile &agent, const AgentResponse &response) = 0;
};

} // namespace atrium::agent
