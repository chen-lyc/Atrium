#include "protobuf_codec.h"
#include "message.pb.h"
#include <cstring>
#include <string_view>
using namespace std;

template <typename T>
static bool parseUserAuth(const string &packet, ProtobufRequest &req) {
    T message_request;
    if (!message_request.ParseFromString(packet)) {
        return false;
    }
    req.username = message_request.username();
    req.password = message_request.password();
    return true;
}

MessageType parseProtobufMessage(string_view raw, ProtobufRequest &req) {
    if (raw.size() < 8) {
        return MSG_ERROR;
    }

    uint32_t msg_type;
    memcpy(&msg_type, raw.data(), 4);
    req.msg_type = static_cast<MessageType>(msg_type);

    memcpy(&req.msg_length, raw.data() + 4, 4);

    if (raw.size() < 8 + req.msg_length) {
        return MSG_ERROR;
    } else if (req.msg_length == 0) {
        req.end_pos = 8;
        return MSG_HEARTBEAT_MSG;
    }

    req.end_pos = 8 + req.msg_length;

    string packet(raw.data() + 8, req.msg_length);

    if (req.msg_type == MSG_LOGIN_REQ) {
        if (!parseUserAuth<LoginRequest>(packet, req)) return MSG_ERROR;
    } else if (req.msg_type == MSG_REGISTER_REQ) {
        if (!parseUserAuth<RegisterRequest>(packet, req)) return MSG_ERROR;
    } else if (req.msg_type == MSG_CHAT_MSG) {
        ChatMessage chat_msg;
        if (!chat_msg.ParseFromString(packet)) {
            return MSG_ERROR;
        }

        req.sender_name = chat_msg.sender_name();
        req.msg = chat_msg.msg();
    }

    return req.msg_type;
}