#pragma once

#include "connection.h"
#include "http_codec.h"
#include <functional>
#include <optional>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace http {
enum class RouteStatus {
    Success,
    JoinRoom,
    LeaveRoom,
    BadRequest,
    Unauthorized,
    NotFound,
    ServerError
};

enum class MembershipAction {
    None,
    Join,
    Leave,
};

struct RouteResult {
    RouteStatus state;

    MembershipAction membership_action = MembershipAction::None;
    uint64_t room_id;
    std::vector<uint64_t> affected_user_ids;
};

struct RequestLine {
    Method method;
    std::vector<std::string_view> segments;
};
RequestLine parse_request_line(Method method, std::string_view target);

using PathParams = std::unordered_map<std::string_view, std::string_view>;

struct RequestContext {
    HttpRequest &req;
    PathParams params;
    Connection &conn;
    uint64_t user_id;
    std::string username;
};

class Router {
  public:
    struct Route {
        Method method;
        std::vector<std::string_view> pattern_segments;
        bool need_auth;
        std::function<RouteResult(RequestContext &)> handler;
    };

    Router();
    std::optional<Route> find_route(RequestLine &line, PathParams &params);

  private:
    bool match(RequestLine &line, Route &route, PathParams &params);

  private:
    std::vector<Route> m_routes;
};

RouteResult handle_login(RequestContext &ctx);
RouteResult handle_register(RequestContext &ctx);
RouteResult handle_me(RequestContext &ctx);
RouteResult handle_update_me(RequestContext &ctx);
RouteResult handle_me_ai_usage(RequestContext &ctx);
RouteResult handle_me_ai_usage_today(RequestContext &ctx);
RouteResult handle_search_users(RequestContext &ctx);
RouteResult handle_list_rooms(RequestContext &ctx);
RouteResult handle_list_room_conversations(RequestContext &ctx);
RouteResult handle_conversation_messages(RequestContext &ctx);
RouteResult handle_create_room(RequestContext &ctx);
RouteResult handle_delete_room(RequestContext &ctx);
RouteResult handle_update_room(RequestContext &ctx);
RouteResult handle_kick_or_leave_room(RequestContext &ctx);
RouteResult handle_set_room_member_role(RequestContext &ctx);
RouteResult handle_list_room_members(RequestContext &ctx);
RouteResult handle_create_room_invitation(RequestContext &ctx);
RouteResult handle_respond_room_invitation(RequestContext &ctx);
RouteResult handle_list_room_invitations(RequestContext &ctx);
RouteResult handle_list_my_invitations(RequestContext &ctx);
RouteResult handle_cancel_invitation(RequestContext &ctx);
RouteResult handle_create_friend_request(RequestContext &ctx);
RouteResult handle_respond_friend_request(RequestContext &ctx);
RouteResult handle_list_friend_requests(RequestContext &ctx);
RouteResult handle_cancel_friend_request(RequestContext &ctx);
RouteResult handle_list_friends(RequestContext &ctx);
RouteResult handle_delete_friend(RequestContext &ctx);
RouteResult handle_create_conversation(RequestContext &ctx);
RouteResult handle_conversation_model(RequestContext &ctx);
RouteResult handle_list_ais(RequestContext &ctx);
RouteResult handle_delete_conversation(RequestContext &ctx);
RouteResult handle_delete_message(RequestContext &ctx);
RouteResult handle_list_thinking_adapters(RequestContext &ctx);
RouteResult handle_list_room_ai_members(RequestContext &ctx);
RouteResult handle_create_room_ai_member(RequestContext &ctx);
RouteResult handle_update_room_ai_member(RequestContext &ctx);
RouteResult handle_delete_room_ai_member(RequestContext &ctx);
RouteResult handle_list_conversation_ai_members(RequestContext &ctx);
RouteResult handle_create_conversation_ai_member(RequestContext &ctx);
RouteResult handle_update_conversation_ai_member(RequestContext &ctx);
RouteResult handle_delete_conversation_ai_member(RequestContext &ctx);
} // namespace http