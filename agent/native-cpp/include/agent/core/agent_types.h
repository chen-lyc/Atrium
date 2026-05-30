#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace atrium::agent {

using AgentId = std::uint64_t;
using ConversationId = std::uint64_t;
using MessageId = std::uint64_t;
using RoomId = std::uint64_t;
using UserId = std::uint64_t;

enum class ParticipantKind {
    User,
    Agent,
    System,
};

enum class TurnSource {
    UserMessage,
    AgentMessage,
    SystemEvent,
};

enum class AgentDecision {
    NoReply,
    Reply,
    UseTool,
    NeedsContext,
    Failed,
};

struct ParticipantRef {
    std::uint64_t id = 0;
    ParticipantKind kind = ParticipantKind::User;
    std::string display_name;
};

struct MessageRef {
    MessageId id = 0;
    ParticipantRef sender;
    std::string content;
};

struct AgentProfile {
    AgentId id = 0;
    std::string provider;
    std::string model;
    std::string display_name;
};

struct TurnContext {
    RoomId room_id = 0;
    ConversationId conversation_id = 0;
    UserId user_id = 0;
    MessageId trigger_message_id = 0;
    MessageId context_until_message_id = 0;
    TurnSource source = TurnSource::UserMessage;
    std::vector<MessageRef> messages;
};

struct AgentResponse {
    AgentDecision decision = AgentDecision::NoReply;
    std::string content;
    std::string error;

    static AgentResponse noReply();
    static AgentResponse reply(std::string content);
    static AgentResponse failed(std::string error);
};

std::string_view toString(ParticipantKind kind);
std::string_view toString(TurnSource source);
std::string_view toString(AgentDecision decision);

} // namespace atrium::agent

