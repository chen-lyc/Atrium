#include "protobuf_codec.h"
#include "message.pb.h"
#include <cstring>
using namespace std;

MessageType parseProtobufMessage(string &raw, ProtobufRequest &req) {
    if (raw.size() < 8) {
        return MSG_ERROR;
    }

    uint32_t msg_type;
    memcpy(&msg_type, raw.c_str(), 4);
    req.msg_type = static_cast<MessageType>(msg_type);

    memcpy(&req.msg_length, raw.c_str() + 4, 4);

    if (raw.size() < 8 + req.msg_length) {
        return MSG_ERROR;
    } else if (req.msg_length == 0) {
        req.end_pos = 8;
        return MSG_HEARTBEAT_MSG;
    }

    req.end_pos = 8 + req.msg_length;

    string packet = raw.substr(8, size_t(req.msg_length));

    if (req.msg_type == MSG_LOGIN_REQ) {
        LoginRequest message_request;
        if (!message_request.ParseFromString(packet)) {
            return MSG_ERROR;
        }

        req.username = message_request.username();
        req.password = message_request.password();
    } else if (req.msg_type == MSG_REGISTER_REQ) {
        RegisterRequest message_request;
        if (!message_request.ParseFromString(packet)) {
            return MSG_ERROR;
        }

        req.username = message_request.username();
        req.password = message_request.password();
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