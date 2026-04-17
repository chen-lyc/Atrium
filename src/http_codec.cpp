#include "http_codec.h"
#include "logger.h"
#include <algorithm>
#include <string_view>
using namespace std;

ParseState parseHttpRequest(const string &raw, HttpRequest &req) {
    size_t index = 0;
    size_t pos;
    string line;
    while (req.state == PARSE_BODY || (pos = raw.find("\r\n", index)) != string::npos) {
        if (req.state == PARSE_REQUEST_LINE || req.state == PARSE_HEADERS) {
            line = raw.substr(index, pos - index);
            index = pos + 2;
        }
        switch (req.state) {
        case PARSE_REQUEST_LINE: {
            size_t start = 0;
            size_t end = line.find(' ');
            req.method = line.substr(start, end - start);
            start = end + 1;
            end = line.find(' ', start);
            req.target = line.substr(start, end - start);
            req.version = line.substr(end + 1);
            if (req.method.empty() || req.target.empty() || req.version.empty()) {
                LOG_DEBUG("request_line parse error");
                req.state = PARSE_ERROR;
                break;
            }
            if (req.method != "GET" && req.method != "POST" && req.method != "HEAD") {
                LOG_DEBUG("request method error, method is " + req.method);
                req.state = PARSE_ERROR;
                break;
            }
            req.state = PARSE_HEADERS;
            break;
        }

        case PARSE_HEADERS: {
            if (line.empty()) {
                req.end_pos = index + req.content_length;
                if (req.content_length > 0) {
                    req.state = PARSE_BODY;
                } else {
                    req.state = PARSE_DONE;
                }
                break;
            }

            size_t colon_pos = line.find(':');
            if (colon_pos == string::npos) {
                LOG_DEBUG("headers parse error");
                req.state = PARSE_ERROR;
                break;
            }
            string key = line.substr(0, colon_pos);
            string value = line.substr(colon_pos + 1);

            size_t start = value.find_first_not_of(' ');
            if (start != string::npos) {
                value.erase(0, start);
            }

            transform(key.begin(), key.end(), key.begin(), ::tolower);

            if (key.empty() || value.empty()) {
                LOG_DEBUG("headers parse error");
                req.state = PARSE_ERROR;
            } else if (key == "host") {
                req.host = move(value);
            } else if (key == "connection") {
                transform(value.begin(), value.end(), value.begin(), ::tolower);
                req.connection = move(value);
            } else if (key == "content-type") {
                req.content_type = move(value);
            } else if (key == "content-length") {
                try {
                    req.content_length = stoi(value);
                } catch (...) {
                    LOG_WARN("invail content-length: " + value);
                    req.state = PARSE_ERROR;
                }
            } else if (key == "upgrade") {
                transform(value.begin(), value.end(), value.begin(), ::tolower);
                if (value == "websocket") {
                    req.is_websocket = true;
                }
            } else if (key == "sec-websocket-key") {
                LOG_DEBUG("key size: " + to_string(value.size()) + ", key: [" + value + "]");
                req.sec_websocket_key = value;
            }
            break;
        }

        case PARSE_BODY: {
            req.body = raw.substr(index, req.content_length);
            req.state = PARSE_DONE;
            return PARSE_DONE;
        }

        case PARSE_DONE:
            return PARSE_DONE;

        case PARSE_ERROR:
            return PARSE_ERROR;
        }
    }
    return req.state;
}