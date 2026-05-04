#include "http_codec.h"
#include "logger.h"
#include <algorithm>
#include <cstring>
#include <string_view>
using namespace std;

static bool keyEqualsLower(string_view key, string_view target_lower) {
    if (key.size() != target_lower.size()) return false;
    for (size_t i = 0; i < key.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(key[i])) != target_lower[i]) return false;
    }
    return true;
}

std::string_view methodToString(Method method) {
    switch (method) {
    case Method::GET:
        return "GET";
    case Method::HEAD:
        return "HEAD";
    case Method::POST:
        return "POST";
    case Method::PATCH:
        return "PATCH";
    case Method::DELETE:
        return "DELETE";
    }
    return "UNKNOWN";
}

FrameResult checkHttpFrame(const string &raw, int fd) {
    FrameResult res{FrameStatus::Incomplete};

    size_t head_end_pos = raw.find("\r\n\r\n");
    if (head_end_pos == string::npos) {
        LOG_DEBUG("fd = %d HTTP header incomplete : missing CRLFCRLF", fd);
        return res;
    }

    size_t index = raw.find("\r\n") + 2;
    size_t pos;
    string_view raw_view(raw.data(), head_end_pos + 2);
    string_view line;
    static constexpr string_view target_lower = "content-length";
    uint64_t content_length = 0;
    int target_lower_count = 0;
    while ((pos = raw_view.find("\r\n", index)) != string::npos) {
        line = raw_view.substr(index, pos - index);

        size_t colon_pos = line.find(':');
        if (colon_pos == string::npos) {
            LOG_DEBUG("fd = %d headers not find :", fd);
            res.status = FrameStatus::ProtocolError;
            return res;
        }
        string_view key = line.substr(0, colon_pos);

        if (key.empty()) {
            LOG_DEBUG("fd = %d headers without char", fd);
            res.status = FrameStatus::ProtocolError;
            return res;
        } else if (keyEqualsLower(key, target_lower)) {
            if (++target_lower_count > 1) {
                res.status = FrameStatus::ProtocolError;
                return res;
            }

            string value_str(line.substr(colon_pos + 1));
            size_t start = value_str.find_first_not_of(" \t");
            size_t end = value_str.find_last_not_of(" \t");
            if (start == string::npos || end == string::npos) {
                LOG_DEBUG("fd = %d send bad request with incomplete content-length line", fd);
                res.status = FrameStatus::ProtocolError;
                return res;
            }
            value_str.erase(end + 1);
            value_str.erase(0, start);

            if (value_str[0] == '-') {
                LOG_WARN("fd = %d send bad request with negative content-length", fd);
                res.status = FrameStatus::ProtocolError;
                return res;
            }

            size_t parsed_len;
            try {
                content_length = static_cast<uint64_t>(stoull(value_str, &parsed_len));
            } catch (const invalid_argument &e) {
                LOG_WARN("fd = %d send bad request with invalid content-length, reason = %s", fd, e.what());
                res.status = FrameStatus::ProtocolError;
                return res;
            } catch (const out_of_range &e) {
                LOG_WARN("fd = %d send bad request with too large content-length, reason = %s", fd, e.what());
                res.status = FrameStatus::ProtocolError;
                return res;
            }
            if (parsed_len != value_str.size()) {
                LOG_WARN("fd = %d send bad request with trailing characters in content-length, raw = %s",
                    fd,
                    value_str.data());
                res.status = FrameStatus::ProtocolError;
                return res;
            }
        }

        index = pos + 2;
    }
    if (target_lower_count == 0) {
        res.status = FrameStatus::Complete;
        res.end_pos = head_end_pos + 4;
        return res;
    }

    size_t body_start_pos = head_end_pos + 4;
    size_t body_size = raw.size() - body_start_pos;
    if (body_size < content_length) {
        LOG_DEBUG("fd = %d HTTP body incomplete, received body size = %zu ,expected = %llu",
            fd,
            body_size,
            static_cast<unsigned long long>(content_length));
        return res;
    } else {
        LOG_DEBUG("fd = %d HTTP received complete", fd);
    }

    res.status = FrameStatus::Complete;
    res.end_pos = body_start_pos + content_length;
    return res;
}

ParseState parseHttpRequest(string_view raw, HttpRequest &req) {
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
            if (end == string::npos) {
                req.state = PARSE_ERROR;
                return PARSE_ERROR;
            }

            string_view line_view(line);
            string_view method = line_view.substr(start, end - start);
            if (method == "GET") {
                req.method = Method::GET;
            } else if (method == "HEAD") {
                req.method = Method::HEAD;
            } else if (method == "POST") {
                req.method = Method::POST;
            } else if (method == "PATCH") {
                req.method = Method::PATCH;
            } else if (method == "DELETE") {
                req.method = Method::DELETE;
            } else {
                LOG_DEBUG("request method error, method is %s", method.data());
                req.state = PARSE_ERROR;
                return PARSE_ERROR;
            }

            start = end + 1;
            end = line.find(' ', start);
            if (end == string::npos) {
                req.state = PARSE_ERROR;
                return PARSE_ERROR;
            }
            req.target = line.substr(start, end - start);
            req.version = line.substr(end + 1);
            if (method.empty() || req.target.empty() || req.version.empty()) {
                LOG_DEBUG("request_line parse error");
                req.state = PARSE_ERROR;
                break;
            }

            req.state = PARSE_HEADERS;
            break;
        }

        case PARSE_HEADERS: {
            if (line.empty()) {
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
            size_t end = value.find_last_not_of(' ');
            if (end != string::npos) {
                value.erase(end + 1);
            }

            transform(key.begin(), key.end(), key.begin(), ::tolower);

            if (key.empty() || value.empty()) {
                LOG_DEBUG("headers parse error");
                req.state = PARSE_ERROR;
            } else if (key == "host") {
                req.host = std::move(value);
            } else if (key == "connection") {
                transform(value.begin(), value.end(), value.begin(), ::tolower);
                req.connection = std::move(value);
            } else if (key == "content-type") {
                size_t semi_pos = value.find(';'); // application/json; charset=utf-8
                if (semi_pos != string::npos) {
                    value.erase(semi_pos);
                }

                size_t start = value.find_first_not_of(" \t");
                size_t end = value.find_last_not_of(" \t");
                if (start == string::npos) {
                    req.state = PARSE_ERROR;
                    return PARSE_ERROR;
                }
                value = value.substr(start, end - start + 1);
                transform(value.begin(), value.end(), value.begin(), ::tolower);
                req.content_type = std::move(value);
            } else if (key == "content-length") {
                try {
                    req.content_length = stoull(value);
                } catch (...) {
                    LOG_WARN("invalid content-length: %s", value.c_str());
                    req.state = PARSE_ERROR;
                }
            } else if (key == "upgrade") {
                transform(value.begin(), value.end(), value.begin(), ::tolower);
                req.upgrade = std::move(value);
            } else if (key == "sec-websocket-version") {
                size_t end = 0;
                try {
                    req.sec_websocket_version = stoi(value, &end);
                } catch (const invalid_argument &e) {
                    LOG_WARN("invalid sec-websocket-version, value = %s, reason = %s", value.data(), e.what());
                    req.sec_websocket_version = -1;
                } catch (const out_of_range &e) {
                    LOG_WARN("sec-websocket-version out of range, value = %s, reason = %s", value.data(), e.what());
                    req.sec_websocket_version = -1;
                }
                if (end != value.size()) {
                    req.state = PARSE_ERROR;
                    return PARSE_ERROR;
                }
            } else if (key == "sec-websocket-key") {
                req.sec_websocket_key = std::move(value);
            } else if (key == "cookie") {
                size_t start = 0;
                while (start < value.size()) {
                    size_t eq_pos = value.find('=', start);
                    if (eq_pos == string::npos) {
                        req.state = PARSE_ERROR;
                        return PARSE_ERROR;
                    }

                    size_t end = value.find(';', eq_pos + 1);
                    if (end == string::npos) end = value.size();

                    string key(value.data() + start, eq_pos - start);
                    start = eq_pos + 1;
                    string val(value.data() + start, end - start);
                    req.cookies[key] = val;

                    start = value.find_first_not_of(" \t", end + 1);
                    if (start == string::npos) {
                        break;
                    }
                }
            }
            break;
        }

        case PARSE_BODY: {
            req.body = raw.substr(index, static_cast<size_t>(req.content_length));
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
