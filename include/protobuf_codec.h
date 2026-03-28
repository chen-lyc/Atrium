#pragma once

#include <cstdlib>
#include <string>

enum MessageType {
    MSG_LOGIN_REQ,
    MSG_LOGIN_RESP,
    MSG_REGISTER_REQ,
    MSG_REGISTER_RESP,
    MSG_CHAT_MSG,
    MSG_HEARTBEAT_MSG,
    MSG_ERROR
};

struct ProtobufRequest {
    MessageType msg_type;
    std::uint32_t msg_length;
    std::string username;
    std::string password;

    std::string sender_name;
    std::string msg;

    size_t end_pos = 0;
};

MessageType parseProtobufMessage(std::string_view raw, ProtobufRequest &req);