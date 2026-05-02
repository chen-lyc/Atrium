#pragma once

#include "connection.h"
#include "http_codec.h"
#include <functional>
#include <optional>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace http {
enum class RouteResult {
    Success,
    BadRequest,
    Unauthorized,
    NotFound,
    ServerError
};

struct RequestLine {
    std::string_view method;
    std::vector<std::string_view> segments;
    std::string_view query;
};
RequestLine parse_request_line(std::string_view method, std::string_view target);

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
        std::string_view method;
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
RouteResult handle_rooms(RequestContext &ctx);
RouteResult handle_conversation_messages(RequestContext &ctx);
} // namespace http