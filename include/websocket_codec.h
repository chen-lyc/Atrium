#pragma once

#include <stdint.h>
#include <string>

enum WebSocketOpcode {
    WS_TEXT = 0x1,
    WS_CLOSE = 0x8,
    WS_PING = 0x9,
    WS_PONG = 0xA,
    WS_ERROR
};

struct WebSocketRequest {
    bool fin;
    WebSocketOpcode opcode;
    bool masked;
    uint64_t payload_length;
    std::string payload_data;

    size_t end_pos = 0;
};

WebSocketOpcode parseWebSocketFrame(const std::string &raw, WebSocketRequest &req);