#include "protobuf_codec.h"
#include "logger.h"
#include "message.pb.h"
#include <cstring>
#include <string_view>
using namespace std;

FrameResult checkProtobufFrame(string &raw, int fd) {
    FrameResult res{FrameStatus::Incomplete};

    if (raw.size() < 8) {
        LOG_DEBUG("protobuf incomplete");
        return res;
    }

    uint32_t msg_type_debug;
    memcpy(&msg_type_debug, raw.data(), 4);
    if (msg_type_debug > MSG_ERROR) {
        LOG_DEBUG("protobuf type error");
        return res;
    }

    uint32_t msg_length;
    memcpy(&msg_length, raw.data() + 4, 4);
    LOG_DEBUG("is_request_complete: type=%u length=%u inbuf_size=%zu",
              static_cast<unsigned int>(msg_type_debug),
              static_cast<unsigned int>(msg_length),
              raw.size());

    size_t prefix_consumed = 0;
    while (raw.size() >= prefix_consumed + 8) {
        uint32_t msg_length;
        memcpy(&msg_length, raw.data() + prefix_consumed + 4, 4);

        if (msg_length == 0) {
            prefix_consumed += 8;
            continue;
        }

        if (raw.size() < prefix_consumed + 8 + msg_length) {
            LOG_DEBUG("protobuf message incomplete");
            return res;
        }

        raw.erase(0, prefix_consumed);
        res.status = FrameStatus::Complete;
        res.end_pos = 8 + msg_length;
        return res;
    }
    raw.erase(0, prefix_consumed);
    return res;
}

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
        return MSG_HEARTBEAT_MSG;
    }


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