#include "websocket_codec.h"
#include "logger.h"
#include <cstring>
#include <netinet/in.h>
using namespace std;

constexpr uint64_t MAX_FRAME_SIZE = 1 * 1024 * 1024;

FrameResult checkWebSocketFrame(string_view raw, int fd) {
    FrameResult res{FrameStatus::Incomplete};

    uint64_t prefix_length = 2;
    if (raw.size() < prefix_length) {
        LOG_DEBUG("fd = %d, websocket incomplete", fd);
        return res;
    }

    uint8_t byte1 = static_cast<uint8_t>(raw[1]);
    bool masked = byte1 & 0x80;
    uint64_t payload_length = byte1 & 0x7F;

    auto read_extended_length = [&](int len) {
        if (raw.size() < prefix_length + len) {
            LOG_DEBUG("fd = %d, websocket payload_length incomplete", fd);
            return false;
        }

        if (len == 2) {
            uint16_t ext;
            memcpy(&ext, raw.data() + prefix_length, len);
            payload_length = ntohs(ext);
        } else if (len == 8) {
            uint64_t ext;
            memcpy(&ext, raw.data() + prefix_length, len);
            payload_length = be64toh(ext);
        }
        prefix_length += len;
        return true;
    };

    if (payload_length == 126) {
        if (!read_extended_length(2)) {
            return res;
        }
    } else if (payload_length == 127) {
        if (!read_extended_length(8)) {
            return res;
        }
    }

    prefix_length += 4 * masked;

    if (payload_length > MAX_FRAME_SIZE - prefix_length) {
        res.status = FrameStatus::ProtocolError;
        return res;
    }

    if (raw.size() < prefix_length + payload_length) {
        LOG_DEBUG("fd = %d, websocket payload_data incomplete", fd);
        return res;
    }
    res.status = FrameStatus::Complete;
    res.end_pos = prefix_length + payload_length;
    return res;
}

WebSocketOpcode parseWebSocketFrame(string_view raw, WebSocketRequest &req) {
    uint8_t byte0 = static_cast<uint8_t>(raw[0]);
    uint8_t byte1 = static_cast<uint8_t>(raw[1]);

    req.fin = byte0 & 0x80;
    uint8_t opcode = byte0 & 0x0F;
    switch (opcode) {
    case 0x1:
        req.opcode = WS_TEXT;
        break;

    case 0x8:
        req.opcode = WS_CLOSE;
        break;

    case 0x9:
        req.opcode = WS_PING;
        break;

    case 0xA:
        req.opcode = WS_PONG;
        break;

    default:
        req.opcode = WS_PROTOCOLERROR;
        return WS_PROTOCOLERROR;
    }
    if (req.fin == 0 || req.opcode == WS_CONT) {
        req.opcode = WS_PROTOCOLERROR;
        return WS_PROTOCOLERROR;
    }

    int prefix_length = 2;

    req.masked = byte1 & 0x80;
    req.payload_length = byte1 & 0x7F;
    if (req.payload_length == 126) {
        uint16_t ext;
        memcpy(&ext, raw.data() + prefix_length, 2);
        req.payload_length = ntohs(ext);
        prefix_length += 2;
    } else if (req.payload_length == 127) {
        uint64_t ext;
        memcpy(&ext, raw.data() + prefix_length, 8);
        req.payload_length = be64toh(ext);
        prefix_length += 8;
    }

    if (!req.masked) {
        return WS_PROTOCOLERROR;
    }

    uint8_t masking_key[4];
    memcpy(masking_key, raw.data() + prefix_length, 4);
    prefix_length += 4;

    req.payload_data.assign(raw.data() + prefix_length, req.payload_length);
    for (uint64_t i = 0; i < req.payload_length; i++) {
        req.payload_data[i] ^= masking_key[i % 4];
    }

    return req.opcode;
}

bool isValidSecWebSocketKey(const std::string &key) {
    if (key.size() != 24) return false;
    if (key[22] != '=' || key[23] != '=') return false;

    for (int i = 0; i < 22; i++) {
        if (!(isalnum(static_cast<unsigned char>(key[i])) || key[i] == '/' || key[i] == '+')) {
            return false;
        }
    }

    return true;
}