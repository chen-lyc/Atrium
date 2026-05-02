#include "http_route.h"
#include "http.h"
#include "json.hpp"
#include "logger.h"
#include "mysql_pool.h"
#include "utils.h"
#include <cstddef>
#include <exception>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>
using namespace std;
using namespace http;
using json = nlohmann::json;

namespace http {

Router::Router() {
    m_routes = {
        {"POST", {"login"}, false, handle_login},
        {"POST", {"register"}, false, handle_register},
        {"GET", {"me"}, true, handle_me},
        {"HEAD", {"me"}, true, handle_me},
        {"GET", {"rooms"}, true, handle_rooms},
        {"HEAD", {"rooms"}, true, handle_rooms},
        {"GET", {"conversations", ":conversation_id", "messages"}, true, handle_conversation_messages},
        {"HEAD", {"conversations", ":conversation_id", "messages"}, true, handle_conversation_messages},
        
    };
}

RequestLine parse_request_line(std::string_view method, std::string_view target) {
    // /rooms/42/members?limit=10
    RequestLine res;
    res.method = method;
    size_t question_pos = target.find('?');
    if (question_pos != string::npos) {
        res.query = target.substr(question_pos + 1);
    } else {
        question_pos = target.size();
    }

    size_t start = 0;
    while (start < question_pos) {
        size_t end = target.find('/', start);
        if (end == string::npos) {
            end = question_pos;
        }
        string_view value = target.substr(start, end - start);
        start = end + 1;
        if (value.empty()) continue;
        if (value == "api") continue;
        res.segments.emplace_back(std::move(value));
    }
    return res;
}

optional<Router::Route> Router::find_route(RequestLine &line, PathParams &params) {
    for (Route &route : m_routes) {
        if (match(line, route, params)) return route;
    }
    return nullopt;
}

bool Router::match(RequestLine &line, Route &route, PathParams &params) {
    if (line.segments.size() != route.pattern_segments.size()) return false;
    if (line.method != route.method) return false;
    for (size_t i = 0; i < line.segments.size(); i++) {
        if (route.pattern_segments[i][0] == ':') {
            params[route.pattern_segments[i].substr(1)] = line.segments[i];
            continue;
        }
        if (line.segments[i] != route.pattern_segments[i]) {
            params.clear();
            return false;
        }
    }
    return true;
}

RouteResult handle_login(RequestContext &ctx) {
    string username, password;
    string_view response;
    if (!get_username_and_user_id(ctx.req, username, password, response)) {
        if (!response.empty()) {
            ctx.conn.outbuf += response;
            return RouteResult::Success;
        }
        return RouteResult::BadRequest;
    }

    LoginResult ret = do_login(username, password);

    if (ret.state == LoginStatus::Success) {
        string token;
        SessionResult session_ret = create_session(ret.user_id, username, token);
        if (session_ret == SessionResult::Success) {
            ctx.conn.outbuf +=
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: application/json; charset=utf-8\r\n"
                "Content-Length: 0\r\n"
                "Set-Cookie: session_id=";
            ctx.conn.outbuf += token;
            ctx.conn.outbuf += "; PATH=/\r\n\r\n";
            return RouteResult::Success;
        } else if (session_ret == SessionResult::ServerError) {
            return RouteResult::ServerError;
        }
    } else if (ret.state == LoginStatus::ServerError) {
        return RouteResult::ServerError;
    } else if (ret.state == LoginStatus::UserNotFound) {
        ctx.conn.outbuf += resp_user_not_found;
        return RouteResult::Success;
    } else if (ret.state == LoginStatus::WrongPassword) {
        ctx.conn.outbuf += resp_wrong_password;
        return RouteResult::Success;
    }
    return RouteResult::ServerError;
}

RouteResult handle_register(RequestContext &ctx) {
    string username, password;
    string_view response;
    if (!get_username_and_user_id(ctx.req, username, password, response)) {
        if (!response.empty()) {
            ctx.conn.outbuf += response;
            return RouteResult::Success;
        }
        return RouteResult::BadRequest;
    }

    RegisterResult ret = do_register(username, password);

    if (ret.state == RegisterStatus::Success) {
        string token;
        SessionResult session_ret = create_session(ret.user_id, username, token);
        if (session_ret == SessionResult::Success) {
            uint64_t user_id = ret.user_id;
            MysqlPool::QueryResult ret = insert_public_chatroom(user_id);
            if (ret != MysqlPool::QueryResult::Success) {
                return RouteResult::ServerError;
            }
            uint64_t personal_room_id = 0;
            ret = create_personal_chatroom(personal_room_id, user_id);
            if (ret != MysqlPool::QueryResult::Success || personal_room_id == 0) {
                return RouteResult::ServerError;
            }

            ctx.conn.outbuf +=
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: application/json; charset=utf-8\r\n"
                "Content-Length: 0\r\n"
                "Set-Cookie: session_id=";
            ctx.conn.outbuf += token;
            ctx.conn.outbuf += "; PATH=/\r\n\r\n";
            return RouteResult::Success;
        } else if (session_ret == SessionResult::ServerError) {
            return RouteResult::ServerError;
        }
    } else if (ret.state == RegisterStatus::ServerError) {
        return RouteResult::ServerError;
    } else if (ret.state == RegisterStatus::UserExists) {
        ctx.conn.outbuf += resp_user_exists;
        return RouteResult::Success;
    }
    return RouteResult::ServerError;
}
RouteResult handle_me(RequestContext &ctx) {
    json out;
    out["user_id"] = ctx.user_id;
    out["username"] = ctx.username;

    string body = out.dump();
    ctx.conn.outbuf += "HTTP/1.1 200 OK\r\n";
    ctx.conn.outbuf += "Content-Type: application/json\r\n";
    ctx.conn.outbuf += "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    if (ctx.req.method == "GET") ctx.conn.outbuf += body;
    return RouteResult::Success;
}
RouteResult handle_rooms(RequestContext &ctx) {
    unordered_set<uint64_t> conversation_ids;
    MysqlPool::QueryResult get_ret = get_conversation_ids(ctx.user_id, conversation_ids);

    if (get_ret == MysqlPool::QueryResult::NotFound) {
        uint64_t conversation_id = 0;
        MysqlPool::QueryResult ret = insert_public_chatroom(conversation_id, ctx.user_id);
        if (ret != MysqlPool::QueryResult::Success) {
            return RouteResult::ServerError;
        }
        conversation_ids.emplace(conversation_id);
        ret = create_personal_chatroom(conversation_id, ctx.user_id);
        if (ret != MysqlPool::QueryResult::Success) {
            return RouteResult::ServerError;
        }
        conversation_ids.emplace(conversation_id);
        get_ret = MysqlPool::QueryResult::Success;
    }

    if (get_ret == MysqlPool::QueryResult::Success) {
        json out;
        out["user_id"] = ctx.user_id;
        out["username"] = ctx.username;
        json list = json::array();
        MysqlPool::QueryResult get_name_ret = MysqlPool::QueryResult::ServerError;
        for (auto it = conversation_ids.begin(); it != conversation_ids.end(); ++it) {
            json c;
            string name;
            get_name_ret = get_conversation_name(*it, name);
            if (get_name_ret == MysqlPool::QueryResult::ServerError) break;
            c["id"] = *it;
            c["name"] = name;
            list.emplace_back(c);
        }
        if (get_name_ret != MysqlPool::QueryResult::Success) {
            return RouteResult::ServerError;
        }
        out["conversations"] = std::move(list);
        string body = out.dump();

        ctx.conn.outbuf +=
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            "Content-Length: ";
        ctx.conn.outbuf += to_string(body.size());
        ctx.conn.outbuf += "\r\n\r\n";
        if (ctx.req.method == "GET") ctx.conn.outbuf += body;
        return RouteResult::Success;
    } else if (get_ret == MysqlPool::QueryResult::ServerError) {
        return RouteResult::ServerError;
    }
    return RouteResult::ServerError;
}
RouteResult handle_conversation_messages(RequestContext &ctx) {
    // GET /conversations/:id/messages?before_time=...&before_id=...&limit=50
    size_t query_pos = ctx.req.target.find('?');
    if (query_pos == string::npos) {
        return RouteResult::BadRequest;
    }
    string rest = ctx.req.target.substr(string_view("/api/conversations").size() + 1, query_pos);
    string query = ctx.req.target.substr(query_pos + 1);
    size_t slash_pos = rest.find('/');
    if (slash_pos == string::npos) {
        return RouteResult::BadRequest;
    }
    string id_value = rest.substr(0, slash_pos);
    uint64_t conversation_id = 0;
    try {
        conversation_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse conversation_id failed in api_conversation, value = %s, reason = %s", id_value.data(), e.what());
        return RouteResult::BadRequest;
    }

    MysqlPool::QueryResult ret = verify_conversation_member(conversation_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return RouteResult::BadRequest;
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return RouteResult::ServerError;
    }

    // GET /conversations/:id/messages?before_time=...&before_id=...&limit=50
    uint64_t before_time_ms = 0, before_message_id = 0;
    int limit = 0;
    size_t start = 0;
    string_view query_view(query);
    while (start < query.size()) {
        size_t end = query.find('&', start);
        if (end == string::npos) {
            end = query.size();
        }
        size_t eq_pos = query.find('=', start);
        if (eq_pos == string::npos) {
            return RouteResult::BadRequest;
        }

        string_view key = query_view.substr(start, eq_pos - start);
        start = eq_pos + 1;
        string_view value = query_view.substr(start, end - start);
        start = end + 1;
        if (key == "before_time") {
            try {
                before_time_ms = stoull(string(value));
            } catch (const exception &e) {
                LOG_WARN("parse query key = %.*s failed in api_conversation, value = %s, reason = %s",
                    key.size(),
                    key.data(),
                    id_value.data(),
                    e.what());
                return RouteResult::BadRequest;
            }
        } else if (key == "before_id") {
            try {
                before_message_id = stoull(string(value));
            } catch (const exception &e) {
                LOG_WARN("parse query key = %.*s failed in api_conversation, value = %s, reason = %s",
                    key.size(),
                    key.data(),
                    id_value.data(),
                    e.what());
                return RouteResult::BadRequest;
            }
        } else if (key == "limit") {
            try {
                limit = stoull(string(value));
            } catch (const exception &e) {
                LOG_WARN("parse query key = %.*s failed in api_conversation, value = %s, reason = %s",
                    key.size(),
                    key.data(),
                    id_value.data(),
                    e.what());
                return RouteResult::BadRequest;
            }
        }
    }
    if (!limit) {
        return RouteResult::BadRequest;
    }
    ret = MysqlPool::QueryResult::ServerError;
    vector<vector<string>> rows;
    if (!before_time_ms && !before_message_id) {
        ret = get_recent_messages(conversation_id, nullopt, limit + 1, rows);
    } else if (before_time_ms && before_message_id) {
        chatdb::Cursor cursor{before_time_ms, before_message_id};
        ret = get_recent_messages(conversation_id, cursor, limit + 1, rows);
    } else {
        return RouteResult::BadRequest;
    }
    if (ret == MysqlPool::QueryResult::ServerError || ret == MysqlPool::QueryResult::SqlError) {
        return RouteResult::ServerError;
    }
    bool has_more = rows.size() > limit;
    size_t size = rows.size() - static_cast<size_t>(has_more);

    string body;
    try {
        json out;
        json list = json::array();
        for (size_t i = 0; i < size; ++i) {
            json msg;
            msg["message_id"] = rows[i][0];
            msg["send_id"] = rows[i][1];
            msg["type"] = rows[i][2];
            msg["content"] = rows[i][3];
            msg["send_time_ms"] = rows[i][4];
            list.emplace_back(msg);
        }
        out["messages"] = std::move(list);
        out["has_more"] = has_more;
        body = out.dump();
    } catch (const exception &e) {
        LOG_WARN("json encode failed: %e", e.what());
        return RouteResult::BadRequest;
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += std::to_string(body.size());
    ctx.conn.outbuf +=
        "\r\n"
        "Connection: keep-alive\r\n"
        "\r\n";
    if (ctx.req.method == "GET") ctx.conn.outbuf += body;
    return RouteResult::Success;
}

} // namespace http
