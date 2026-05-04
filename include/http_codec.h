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

enum class Method {
    GET = 0,
    HEAD,
    POST,
    PATCH,
    DELETE,
};

struct HttpRequest {
    ParseState state = PARSE_REQUEST_LINE;

    Method method;
    std::string target;
    std::string version;

    std::string host;
    std::string connection;
    std::string content_type;
    uint64_t content_length = 0;
    std::string upgrade;
    int sec_websocket_version = 0;
    std::string sec_websocket_key;
    std::unordered_map<std::string, std::string> cookies;

    std::string body;
};

std::string_view methodToString(Method method);
FrameResult checkHttpFrame(const std::string &raw, int fd);
ParseState parseHttpRequest(std::string_view raw, HttpRequest &req);