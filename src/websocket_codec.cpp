#include "websocket_codec.h"
#include <cstring>
#include <netinet/in.h>
using namespace std;

WebSocketOpcode parseWebSocketFrame(const std::string &raw, WebSocketRequest &req) {
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
        req.opcode = WS_ERROR;
        return WS_ERROR;
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
        return WS_ERROR;
    }

    uint8_t masking_key[4];
    memcpy(masking_key, raw.data() + prefix_length, 4);
    prefix_length += 4;

    req.payload_data.assign(raw.data() + prefix_length, req.payload_length);
    for (uint64_t i = 0; i < req.payload_length; i++) {
        req.payload_data[i] ^= masking_key[i % 4];
    }

    req.end_pos = prefix_length + req.payload_length;
    return req.opcode;
}