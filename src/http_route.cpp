#include "http_route.h"
#include "http.h"
#include "json.hpp"
#include "logger.h"
#include "mysql_pool.h"
#include "utils.h"
#include <chrono>
#include <cstddef>
#include <exception>
#include <optional>
#include <string>
#include <string_view>
#include <vector>
using namespace std;
using json = nlohmann::json;

namespace http {

Router::Router() {
    m_routes = {
        {Method::POST, {"login"}, false, handle_login},
        {Method::POST, {"register"}, false, handle_register},
        {Method::GET, {"me"}, true, handle_me},
        {Method::HEAD, {"me"}, true, handle_me},
        {Method::PATCH, {"me"}, true, handle_update_me},
        {Method::GET, {"me", "ai-usage"}, true, handle_me_ai_usage},
        {Method::HEAD, {"me", "ai-usage"}, true, handle_me_ai_usage},
        {Method::GET, {"me", "ai-usage", "today"}, true, handle_me_ai_usage_today},
        {Method::HEAD, {"me", "ai-usage", "today"}, true, handle_me_ai_usage_today},
        {Method::GET, {"users", "search"}, true, handle_search_users},
        {Method::HEAD, {"users", "search"}, true, handle_search_users},
        {Method::GET, {"rooms"}, true, handle_list_rooms},
        {Method::HEAD, {"rooms"}, true, handle_list_rooms},
        {Method::GET, {"rooms", ":room_id", "conversations"}, true, handle_list_room_conversations},
        {Method::HEAD, {"rooms", ":room_id", "conversations"}, true, handle_list_room_conversations},
        {Method::POST, {"rooms", ":room_id", "conversations"}, true, handle_create_conversation},
        {Method::GET, {"conversations", ":conversation_id", "messages"}, true, handle_conversation_messages},
        {Method::HEAD, {"conversations", ":conversation_id", "messages"}, true, handle_conversation_messages},
        {Method::GET, {"conversations", ":conversation_id", "model"}, true, handle_conversation_model},
        {Method::HEAD, {"conversations", ":conversation_id", "model"}, true, handle_conversation_model},
        {Method::DELETE, {"conversations", ":conversation_id"}, true, handle_delete_conversation},
        {Method::PATCH, {"conversations", ":conv_id", "title"}, true, handle_rename_conversation},
        {Method::DELETE, {"messages", ":message_id"}, true, handle_delete_message},

        {Method::POST, {"rooms"}, true, handle_create_room},
        {Method::DELETE, {"rooms", ":room_id"}, true, handle_delete_room},
        {Method::PATCH, {"rooms", ":room_id"}, true, handle_update_room},
        {Method::DELETE, {"rooms", ":room_id", "members", ":user_id"}, true, handle_kick_or_leave_room},
        {Method::PATCH, {"rooms", ":room_id", "members", ":user_id"}, true, handle_set_room_member_role},
        {Method::GET, {"rooms", ":room_id", "members"}, true, handle_list_room_members},
        {Method::HEAD, {"rooms", ":room_id", "members"}, true, handle_list_room_members},
        {Method::POST, {"rooms", ":room_id", "invitations"}, true, handle_create_room_invitation},
        {Method::GET, {"rooms", ":room_id", "invitations"}, true, handle_list_room_invitations},
        {Method::HEAD, {"rooms", ":room_id", "invitations"}, true, handle_list_room_invitations},

        {Method::PATCH, {"invitations", ":invitation_id"}, true, handle_respond_room_invitation},
        {Method::DELETE, {"invitations", ":invitation_id"}, true, handle_cancel_invitation},
        {Method::GET, {"invitations"}, true, handle_list_my_invitations},
        {Method::HEAD, {"invitations"}, true, handle_list_my_invitations},

        {Method::POST, {"friend-requests"}, true, handle_create_friend_request},
        {Method::PATCH, {"friend-requests", ":request_id"}, true, handle_respond_friend_request},
        {Method::GET, {"friend-requests"}, true, handle_list_friend_requests},
        {Method::HEAD, {"friend-requests"}, true, handle_list_friend_requests},
        {Method::DELETE, {"friend-requests", ":request_id"}, true, handle_cancel_friend_request},
        {Method::GET, {"friends"}, true, handle_list_friends},
        {Method::HEAD, {"friends"}, true, handle_list_friends},
        {Method::DELETE, {"friends", ":user_id"}, true, handle_delete_friend},
        {Method::GET, {"ais"}, true, handle_list_ais},
        {Method::HEAD, {"ais"}, true, handle_list_ais},
        {Method::GET, {"thinking-adapters"}, true, handle_list_thinking_adapters},
        {Method::HEAD, {"thinking-adapters"}, true, handle_list_thinking_adapters},
        {Method::GET, {"rooms", ":room_id", "ai-members"}, true, handle_list_room_ai_members},
        {Method::HEAD, {"rooms", ":room_id", "ai-members"}, true, handle_list_room_ai_members},
        {Method::POST, {"rooms", ":room_id", "ai-members"}, true, handle_create_room_ai_member},
        {Method::PATCH, {"rooms", ":room_id", "ai-members", ":ai_id"}, true, handle_update_room_ai_member},
        {Method::DELETE, {"rooms", ":room_id", "ai-members", ":ai_id"}, true, handle_delete_room_ai_member},
        {Method::GET, {"conversations", ":conv_id", "ai-members"}, true, handle_list_conversation_ai_members},
        {Method::HEAD, {"conversations", ":conv_id", "ai-members"}, true, handle_list_conversation_ai_members},
        {Method::POST, {"conversations", ":conv_id", "ai-members"}, true, handle_create_conversation_ai_member},
        {Method::PATCH, {"conversations", ":conv_id", "ai-members", ":ai_id"}, true, handle_update_conversation_ai_member},
        {Method::DELETE, {"conversations", ":conv_id", "ai-members", ":ai_id"}, true, handle_delete_conversation_ai_member},
    };
}

RequestLine parse_request_line(Method method, std::string_view target) {
    // /rooms/42/members?limit=10
    RequestLine res;
    res.method = method;
    size_t question_pos = target.find('?');
    if (question_pos == string::npos) {
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

// 业务逻辑
RouteResult handle_login(RequestContext &ctx) {
    string username, password;
    string_view response;
    if (!get_username_and_user_id(ctx.req, username, password, response)) {
        if (!response.empty()) {
            ctx.conn.outbuf += response;
            return {RouteStatus::Success};
        }
        return {RouteStatus::BadRequest};
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
            return {RouteStatus::Success};
        } else if (session_ret == SessionResult::ServerError) {
            return {RouteStatus::ServerError};
        }
    } else if (ret.state == LoginStatus::ServerError) {
        return {RouteStatus::ServerError};
    } else if (ret.state == LoginStatus::UserNotFound) {
        ctx.conn.outbuf += resp_user_not_found;
        return {RouteStatus::Success};
    } else if (ret.state == LoginStatus::WrongPassword) {
        ctx.conn.outbuf += resp_wrong_password;
        return {RouteStatus::Success};
    }
    return {RouteStatus::ServerError};
}

RouteResult handle_register(RequestContext &ctx) {
    string username, password;
    string_view response;
    if (!get_username_and_user_id(ctx.req, username, password, response)) {
        if (!response.empty()) {
            ctx.conn.outbuf += response;
            return {RouteStatus::Success};
        }
        return {RouteStatus::BadRequest};
    }

    RegisterResult ret = do_register(username, password);

    if (ret.state == RegisterStatus::Success) {
        string token;
        SessionResult session_ret = create_session(ret.user_id, username, token);
        if (session_ret == SessionResult::Success) {
            uint64_t user_id = ret.user_id;
            MysqlPool::QueryResult ret = join_public_room(user_id);
            if (ret != MysqlPool::QueryResult::Success) {
                return {RouteStatus::ServerError};
            }
            uint64_t personal_room_id = 0;
            static string personal_room_name = "个人讨论室";
            uint64_t main_conv_id = 0;
            ret = create_room(personal_room_id, main_conv_id, personal_room_name, user_id, RoomType::Personal);
            if (ret != MysqlPool::QueryResult::Success || personal_room_id == 0) {
                return {RouteStatus::ServerError};
            }

            ctx.conn.outbuf +=
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: application/json; charset=utf-8\r\n"
                "Content-Length: 0\r\n"
                "Set-Cookie: session_id=";
            ctx.conn.outbuf += token;
            ctx.conn.outbuf += "; PATH=/\r\n\r\n";
            return {RouteStatus::Success};
        } else if (session_ret == SessionResult::ServerError) {
            return {RouteStatus::ServerError};
        }
    } else if (ret.state == RegisterStatus::ServerError) {
        return {RouteStatus::ServerError};
    } else if (ret.state == RegisterStatus::UserExists) {
        ctx.conn.outbuf += resp_user_exists;
        return {RouteStatus::Success};
    }
    return {RouteStatus::ServerError};
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
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_update_me(RequestContext &ctx) {
    // PATCH /api/me
    // 权限：登录用户改自己
    // body: {"username"?: string, "nickname"?: string, "avatar_url"?: string}
    bool has_username = false;
    bool has_nickname = false;
    bool has_avatar_url = false;
    string username;
    string nickname;
    string avatar_url;
    try {
        json in = json::parse(ctx.req.body);
        if (in.contains("username")) {
            username = in["username"];
            has_username = true;
        }
        if (in.contains("nickname")) {
            nickname = in["nickname"];
            has_nickname = true;
        }
        if (in.contains("avatar_url")) {
            avatar_url = in["avatar_url"];
            has_avatar_url = true;
        }
    } catch (const exception &e) {
        LOG_WARN("bad json in handle_update_me: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    string cur_username, cur_nickname, cur_avatar_url;
    MysqlPool::QueryResult ret = get_user_profile(ctx.user_id, cur_username, cur_nickname, cur_avatar_url);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    if (has_username) {
        if (!username.empty() && !is_valid_username(username)) {
            return {RouteStatus::BadRequest};
        }
        ret = update_username(ctx.user_id, username);
        if (ret == MysqlPool::QueryResult::AlreadyExists) {
            return {RouteStatus::BadRequest};
        }
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
    }

    if (!has_nickname) {
        nickname = std::move(cur_nickname);
    }
    if (!has_avatar_url) {
        avatar_url = std::move(cur_avatar_url);
    }
    if (!has_username && !has_nickname && !has_avatar_url) {
        return {RouteStatus::BadRequest};
    }
    if (has_nickname || has_avatar_url) {
        if (nickname.size() < 1 || nickname.size() > 64) {
            return {RouteStatus::BadRequest};
        }
        if (avatar_url.size() > 255) {
            return {RouteStatus::BadRequest};
        }
        ret = update_user_profile(ctx.user_id, nickname, avatar_url);
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_me_ai_usage(RequestContext &ctx) {
    vector<pair<string, vector<DailyUsage>>> models;
    MysqlPool::QueryResult ret = get_user_ai_usage_history(ctx.user_id, models);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    json out;
    uint64_t total_prompt = 0, total_completion = 0;
    json models_json = json::array();
    for (auto &[model_name, days] : models) {
        json model_obj;
        model_obj["model"] = model_name;
        json days_json = json::array();
        for (auto &d : days) {
            json day;
            day["date"] = d.date;
            day["input_cached_tokens"] = d.input_cached_tokens;
            day["input_uncached_tokens"] = d.input_uncached_tokens;
            day["completion_tokens"] = d.output_tokens;
            day["request_count"] = d.request_count;
            total_prompt += d.input_cached_tokens + d.input_uncached_tokens;
            total_completion += d.output_tokens;
            days_json.emplace_back(std::move(day));
        }
        model_obj["days"] = std::move(days_json);
        models_json.emplace_back(std::move(model_obj));
    }
    out["models"] = std::move(models_json);
    out["prompt_tokens"] = total_prompt;
    out["completion_tokens"] = total_completion;
    out["total_tokens"] = total_prompt + total_completion;
    string body = out.dump();

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += std::to_string(body.size());
    ctx.conn.outbuf +=
        "\r\n"
        "Connection: keep-alive\r\n"
        "\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}

RouteResult handle_me_ai_usage_today(RequestContext &ctx) {
    vector<TodayUsage> models;
    MysqlPool::QueryResult ret = get_user_ai_tokens_today(ctx.user_id, models);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    json out;
    uint64_t total_prompt = 0, total_completion = 0;
    json models_json = json::array();
    for (auto &m : models) {
        json model_obj;
        model_obj["model"] = m.model;
        json day;
        day["date"] = m.date;
        day["input_cached_tokens"] = m.input_cached_tokens;
        day["input_uncached_tokens"] = m.input_uncached_tokens;
        day["completion_tokens"] = m.output_tokens;
        day["request_count"] = m.request_count;
        total_prompt += m.input_cached_tokens + m.input_uncached_tokens;
        total_completion += m.output_tokens;
        model_obj["days"] = json::array({std::move(day)});
        models_json.emplace_back(std::move(model_obj));
    }
    out["models"] = std::move(models_json);
    out["prompt_tokens"] = total_prompt;
    out["completion_tokens"] = total_completion;
    out["total_tokens"] = total_prompt + total_completion;
    string body = out.dump();

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += std::to_string(body.size());
    ctx.conn.outbuf +=
        "\r\n"
        "Connection: keep-alive\r\n"
        "\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_search_users(RequestContext &ctx) {
    // GET /api/users/search?q=xxx
    // 权限：登录用户
    // 行为：q 全数字 → 按 user_id 精确匹配；否则按 nickname / username 模糊匹配
    // 返回：[{user_id, username, nickname, avatar_url}]，最多 20 条
    size_t query_pos = ctx.req.target.find('?');
    if (query_pos == string::npos) {
        return {RouteStatus::BadRequest};
    }
    string query = ctx.req.target.substr(query_pos + 1);
    string_view query_view(query);
    string q;
    if (query_view.starts_with("q=")) {
        q = query.substr(2);
    } else {
        return {RouteStatus::BadRequest};
    }
    if (q.empty()) {
        return {RouteStatus::BadRequest};
    }
    optional<string> decoded = url_decode(q);
    if (decoded.has_value()) {
        q = std::move(decoded.value());
    }

    vector<vector<string>> rows;
    MysqlPool::QueryResult ret = search_users(q, rows);
    if (ret == MysqlPool::QueryResult::ServerError || ret == MysqlPool::QueryResult::SqlError) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (size_t i = 0; i < rows.size(); ++i) {
            json u;
            u["user_id"] = rows[i][0];
            u["username"] = rows[i][1];
            u["nickname"] = rows[i][2];
            u["avatar_url"] = rows[i][3];
            out.emplace_back(u);
        }
        body = out.dump();
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_search_users: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_list_rooms(RequestContext &ctx) {
    vector<RoomBrief> room_list;
    MysqlPool::QueryResult get_ret = get_rooms_with_data(ctx.user_id, room_list);

    if (get_ret == MysqlPool::QueryResult::NotFound) {
        uint64_t room_id = 0;
        MysqlPool::QueryResult ret = join_public_room(room_id, ctx.user_id);
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
        static string personal_room_name = "个人讨论室";
        uint64_t main_conv_id = 0;
        ret = create_room(room_id, main_conv_id, personal_room_name, ctx.user_id, RoomType::Personal);
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
        get_ret = get_rooms_with_data(ctx.user_id, room_list);
    }

    if (get_ret == MysqlPool::QueryResult::Success) {
        json out;
        json list = json::array();
        for (auto &entry : room_list) {
            json r;
            r["id"] = entry.id;
            r["name"] = std::move(entry.name);
            r["main_conversation_id"] = entry.main_conversation_id;
            r["type"] = entry.type;
            list.emplace_back(r);
        }
        out["rooms"] = std::move(list);
        string body = out.dump();

        ctx.conn.outbuf +=
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            "Content-Length: ";
        ctx.conn.outbuf += to_string(body.size());
        ctx.conn.outbuf += "\r\n\r\n";
        if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
        return {RouteStatus::Success};
    } else if (get_ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }
    return {RouteStatus::ServerError};
}
RouteResult handle_list_room_conversations(RequestContext &ctx) {
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse conversation_id failed in api_room_members, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }
    MysqlPool::QueryResult ret = verify_room_member(room_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    vector<uint64_t> conversation_ids;
    vector<string> titles;
    vector<uint64_t> created_at_ms;
    ret = get_list_conversations_by_room_id(room_id, conversation_ids, titles, created_at_ms);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    string room_name;
    uint64_t main_conversation_id = 0;
    int room_type = 0;
    ret = get_room_data(room_id, room_name, main_conversation_id, room_type);
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    json out;
    out["main_conversation_id"] = main_conversation_id;
    json list = json::array();
    for (size_t i = 0; i < conversation_ids.size(); ++i) {
        json c;
        c["id"] = conversation_ids[i];
        c["title"] = titles[i];
        c["created_at_ms"] = created_at_ms[i];
        list.emplace_back(c);
    }
    out["conversations"] = list;
    string body = out.dump();
    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_conversation_messages(RequestContext &ctx) {
    // GET /conversations/:id/messages?before_time=...&before_id=...&limit=50
    size_t query_pos = ctx.req.target.find('?');
    if (query_pos == string::npos) {
        return {RouteStatus::BadRequest};
    }
    string query = ctx.req.target.substr(query_pos + 1);
    string id_value(ctx.params["conversation_id"]);
    uint64_t conversation_id = 0;
    try {
        conversation_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse conversation_id failed in api_conversation, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret = verify_conversation_member(conversation_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
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
            return {RouteStatus::BadRequest};
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
                return {RouteStatus::BadRequest};
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
                return {RouteStatus::BadRequest};
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
                return {RouteStatus::BadRequest};
            }
        }
    }
    if (!limit) {
        return {RouteStatus::BadRequest};
    }
    ret = MysqlPool::QueryResult::ServerError;
    vector<vector<string>> rows;
    if (!before_time_ms && !before_message_id) {
        ret = get_recent_messages(conversation_id, nullopt, limit + 1, rows);
    } else if (before_time_ms && before_message_id) {
        chatdb::Cursor cursor{before_time_ms, before_message_id};
        ret = get_recent_messages(conversation_id, cursor, limit + 1, rows);
    } else {
        return {RouteStatus::BadRequest};
    }
    if (ret == MysqlPool::QueryResult::ServerError || ret == MysqlPool::QueryResult::SqlError) {
        return {RouteStatus::ServerError};
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
            msg["display_name"] = rows[i][2];
            msg["avatar_url"] = rows[i][3];
            msg["type"] = rows[i][4];
            msg["content"] = rows[i][5];
            msg["send_time_ms"] = rows[i][6];
            msg["conversation_id"] = rows[i][7];
            msg["client_message_id"] = rows[i][8];
            string_view kind = rows[i][9];
            if (kind == "2") msg["sender_type"] = "ai";
            else if (kind == "3") msg["sender_type"] = "system";
            else msg["sender_type"] = "user";
            msg["provider"] = rows[i][10];
            msg["model"] = rows[i][11];
            list.emplace_back(msg);
        }
        out["messages"] = std::move(list);
        out["has_more"] = has_more;
        body = out.dump();
    } catch (const exception &e) {
        LOG_WARN("json encode failed: %s", e.what());
        return {RouteStatus::BadRequest};
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
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}

RouteResult handle_conversation_model(RequestContext &ctx) {
    string id_value(ctx.params["conversation_id"]);
    uint64_t conversation_id = 0;
    try {
        conversation_id = stoull(id_value);
    } catch (const exception &e) {
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret = verify_conversation_member(conversation_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    string provider, model;
    ret = get_conversation_ai_model(conversation_id, provider, model);

    json out;
    if (ret == MysqlPool::QueryResult::Success) {
        out["provider"] = std::move(provider);
        out["model"] = std::move(model);
    } else {
        out["provider"] = "";
        out["model"] = "";
    }
    string body = out.dump();

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += std::to_string(body.size());
    ctx.conn.outbuf +=
        "\r\n"
        "Connection: keep-alive\r\n"
        "\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}

RouteResult handle_create_room(RequestContext &ctx) {
    // POST /api/rooms
    string name;
    try {
        json in = json::parse(ctx.req.body);
        name = in["room_name"];
    } catch (const exception &e) {
        LOG_WARN("bad json: %s", e.what());
        return {RouteStatus::BadRequest};
    }
    if (name.empty() || name.size() > 32) {
        return {RouteStatus::BadRequest};
    }

    uint64_t room_id = 0;
    uint64_t main_conversation_id = 0;
    MysqlPool::QueryResult ret = create_room(room_id, main_conversation_id, name, ctx.user_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    ctx.conn.room_ids.emplace(room_id);
    try {
        json out;
        out["room_id"] = room_id;
        out["main_conversation_id"] = main_conversation_id;
        string body = out.dump();
        ctx.conn.outbuf +=
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            "Content-Length: ";
        ctx.conn.outbuf += to_string(body.size());
        ctx.conn.outbuf += "\r\n\r\n";
        ctx.conn.outbuf += body;
        return {RouteStatus::Success};
    } catch (const exception &e) {
        LOG_WARN("bad json: %s", e.what());
        return {RouteStatus::BadRequest};
    }
}
RouteResult handle_delete_room(RequestContext &ctx) {
    // DELETE /api/rooms/:room_id
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse room_id failed in api_delete_room, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }
    MysqlPool::QueryResult ret = check_room_owner_id(room_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    string room_name;
    uint64_t main_conv_id = 0;
    int room_type = 0;
    ret = get_room_data(room_id, room_name, main_conv_id, room_type);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (static_cast<RoomType>(room_type) != RoomType::Normal) {
        return {RouteStatus::BadRequest};
    }

    vector<uint64_t> member_ids;
    ret = get_user_ids_by_room(room_id, member_ids);
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    ret = delete_room(room_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success, MembershipAction::Leave, room_id, std::move(member_ids)};
}
RouteResult handle_update_room(RequestContext &ctx) {
    // PATCH /api/rooms/:room_id
    // 权限：只有 owner 可改
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse room_id failed in handle_update_room, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }
    MysqlPool::QueryResult ret = check_room_owner_id(room_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    string name;
    try {
        json in = json::parse(ctx.req.body);
        name = in["name"];
    } catch (const exception &e) {
        LOG_WARN("bad json in handle_update_room: %s", e.what());
        return {RouteStatus::BadRequest};
    }
    if (name.empty() || name.size() > 32) {
        return {RouteStatus::BadRequest};
    }

    ret = update_room_name(room_id, name);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_kick_or_leave_room(RequestContext &ctx) {
    // DELETE /api/rooms/:room_id/members/:user_id
    // 权限：删除自己 = 退出（任何成员）；删除他人 = owner 或 admin
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse room_id failed in handle_kick_or_leave_room, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }
    string target_id_value(ctx.params["user_id"]);
    uint64_t target_user_id = 0;
    try {
        target_user_id = stoull(target_id_value);
    } catch (const exception &e) {
        LOG_WARN("parse user_id failed in handle_kick_or_leave_room, value = %s, reason = %s", target_id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    int target_role = 0;
    MysqlPool::QueryResult ret = get_room_member_role(room_id, target_user_id, target_role);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    if (target_user_id == ctx.user_id && target_role == static_cast<int>(RoomRole::Owner)) {
        return {RouteStatus::BadRequest};
    }

    if (target_user_id == ctx.user_id) {
        string room_name;
        uint64_t main_conv_id = 0;
        int room_type = 0;
        ret = get_room_data(room_id, room_name, main_conv_id, room_type);
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
        if (static_cast<RoomType>(room_type) != RoomType::Normal) {
            return {RouteStatus::BadRequest};
        }
    }

    if (target_user_id != ctx.user_id) {
        int my_role = 0;
        ret = get_room_member_role(room_id, ctx.user_id, my_role);
        if (ret == MysqlPool::QueryResult::NotFound) {
            return {RouteStatus::BadRequest};
        }
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
        if (my_role != static_cast<int>(RoomRole::Owner) && my_role != static_cast<int>(RoomRole::Admin)) {
            return {RouteStatus::BadRequest};
        }
        if (target_role == static_cast<int>(RoomRole::Owner)) {
            return {RouteStatus::BadRequest};
        }
    }

    ret = remove_room_member(room_id, target_user_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success, MembershipAction::Leave, room_id, std::vector<uint64_t>{target_user_id}};
}
RouteResult handle_set_room_member_role(RequestContext &ctx) {
    // PATCH /api/rooms/:room_id/members/:user_id
    // 权限：只有 owner
    // body: {"role": 1 | 2}
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse room_id failed in handle_set_room_member_role, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }
    string target_id_value(ctx.params["user_id"]);
    uint64_t target_user_id = 0;
    try {
        target_user_id = stoull(target_id_value);
    } catch (const exception &e) {
        LOG_WARN("parse user_id failed in handle_set_room_member_role, value = %s, reason = %s", target_id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret = check_room_owner_id(room_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (target_user_id == ctx.user_id) {
        return {RouteStatus::BadRequest};
    }

    int target_role = 0;
    ret = get_room_member_role(room_id, target_user_id, target_role);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    int new_role = 0;
    try {
        json in = json::parse(ctx.req.body);
        new_role = in["role"];
    } catch (const exception &e) {
        LOG_WARN("bad json in handle_set_room_member_role: %s", e.what());
        return {RouteStatus::BadRequest};
    }
    if (new_role != static_cast<int>(RoomRole::Admin) && new_role != static_cast<int>(RoomRole::Member)) {
        return {RouteStatus::BadRequest};
    }

    ret = update_room_member_role(room_id, target_user_id, new_role);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_list_room_members(RequestContext &ctx) {
    // GET /api/rooms/:room_id/members
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse room_id failed in handle_list_room_members, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret = verify_room_member(room_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    vector<vector<string>> rows;
    ret = get_room_members(room_id, rows);
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (size_t i = 0; i < rows.size(); ++i) {
            json m;
            m["user_id"] = rows[i][0];
            m["username"] = rows[i][1];
            m["nickname"] = rows[i][2];
            m["role"] = rows[i][3];
            m["join_at_ms"] = rows[i][4];
            out.emplace_back(m);
        }
        body = out.dump();
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_list_room_members: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_create_room_invitation(RequestContext &ctx) {
    // POST /api/rooms/:room_id/invitations
    // 权限：必须是房间成员（任何角色）
    // body: {"invitee_id": uint64}
    // 校验：
    //   当前用户是房间成员
    //   被邀请人和当前用户是好友
    //   被邀请人还不是房间成员
    //   没有重复 pending 邀请（依赖 UNIQUE 索引）
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse room_id failed in handle_create_invitation, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    uint64_t invitee_id = 0;
    try {
        json in = json::parse(ctx.req.body);
        invitee_id = in["invitee_id"];
    } catch (const exception &e) {
        LOG_WARN("bad json in handle_create_invitation: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret = verify_room_member(room_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    {
        string room_name;
        uint64_t main_conv_id = 0;
        int room_type = 0;
        ret = get_room_data(room_id, room_name, main_conv_id, room_type);
        if (ret == MysqlPool::QueryResult::Success && static_cast<RoomType>(room_type) == RoomType::Personal) {
            return {RouteStatus::BadRequest};
        }
    }

    ret = check_friendship(ctx.user_id, invitee_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ret = verify_room_member(room_id, invitee_id);
    if (ret == MysqlPool::QueryResult::Success) {
        return {RouteStatus::BadRequest};
    }
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    uint64_t invitation_id = 0;
    ret = insert_invitation(invitation_id, room_id, ctx.user_id, invitee_id);
    if (ret == MysqlPool::QueryResult::AlreadyExists) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    try {
        json out;
        out["invitation_id"] = invitation_id;
        string body = out.dump();
        ctx.conn.outbuf +=
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            "Content-Length: ";
        ctx.conn.outbuf += to_string(body.size());
        ctx.conn.outbuf += "\r\n\r\n";
        ctx.conn.outbuf += body;
        return {RouteStatus::Success};
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_create_invitation: %s", e.what());
        return {RouteStatus::BadRequest};
    }
}
RouteResult handle_respond_room_invitation(RequestContext &ctx) {
    // PATCH /api/invitations/:invitation_id
    // 权限：当前用户是被邀请人
    // body: {"status": "accepted" | "rejected"}
    // 行为：
    //   accepted: INSERT room_members + DELETE invitations
    //   rejected: 直接 DELETE invitations
    string id_value(ctx.params["invitation_id"]);
    uint64_t invitation_id = 0;
    try {
        invitation_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse invitation_id failed in handle_respond_invitation, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    uint64_t room_id = 0, inviter_id = 0, invitee_id = 0;
    MysqlPool::QueryResult ret = get_invitation(invitation_id, room_id, inviter_id, invitee_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (invitee_id != ctx.user_id) {
        return {RouteStatus::BadRequest};
    }

    string status;
    try {
        json in = json::parse(ctx.req.body);
        status = in["status"];
    } catch (const exception &e) {
        LOG_WARN("bad json in handle_respond_invitation: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    if (status == "accepted") {
        string room_name;
        uint64_t main_conv_id = 0;
        int room_type = 0;
        MysqlPool::QueryResult type_ret = get_room_data(room_id, room_name, main_conv_id, room_type);
        if (type_ret == MysqlPool::QueryResult::Success && static_cast<RoomType>(room_type) == RoomType::Personal) {
            return {RouteStatus::BadRequest};
        }

        ret = accept_room_invitation(room_id, ctx.user_id, invitation_id);
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }

        ctx.conn.outbuf +=
            "HTTP/1.1 200 OK\r\n"
            "Content-Length: 0\r\n"
            "\r\n";
        return {RouteStatus::Success, MembershipAction::Join, room_id, std::vector<uint64_t>{ctx.user_id}};
    } else if (status == "rejected") {
        ret = delete_invitation(invitation_id);
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
    } else {
        return {RouteStatus::BadRequest};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_list_room_invitations(RequestContext &ctx) {
    // GET /api/rooms/:room_id/invitations
    // 权限：房间成员
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse room_id failed in handle_list_room_invitations, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret = verify_room_member(room_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    vector<vector<string>> rows;
    ret = get_room_invitations(room_id, rows);
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (size_t i = 0; i < rows.size(); ++i) {
            json inv;
            inv["invitation_id"] = rows[i][0];
            inv["invitee_id"] = rows[i][1];
            inv["invitee_nickname"] = rows[i][2];
            inv["created_at_ms"] = rows[i][3];
            out.emplace_back(inv);
        }
        body = out.dump();
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_list_room_invitations: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_list_my_invitations(RequestContext &ctx) {
    // GET /api/invitations?direction=received|sent
    // 权限：登录用户
    size_t query_pos = ctx.req.target.find('?');
    if (query_pos == string::npos) {
        return {RouteStatus::BadRequest};
    }
    string query = ctx.req.target.substr(query_pos + 1);
    string direction;
    if (query.starts_with("direction=")) {
        direction = query.substr(10);
    } else {
        return {RouteStatus::BadRequest};
    }
    if (direction.empty()) {
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret;
    vector<vector<string>> rows;
    if (direction == "received") {
        ret = get_invitations_by_invitee(ctx.user_id, rows);
    } else if (direction == "sent") {
        ret = get_invitations_by_inviter(ctx.user_id, rows);
    } else {
        return {RouteStatus::BadRequest};
    }
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (size_t i = 0; i < rows.size(); ++i) {
            json inv;
            inv["invitation_id"] = rows[i][0];
            inv["room_id"] = rows[i][1];
            inv["room_name"] = rows[i][2];
            inv["inviter_id"] = rows[i][3];
            inv["invitee_id"] = rows[i][4];
            inv["created_at_ms"] = rows[i][5];
            out.emplace_back(inv);
        }
        body = out.dump();
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_list_my_invitations: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_cancel_invitation(RequestContext &ctx) {
    // DELETE /api/invitations/:invitation_id
    // 权限：邀请人本人
    string id_value(ctx.params["invitation_id"]);
    uint64_t invitation_id = 0;
    try {
        invitation_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse invitation_id failed in handle_cancel_invitation, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    uint64_t room_id = 0, inviter_id = 0, invitee_id = 0;
    MysqlPool::QueryResult ret = get_invitation(invitation_id, room_id, inviter_id, invitee_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (inviter_id != ctx.user_id) {
        return {RouteStatus::BadRequest};
    }

    ret = delete_invitation(invitation_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_create_friend_request(RequestContext &ctx) {
    // POST /api/friend-requests
    // body: {"to_user_id": uint64}
    // 校验：target 不能是自己、还不是好友、没有重复 pending 请求（依赖 UNIQUE 索引）
    uint64_t to_user_id = 0;
    try {
        json in = json::parse(ctx.req.body);
        to_user_id = in["to_user_id"];
    } catch (const exception &e) {
        LOG_WARN("bad json in handle_create_friend_request: %s", e.what());
        return {RouteStatus::BadRequest};
    }
    if (to_user_id == ctx.user_id) {
        return {RouteStatus::BadRequest};
    }

    string unused_nickname, unused_avatar_url, unused_username;
    MysqlPool::QueryResult ret = get_user_profile(to_user_id, unused_username, unused_nickname, unused_avatar_url);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ret = check_friendship(ctx.user_id, to_user_id);
    if (ret == MysqlPool::QueryResult::Success) {
        return {RouteStatus::BadRequest};
    }
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    uint64_t reverse_request_id = 0;
    ret = get_friend_request_by_users(to_user_id, ctx.user_id, reverse_request_id);
    if (ret == MysqlPool::QueryResult::Success) {
        ret = accept_friend_request_transaction(to_user_id, ctx.user_id, reverse_request_id);
        if (ret == MysqlPool::QueryResult::AlreadyExists) {
            ret = delete_friend_request(reverse_request_id);
            if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
                return {RouteStatus::ServerError};
            }
        } else if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
        ctx.conn.outbuf +=
            "HTTP/1.1 200 OK\r\n"
            "Content-Length: 0\r\n"
            "\r\n";
        return {RouteStatus::Success};
    }
    if (ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    uint64_t request_id = 0;
    ret = insert_friend_request(request_id, ctx.user_id, to_user_id);
    if (ret == MysqlPool::QueryResult::AlreadyExists) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    try {
        json out;
        out["request_id"] = request_id;
        string body = out.dump();
        ctx.conn.outbuf +=
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            "Content-Length: ";
        ctx.conn.outbuf += to_string(body.size());
        ctx.conn.outbuf += "\r\n\r\n";
        ctx.conn.outbuf += body;
        return {RouteStatus::Success};
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_create_friend_request: %s", e.what());
        return {RouteStatus::BadRequest};
    }
}
RouteResult handle_respond_friend_request(RequestContext &ctx) {
    // PATCH /api/friend-requests/:request_id
    // 权限：to_user_id 必须是 ctx.user_id
    // body: {"status": "accepted" | "rejected"}
    string id_value(ctx.params["request_id"]);
    uint64_t request_id = 0;
    try {
        request_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse request_id failed in handle_respond_friend_request, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    uint64_t from_user_id = 0, to_user_id = 0;
    MysqlPool::QueryResult ret = get_friend_request(request_id, from_user_id, to_user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (to_user_id != ctx.user_id) {
        return {RouteStatus::BadRequest};
    }

    string status;
    try {
        json in = json::parse(ctx.req.body);
        status = in["status"];
    } catch (const exception &e) {
        LOG_WARN("bad json in handle_respond_friend_request: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    if (status == "accepted") {
        ret = accept_friend_request_transaction(from_user_id, to_user_id, request_id);
        if (ret == MysqlPool::QueryResult::AlreadyExists) {
            ret = delete_friend_request(request_id);
            if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
                return {RouteStatus::ServerError};
            }
        } else if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
        delete_friend_request_by_users(to_user_id, from_user_id);
    } else if (status == "rejected") {
        ret = delete_friend_request(request_id);
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
    } else {
        return {RouteStatus::BadRequest};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_list_friend_requests(RequestContext &ctx) {
    // GET /api/friend-requests?direction=received|sent
    // 权限：登录用户
    size_t query_pos = ctx.req.target.find('?');
    if (query_pos == string::npos) {
        return {RouteStatus::BadRequest};
    }
    string query = ctx.req.target.substr(query_pos + 1);
    string direction;
    if (query.starts_with("direction=")) {
        direction = query.substr(10);
    } else {
        return {RouteStatus::BadRequest};
    }
    if (direction.empty()) {
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret;
    vector<vector<string>> rows;
    if (direction == "received") {
        ret = get_friend_requests_by_to_user(ctx.user_id, rows);
    } else if (direction == "sent") {
        ret = get_friend_requests_by_from_user(ctx.user_id, rows);
    } else {
        return {RouteStatus::BadRequest};
    }
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    string nickname_key = (direction == "sent") ? "to_nickname" : "from_nickname";

    string body;
    try {
        json out = json::array();
        for (size_t i = 0; i < rows.size(); ++i) {
            json fr;
            fr["request_id"] = rows[i][0];
            fr["from_user_id"] = rows[i][1];
            fr["to_user_id"] = rows[i][2];
            fr[nickname_key] = rows[i][3];
            fr["created_at_ms"] = rows[i][4];
            out.emplace_back(fr);
        }
        body = out.dump();
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_list_friend_requests: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_cancel_friend_request(RequestContext &ctx) {
    // DELETE /api/friend-requests/:request_id
    // 权限：from_user_id 必须是 ctx.user_id
    string id_value(ctx.params["request_id"]);
    uint64_t request_id = 0;
    try {
        request_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse request_id failed in handle_cancel_friend_request, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    uint64_t from_user_id = 0, to_user_id = 0;
    MysqlPool::QueryResult ret = get_friend_request(request_id, from_user_id, to_user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (from_user_id != ctx.user_id) {
        return {RouteStatus::BadRequest};
    }

    ret = delete_friend_request(request_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_list_friends(RequestContext &ctx) {
    // GET /api/friends
    vector<vector<string>> rows;
    MysqlPool::QueryResult ret = get_friends(ctx.user_id, rows);
    if (ret == MysqlPool::QueryResult::ServerError) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (size_t i = 0; i < rows.size(); ++i) {
            json f;
            f["user_id"] = rows[i][0];
            f["username"] = rows[i][1];
            f["nickname"] = rows[i][2];
            f["created_at_ms"] = rows[i][3];
            out.emplace_back(f);
        }
        body = out.dump();
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_list_friends: %s", e.what());
        return {RouteStatus::BadRequest};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_delete_friend(RequestContext &ctx) {
    // DELETE /api/friends/:user_id
    // 权限：登录用户
    string id_value(ctx.params["user_id"]);
    uint64_t target_user_id = 0;
    try {
        target_user_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse user_id failed in handle_delete_friend, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret = delete_friendship(ctx.user_id, target_user_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_create_conversation(RequestContext &ctx) {
    // POST /api/rooms/:room_id/conversations
    // 权限：房间成员（任何角色）
    // body: {"title": string, "ai_members"?: [{ai_id, adapter_url?, custom_adapter_text?}]}
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try {
        room_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse room_id failed in handle_create_conversation, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    MysqlPool::QueryResult ret = verify_room_member(room_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    string room_name;
    uint64_t main_conv_id = 0;
    int room_type = 0;
    ret = get_room_data(room_id, room_name, main_conv_id, room_type);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (static_cast<RoomType>(room_type) == RoomType::Atrium) {
        return {RouteStatus::BadRequest};
    }

    string title;
    bool has_body_ai_members = false;
    vector<RoomAiMemberInfo> ai_members;
    try {
        json in = json::parse(ctx.req.body);
        title = in["title"];
        if (in.contains("ai_members")) {
            has_body_ai_members = true;
            for (auto &item : in["ai_members"]) {
                RoomAiMemberInfo m;
                m.ai_id = item["ai_id"];
                if (item.contains("adapter_url") && item["adapter_url"].is_string()) m.adapter_url = item["adapter_url"];
                if (item.contains("custom_adapter_text") && item["custom_adapter_text"].is_string()) m.custom_adapter_text = item["custom_adapter_text"];
                ai_members.emplace_back(std::move(m));
            }
        }
    } catch (const exception &e) {
        LOG_WARN("bad json in handle_create_conversation: %s", e.what());
        return {RouteStatus::BadRequest};
    }
    if (title.empty() || title.size() > 32) {
        return {RouteStatus::BadRequest};
    }

    if (!has_body_ai_members) {
        ret = get_room_ai_members(room_id, ai_members);
        if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
            return {RouteStatus::ServerError};
        }
    }
    uint64_t conversation_id = 0;
    ret = MysqlPool::getInstance().executeTransaction([&](MysqlTxnContext &txn) -> MysqlPool::QueryResult {
        static const string conv_sql =
            "INSERT INTO conversations (room_id, title, created_by, created_at_ms) "
            "VALUES (?, ?, ?, ?)";
        uint64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        MysqlPool::MysqlParams conv_params{room_id, title, ctx.user_id, now};
        MysqlPool::QueryResult ret = txn.executeQuery(conv_sql, conv_params, &conversation_id);
        if (ret != MysqlPool::QueryResult::Success) {
            return MysqlPool::QueryResult::ServerError;
        }

        for (auto &m : ai_members) {
            static const string mem_sql =
                "INSERT INTO conversation_ai_members (conversation_id, ai_id, adapter_url, custom_adapter_text) VALUES (?, ?, ?, ?)";
            MysqlPool::MysqlParams mem_params{conversation_id, m.ai_id, m.adapter_url, m.custom_adapter_text};
            ret = txn.executeQuery(mem_sql, mem_params);
            if (ret != MysqlPool::QueryResult::Success) {
                return MysqlPool::QueryResult::ServerError;
            }
        }

        return MysqlPool::QueryResult::Success;
    });
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    try {
        json out;
        out["conversation_id"] = conversation_id;
        string body = out.dump();
        ctx.conn.outbuf +=
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            "Content-Length: ";
        ctx.conn.outbuf += to_string(body.size());
        ctx.conn.outbuf += "\r\n\r\n";
        ctx.conn.outbuf += body;
        return {RouteStatus::Success};
    } catch (const exception &e) {
        LOG_WARN("json encode failed in handle_create_conversation: %s", e.what());
        return {RouteStatus::BadRequest};
    }
}
RouteResult handle_delete_conversation(RequestContext &ctx) {
    // DELETE /api/conversations/:conversation_id
    // 权限：created_by 本人 / owner / admin
    // 校验：不能删主对话（rooms.main_conversation_id 指向的那条）
    string id_value(ctx.params["conversation_id"]);
    uint64_t conversation_id = 0;
    try {
        conversation_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse conversation_id failed in handle_delete_conversation, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    uint64_t room_id = 0, created_by = 0;
    MysqlPool::QueryResult ret = get_conversation_data(conversation_id, room_id, created_by);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    string room_name;
    uint64_t main_conversation_id = 0;
    int room_type = 0;
    ret = get_room_data(room_id, room_name, main_conversation_id, room_type);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (conversation_id == main_conversation_id) {
        return {RouteStatus::BadRequest};
    }

    if (created_by != ctx.user_id) {
        int my_role = 0;
        ret = get_room_member_role(room_id, ctx.user_id, my_role);
        if (ret == MysqlPool::QueryResult::NotFound) {
            return {RouteStatus::BadRequest};
        }
        if (ret != MysqlPool::QueryResult::Success) {
            return {RouteStatus::ServerError};
        }
        if (my_role != static_cast<int>(RoomRole::Owner) && my_role != static_cast<int>(RoomRole::Admin)) {
            return {RouteStatus::BadRequest};
        }
    }

    ret = delete_conversation_row(conversation_id);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
RouteResult handle_rename_conversation(RequestContext &ctx) {
    // PATCH /api/conversations/:conv_id/title
    // 权限：对话所在房间的成员
    // body: {"title": string}
    string conv_id_str(ctx.params["conv_id"]);
    uint64_t conv_id = 0;
    try { conv_id = stoull(conv_id_str); } catch (const exception &) { return {RouteStatus::BadRequest}; }

    string title;
    try {
        json in = json::parse(ctx.req.body);
        title = in["title"];
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    if (title.empty() || title.size() > 64) return {RouteStatus::BadRequest};

    MysqlPool::QueryResult ret = verify_conversation_member(conv_id, ctx.user_id);
    if (ret == MysqlPool::QueryResult::NotFound) return {RouteStatus::BadRequest};
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::ServerError};

    ret = update_conversation_title(conv_id, title);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::ServerError};

    json out;
    out["ok"] = true;
    out["title"] = title;
    string body = out.dump();
    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: ";
    ctx.conn.outbuf += to_string(body.size());
    ctx.conn.outbuf += "\r\n\r\n";
    ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}
RouteResult handle_delete_message(RequestContext &ctx) {
    // DELETE /api/messages/:message_id
    // 权限：sender_id 必须是 ctx.user_id
    // 校验：send_time_ms 距今不超过 2 分钟
    // 行为：软删（UPDATE deleted_at_ms）
    string id_value(ctx.params["message_id"]);
    uint64_t message_id = 0;
    try {
        message_id = stoull(id_value);
    } catch (const exception &e) {
        LOG_WARN("parse message_id failed in handle_delete_message, value = %s, reason = %s", id_value.data(), e.what());
        return {RouteStatus::BadRequest};
    }

    uint64_t sender_id = 0, send_time_ms = 0;
    MysqlPool::QueryResult ret = get_message_meta(message_id, sender_id, send_time_ms);
    if (ret == MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::BadRequest};
    }
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }
    if (sender_id != ctx.user_id) {
        return {RouteStatus::BadRequest};
    }

    uint64_t now = duration_cast<chrono::milliseconds>(chrono::system_clock::now().time_since_epoch()).count();
    if (now - send_time_ms > 120000) {
        return {RouteStatus::BadRequest};
    }

    ret = soft_delete_message(message_id, now);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}

RouteResult handle_list_ais(RequestContext &ctx) {
    vector<AiInfo> ais;
    MysqlPool::QueryResult ret = get_all_ais(ais);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (auto &a : ais) {
            json item;
            item["id"] = a.id;
            item["provider"] = a.provider;
            item["model"] = a.model;
            item["display_name"] = a.display_name;
            item["avatar_url"] = a.avatar_url;
            out.emplace_back(std::move(item));
        }
        body = out.dump();
    } catch (const exception &e) {
        return {RouteStatus::BadRequest};
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
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}

RouteResult handle_list_thinking_adapters(RequestContext &ctx) {
    vector<string> names;
    MysqlPool::QueryResult ret = list_thinking_adapters(names);
    if (ret != MysqlPool::QueryResult::Success) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (auto &name : names) {
            out.emplace_back(std::move(name));
        }
        body = out.dump();
    } catch (const exception &e) {
        return {RouteStatus::BadRequest};
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
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}

RouteResult handle_list_room_ai_members(RequestContext &ctx) {
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try { room_id = stoull(id_value); } catch (const exception &) { return {RouteStatus::BadRequest}; }

    MysqlPool::QueryResult ret = verify_room_member(room_id, ctx.user_id);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};

    vector<RoomAiMemberInfo> members;
    ret = get_room_ai_members(room_id, members);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (auto &m : members) {
            json item;
            item["ai_id"] = m.ai_id;
            item["provider"] = m.provider;
            item["model"] = m.model;
            if (!m.adapter_url.empty()) item["adapter_url"] = m.adapter_url;
            if (!m.custom_adapter_text.empty()) item["custom_adapter_text"] = m.custom_adapter_text;
            out.emplace_back(std::move(item));
        }
        body = out.dump();
    } catch (const exception &e) {
        return {RouteStatus::BadRequest};
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
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}

RouteResult handle_create_room_ai_member(RequestContext &ctx) {
    string id_value(ctx.params["room_id"]);
    uint64_t room_id = 0;
    try { room_id = stoull(id_value); } catch (const exception &) { return {RouteStatus::BadRequest}; }

    int role = -1;
    MysqlPool::QueryResult ret = get_room_member_role(room_id, ctx.user_id, role);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    if (role != static_cast<int>(RoomRole::Owner) && role != static_cast<int>(RoomRole::Admin)) return {RouteStatus::BadRequest};

    uint64_t ai_id = 0;
    string adapter_url, custom_adapter_text;
    try {
        json in = json::parse(ctx.req.body);
        ai_id = in["ai_id"];
        if (in.contains("adapter_url") && in["adapter_url"].is_string()) adapter_url = in["adapter_url"];
        if (in.contains("custom_adapter_text") && in["custom_adapter_text"].is_string()) custom_adapter_text = in["custom_adapter_text"];
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    if (!ai_id) return {RouteStatus::BadRequest};

    ret = insert_room_ai_member(room_id, ai_id, adapter_url, custom_adapter_text);
    if (ret == MysqlPool::QueryResult::AlreadyExists) return {RouteStatus::BadRequest};
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::ServerError};

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}

RouteResult handle_update_room_ai_member(RequestContext &ctx) {
    string room_id_str(ctx.params["room_id"]);
    string ai_id_str(ctx.params["ai_id"]);
    uint64_t room_id = 0, ai_id = 0;
    try {
        room_id = stoull(room_id_str);
        ai_id = stoull(ai_id_str);
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    int role = -1;
    MysqlPool::QueryResult ret = get_room_member_role(room_id, ctx.user_id, role);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    if (role != static_cast<int>(RoomRole::Owner) && role != static_cast<int>(RoomRole::Admin)) return {RouteStatus::BadRequest};

    string adapter_url, custom_adapter_text;
    try {
        json in = json::parse(ctx.req.body);
        if (in.contains("adapter_url")) {
            if (in["adapter_url"].is_null()) adapter_url = "";
            else adapter_url = in["adapter_url"];
        }
        if (in.contains("custom_adapter_text")) {
            if (in["custom_adapter_text"].is_null()) custom_adapter_text = "";
            else custom_adapter_text = in["custom_adapter_text"];
        }
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    ret = update_room_ai_member(room_id, ai_id, adapter_url, custom_adapter_text);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}

RouteResult handle_delete_room_ai_member(RequestContext &ctx) {
    string room_id_str(ctx.params["room_id"]);
    string ai_id_str(ctx.params["ai_id"]);
    uint64_t room_id = 0, ai_id = 0;
    try {
        room_id = stoull(room_id_str);
        ai_id = stoull(ai_id_str);
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    int role = -1;
    MysqlPool::QueryResult ret = get_room_member_role(room_id, ctx.user_id, role);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    if (role != static_cast<int>(RoomRole::Owner) && role != static_cast<int>(RoomRole::Admin)) return {RouteStatus::BadRequest};

    ret = delete_room_ai_member(room_id, ai_id);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}

RouteResult handle_list_conversation_ai_members(RequestContext &ctx) {
    string id_value(ctx.params["conv_id"]);
    uint64_t conv_id = 0;
    try { conv_id = stoull(id_value); } catch (const exception &) { return {RouteStatus::BadRequest}; }

    MysqlPool::QueryResult ret = verify_conversation_member(conv_id, ctx.user_id);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};

    vector<AiMemberInfo> members;
    ret = get_conversation_ai_members(conv_id, members);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    string body;
    try {
        json out = json::array();
        for (auto &m : members) {
            json item;
            item["ai_id"] = m.ai_id;
            item["provider"] = m.provider;
            item["model"] = m.model;
            if (!m.adapter_url.empty()) item["adapter_url"] = m.adapter_url;
            if (!m.custom_adapter_text.empty()) item["custom_adapter_text"] = m.custom_adapter_text;
            out.emplace_back(std::move(item));
        }
        body = out.dump();
    } catch (const exception &e) {
        return {RouteStatus::BadRequest};
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
    if (ctx.req.method == Method::GET) ctx.conn.outbuf += body;
    return {RouteStatus::Success};
}

RouteResult handle_create_conversation_ai_member(RequestContext &ctx) {
    string id_value(ctx.params["conv_id"]);
    uint64_t conv_id = 0;
    try { conv_id = stoull(id_value); } catch (const exception &) { return {RouteStatus::BadRequest}; }

    MysqlPool::QueryResult ret = verify_conversation_member(conv_id, ctx.user_id);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    uint64_t room_id = 0, created_by = 0;
    ret = get_conversation_data(conv_id, room_id, created_by);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    string room_name;
    uint64_t main_conv_id = 0;
    int room_type = 0;
    ret = get_room_data(room_id, room_name, main_conv_id, room_type);
    if (ret == MysqlPool::QueryResult::Success && static_cast<RoomType>(room_type) == RoomType::Atrium) {
        return {RouteStatus::BadRequest};
    }
    if (conv_id == main_conv_id) return {RouteStatus::BadRequest};
    if (ctx.user_id != created_by) {
        int role = -1;
        ret = get_room_member_role(room_id, ctx.user_id, role);
        if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
        if (role != static_cast<int>(RoomRole::Owner) && role != static_cast<int>(RoomRole::Admin)) return {RouteStatus::BadRequest};
    }

    uint64_t ai_id = 0;
    string adapter_url, custom_adapter_text;
    try {
        json in = json::parse(ctx.req.body);
        ai_id = in["ai_id"];
        if (in.contains("adapter_url") && in["adapter_url"].is_string()) adapter_url = in["adapter_url"];
        if (in.contains("custom_adapter_text") && in["custom_adapter_text"].is_string()) custom_adapter_text = in["custom_adapter_text"];
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    if (!ai_id) return {RouteStatus::BadRequest};

    ret = insert_conversation_ai_member(conv_id, ai_id, adapter_url, custom_adapter_text);
    if (ret == MysqlPool::QueryResult::AlreadyExists) return {RouteStatus::BadRequest};
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::ServerError};

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}

RouteResult handle_update_conversation_ai_member(RequestContext &ctx) {
    string conv_id_str(ctx.params["conv_id"]);
    string ai_id_str(ctx.params["ai_id"]);
    uint64_t conv_id = 0, ai_id = 0;
    try {
        conv_id = stoull(conv_id_str);
        ai_id = stoull(ai_id_str);
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    MysqlPool::QueryResult ret = verify_conversation_member(conv_id, ctx.user_id);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    uint64_t room_id = 0, created_by = 0;
    ret = get_conversation_data(conv_id, room_id, created_by);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    string room_name;
    uint64_t main_conv_id = 0;
    int room_type = 0;
    ret = get_room_data(room_id, room_name, main_conv_id, room_type);
    if (ret == MysqlPool::QueryResult::Success && static_cast<RoomType>(room_type) == RoomType::Atrium) {
        return {RouteStatus::BadRequest};
    }
    if (conv_id == main_conv_id) return {RouteStatus::BadRequest};
    if (ctx.user_id != created_by) {
        int role = -1;
        ret = get_room_member_role(room_id, ctx.user_id, role);
        if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
        if (role != static_cast<int>(RoomRole::Owner) && role != static_cast<int>(RoomRole::Admin)) return {RouteStatus::BadRequest};
    }

    string adapter_url, custom_adapter_text;
    try {
        json in = json::parse(ctx.req.body);
        if (in.contains("adapter_url")) {
            if (in["adapter_url"].is_null()) adapter_url = "";
            else adapter_url = in["adapter_url"];
        }
        if (in.contains("custom_adapter_text")) {
            if (in["custom_adapter_text"].is_null()) custom_adapter_text = "";
            else custom_adapter_text = in["custom_adapter_text"];
        }
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    ret = update_conversation_ai_member(conv_id, ai_id, adapter_url, custom_adapter_text);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}

RouteResult handle_delete_conversation_ai_member(RequestContext &ctx) {
    string conv_id_str(ctx.params["conv_id"]);
    string ai_id_str(ctx.params["ai_id"]);
    uint64_t conv_id = 0, ai_id = 0;
    try {
        conv_id = stoull(conv_id_str);
        ai_id = stoull(ai_id_str);
    } catch (const exception &) { return {RouteStatus::BadRequest}; }

    MysqlPool::QueryResult ret = verify_conversation_member(conv_id, ctx.user_id);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    uint64_t room_id = 0, created_by = 0;
    ret = get_conversation_data(conv_id, room_id, created_by);
    if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
    string room_name;
    uint64_t main_conv_id = 0;
    int room_type = 0;
    ret = get_room_data(room_id, room_name, main_conv_id, room_type);
    if (ret == MysqlPool::QueryResult::Success && static_cast<RoomType>(room_type) == RoomType::Atrium) {
        return {RouteStatus::BadRequest};
    }
    if (conv_id == main_conv_id) return {RouteStatus::BadRequest};
    if (ctx.user_id != created_by) {
        int role = -1;
        ret = get_room_member_role(room_id, ctx.user_id, role);
        if (ret != MysqlPool::QueryResult::Success) return {RouteStatus::BadRequest};
        if (role != static_cast<int>(RoomRole::Owner) && role != static_cast<int>(RoomRole::Admin)) return {RouteStatus::BadRequest};
    }

    ret = delete_conversation_ai_member(conv_id, ai_id);
    if (ret != MysqlPool::QueryResult::Success && ret != MysqlPool::QueryResult::NotFound) {
        return {RouteStatus::ServerError};
    }

    ctx.conn.outbuf +=
        "HTTP/1.1 200 OK\r\n"
        "Content-Length: 0\r\n"
        "\r\n";
    return {RouteStatus::Success};
}
} // namespace http
