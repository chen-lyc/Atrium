#pragma once

#include <string>

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
    uint32_t content_length = 0;

    std::string body;

    size_t end_pos = 0;
};

ParseState parseHttpRequest(const std::string &raw, HttpRequest &req);