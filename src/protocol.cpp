#include "protocol.h"
#include "connection.h"
#include "logger.h"
#include "protobuf_codec.h"
#include <algorithm>
#include <cstring>
using namespace std;

struct CheckResult {
    bool complete = false;
    size_t prefix_consumed = 0;
    size_t length = 0;
};

CheckResult checkRequest(string &inbuf, ProtocolType protocol, int fd) {
    CheckResult result;
    if (protocol == PROTO_HTTP) {
        size_t head_end_pos = inbuf.find("\r\n\r\n");
        if (head_end_pos == string::npos) {
            logger.log(AsyncLogger::DEBUG, " HTTP header incomplete : missing CRLFCRLF");
            return result;
        }

        string header_lower(head_end_pos, '\0');
        transform(inbuf.begin(), inbuf.begin() + head_end_pos, header_lower.begin(), ::tolower);

        const string key = "content-length:";
        size_t value_pos = header_lower.find(key);
        if (value_pos == string::npos) {
            logger.log(AsyncLogger::DEBUG, "HTTP no body");
            result.complete = true;
            result.length = head_end_pos + 4;
            return result;
        }
        value_pos += key.size();
        value_pos = inbuf.find_first_not_of(' ', value_pos);

        if (value_pos == string::npos) {
            logger.log(AsyncLogger::DEBUG, "HTTP incomplete or error");
            return result;
        }

        size_t value_end = inbuf.find("\r\n", value_pos);
        size_t value = stoi(inbuf.substr(value_pos, value_end - value_pos));

        size_t body_start_pos = head_end_pos + 4;
        size_t body_size = inbuf.size() - body_start_pos;
        if (body_size < value) {
            logger.log(AsyncLogger::DEBUG, "HTTP body incomplete, received body size = " + to_string(body_size) + " ,expected = " + to_string(value));
            return result;
        } else {
            logger.log(AsyncLogger::DEBUG, "HTTP received complete");
        }

        result.complete = true;
        result.length = body_start_pos + value;
        return result;
    } else if (protocol == PROTO_BINARY) {
        if (inbuf.size() < 8) {
            logger.log(AsyncLogger::DEBUG, "fd = " + to_string(fd) + " ,protobuf incomplete");
            return result;
        }

        uint32_t msg_type_debug;
        memcpy(&msg_type_debug, inbuf.data(), 4);
        if (msg_type_debug > MSG_ERROR) {
            logger.log(AsyncLogger::WARN, "protobuf type error");
            return result;
        }

        uint32_t msg_length;
        memcpy(&msg_length, inbuf.data() + 4, 4);
        logger.log(AsyncLogger::DEBUG, "fd = " + to_string(fd) + " ,is_request_complete: type=" + to_string(msg_type_debug) + " length=" + to_string(msg_length) + " inbuf_size=" + to_string(inbuf.size()));

        while (inbuf.size() >= result.prefix_consumed + 8) {
            uint32_t msg_length;
            memcpy(&msg_length, inbuf.c_str() + result.prefix_consumed + 4, 4);

            if (msg_length == 0) {
                result.prefix_consumed += 8;
                continue;
            }

            if (inbuf.size() < result.prefix_consumed + 8 + msg_length) {
                logger.log(AsyncLogger::DEBUG, "fd = " + to_string(fd) + " ,protobuf message incomplete");
                return result;
            }

            result.complete = true;
            result.length = 8 + msg_length;
            return result;
        }
        return result;
    }

    return result;
}

bool isRequestComplete(int fd) {
    string inbuf;
    {
        lock_guard<mutex> lock(conns[fd]->inbuf_mutex);
        inbuf = conns[fd]->inbuf;
    }

    CheckResult result = checkRequest(inbuf, conns[fd]->protocol, fd);
    return result.complete;
}

string getCompleteRequestSnapshot(Connection &conn) {
    string inbuf;
    {
        lock_guard<mutex> lock(conn.inbuf_mutex);
        inbuf = conn.inbuf;
    }

    CheckResult result = checkRequest(inbuf, conn.protocol, conn.fd);

    if (result.prefix_consumed) {
        lock_guard<mutex> lock(conn.inbuf_mutex);
        conn.inbuf.erase(0, result.prefix_consumed);
    }

    return inbuf.substr(0, result.length);
}