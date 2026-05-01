#pragma once

#include "protocol_frame.h"
#include <stdint.h>
#include <string>

enum WebSocketOpcode {
    WS_CONT = 0x0,
    WS_TEXT = 0x1,
    WS_CLOSE = 0x8,
    WS_PING = 0x9,
    WS_PONG = 0xA,

    WS_PROTOCOLERROR = 1002,
    WS_SERVERERROR = 1011
};

struct WebSocketRequest {
    bool fin;
    WebSocketOpcode opcode;
    bool masked;
    uint64_t payload_length;
    std::string payload_data;
};

FrameResult checkWebSocketFrame(std::string_view raw, int fd);
WebSocketOpcode parseWebSocketFrame(std::string_view raw, WebSocketRequest &req);
bool isValidSecWebSocketKey(const std::string &key);