#include "http_codec.h"
#include "logger.h"
#include <algorithm>
#include <sstream>
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
            istringstream iss(line);
            iss >> req.method >> req.target >> req.version;
            if (req.method.empty() || req.target.empty() || req.version.empty()) {
                logger.log(AsyncLogger::DEBUG, "request_line parse error");
                req.state = PARSE_ERROR;
                break;
            }
            if (req.method != "GET" && req.method != "POST" && req.method != "HEAD") {
                logger.log(AsyncLogger::DEBUG, "request method error, method is " + req.method);
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
                logger.log(AsyncLogger::DEBUG, "headers parse error");
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
                logger.log(AsyncLogger::DEBUG, "headers parse error");
                req.state = PARSE_ERROR;
            } else if (key == "host") {
                req.host = value;
            } else if (key == "connection") {
                transform(value.begin(), value.end(), value.begin(), ::tolower);
                req.connection = value;
            } else if (key == "content-type") {
                req.content_type = value;
            } else if (key == "content-length") {
                try {
                    req.content_length = stoi(value);
                } catch (...) {
                    logger.log(AsyncLogger::WARN, "invail content-length: " + value);
                    req.state = PARSE_ERROR;
                }
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