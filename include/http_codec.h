#pragma once

#include "protocol_frame.h"
#include <string>
#include <unordered_map>

enum ParseState {
    PARSE_REQUEST_LINE,
    PARSE_HEADERS,
    PARSE_BODY,
    PARSE_DONE,
    PARSE_ERROR
};

struct HttpRequest {
    ParseState state = PARSE_REQUEST_LINE;

    std::string method;
    std::string target;
    std::string version;

    std::string host;
    std::string connection;
    std::string content_type;
    uint64_t content_length = 0;
    bool is_websocket = false;
    std::string sec_websocket_key;
    std::unordered_map<std::string, std::string> cookies;

    std::string body;
};

FrameResult checkHttpFrame(const std::string &raw, int fd);
ParseState parseHttpRequest(std::string_view raw, HttpRequest &req);