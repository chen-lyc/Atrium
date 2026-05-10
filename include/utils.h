#pragma once

#include "http_codec.h"
#include "mysql_pool.h"
#include <array>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_set>

extern std::hash<std::string> hasher;

std::string generateSessionId();

enum class RegisterStatus {
    Success,
    UserExists,
    ServerError
};

enum class LoginStatus {
    Success,
    UserNotFound,
    WrongPassword,
    ServerError
};

enum class SessionResult {
    Success,
    TokenExpired,
    InvalidRequest,
    NetWorkError,
    ServerError
};

struct RegisterResult {
    RegisterStatus state;
    uint64_t user_id;
};

struct LoginResult {
    LoginStatus state;
    uint64_t user_id;
};

struct HashedPassword {
    std::array<unsigned char, 16> salt;
    std::array<unsigned char, 32> hash;
};

std::optional<std::string> url_decode(std::string_view s);
bool is_valid_username(const std::string &username);
bool is_valid_password(const std::string &password);
std::optional<HashedPassword> hash_password(const std::string &password);

bool get_username_and_user_id(const HttpRequest &req, std::string &username, std::string &password, std::string_view &response);
RegisterResult do_register(const std::string &username, const std::string &password);
LoginResult do_login(const std::string &username, const std::string &password);

SessionResult create_session(uint64_t user_id, const std::string &username, std::string &token_out);
SessionResult get_session(HttpRequest &req, uint64_t &user_id, std::string &username);
void destroy_session(const std::string &token);

MysqlPool::QueryResult get_room_ids(uint64_t user_id, std::vector<uint64_t> &ids);
MysqlPool::QueryResult get_room_ids(uint64_t user_id, std::unordered_set<uint64_t> &ids);
MysqlPool::QueryResult get_room_data(uint64_t room_id, std::string &room_name, uint64_t &main_conversation_id, int &type);

enum class RoomRole {
    Owner = 0,
    Admin = 1,
    Member = 2,
};

enum class RoomType {
    Atrium = 0,
    Personal = 1,
    Normal = 2,
};

MysqlPool::QueryResult create_room(uint64_t &room_id, uint64_t &main_conversation_id, const std::string &name, const uint64_t user_id, RoomType type = RoomType::Normal);
MysqlPool::QueryResult join_public_room(uint64_t &room_id, uint64_t &main_conversation_id, uint64_t user_id);
MysqlPool::QueryResult join_public_room(uint64_t &room_id, uint64_t user_id);
MysqlPool::QueryResult join_public_room(uint64_t user_id);

MysqlPool::QueryResult delete_room(uint64_t room_id);

MysqlPool::QueryResult create_conversation(uint64_t room_id, uint64_t created_by, uint64_t &conversation_id);
MysqlPool::QueryResult create_conversation_with_title(uint64_t room_id, const std::string &title, uint64_t created_by, uint64_t &conversation_id);

MysqlPool::QueryResult get_room_from_conversations(uint64_t &room_id, uint64_t conversation_id);
MysqlPool::QueryResult verify_room_member(uint64_t room_id, uint64_t user_id);
MysqlPool::QueryResult verify_conversation_member(uint64_t conversation_id, uint64_t user_id);
MysqlPool::QueryResult check_room_owner_id(uint64_t room_id, uint64_t owner_id);
MysqlPool::QueryResult update_room_name(uint64_t room_id, const std::string &name);
MysqlPool::QueryResult insert_room_member(uint64_t room_id, uint64_t user_id, int role);
MysqlPool::QueryResult get_room_member_role(uint64_t room_id, uint64_t user_id, int &role);
MysqlPool::QueryResult remove_room_member(uint64_t room_id, uint64_t user_id);
MysqlPool::QueryResult update_room_member_role(uint64_t room_id, uint64_t user_id, int role);
MysqlPool::QueryResult check_friendship(uint64_t user_a, uint64_t user_b);
MysqlPool::QueryResult insert_invitation(uint64_t &invitation_id, uint64_t room_id, uint64_t inviter_id, uint64_t invitee_id);
MysqlPool::QueryResult get_invitation(uint64_t invitation_id, uint64_t &room_id, uint64_t &inviter_id, uint64_t &invitee_id);
MysqlPool::QueryResult delete_invitation(uint64_t invitation_id);
MysqlPool::QueryResult accept_room_invitation(uint64_t room_id, uint64_t user_id, uint64_t invitation_id);
MysqlPool::QueryResult get_room_invitations(uint64_t room_id, std::vector<std::vector<std::string>> &rows);
MysqlPool::QueryResult get_invitations_by_invitee(uint64_t user_id, std::vector<std::vector<std::string>> &rows);
MysqlPool::QueryResult get_invitations_by_inviter(uint64_t user_id, std::vector<std::vector<std::string>> &rows);

MysqlPool::QueryResult insert_friend_request(uint64_t &request_id, uint64_t from_user_id, uint64_t to_user_id);
MysqlPool::QueryResult get_friend_request(uint64_t request_id, uint64_t &from_user_id, uint64_t &to_user_id);
MysqlPool::QueryResult get_friend_request_by_users(uint64_t from_user_id, uint64_t to_user_id, uint64_t &request_id);
MysqlPool::QueryResult delete_friend_request(uint64_t request_id);
MysqlPool::QueryResult delete_friend_request_by_users(uint64_t from_user_id, uint64_t to_user_id);
MysqlPool::QueryResult get_friend_requests_by_to_user(uint64_t user_id, std::vector<std::vector<std::string>> &rows);
MysqlPool::QueryResult get_friend_requests_by_from_user(uint64_t user_id, std::vector<std::vector<std::string>> &rows);
MysqlPool::QueryResult insert_friendship(uint64_t user_a, uint64_t user_b);
MysqlPool::QueryResult accept_friend_request_transaction(uint64_t from_user_id, uint64_t to_user_id, uint64_t request_id);
MysqlPool::QueryResult delete_friendship(uint64_t user_a, uint64_t user_b);

MysqlPool::QueryResult get_conversation_data(uint64_t conversation_id, uint64_t &room_id, uint64_t &created_by);
MysqlPool::QueryResult get_conversation_ai_model(uint64_t conversation_id, std::string &provider, std::string &model);
MysqlPool::QueryResult get_ai_id_by_model(const std::string &model, uint64_t &ai_id);
MysqlPool::QueryResult insert_conversation_ai_member(uint64_t conversation_id, uint64_t ai_id);
MysqlPool::QueryResult delete_conversation_row(uint64_t conversation_id);

MysqlPool::QueryResult get_message_meta(uint64_t message_id, uint64_t &sender_id, uint64_t &send_time_ms);
MysqlPool::QueryResult soft_delete_message(uint64_t message_id, uint64_t deleted_at_ms);

MysqlPool::QueryResult get_user_profile(uint64_t user_id, std::string &username, std::string &nickname, std::string &avatar_url);
MysqlPool::QueryResult update_user_profile(uint64_t user_id, const std::string &nickname, const std::string &avatar_url);
MysqlPool::QueryResult search_users(const std::string &q, std::vector<std::vector<std::string>> &rows);

MysqlPool::QueryResult get_room_members(uint64_t room_id, std::vector<std::vector<std::string>> &rows);
MysqlPool::QueryResult get_user_ids_by_room(uint64_t room_id, std::vector<uint64_t> &ids);
MysqlPool::QueryResult get_friends(uint64_t user_id, std::vector<std::vector<std::string>> &rows);
MysqlPool::QueryResult get_list_conversations_by_room_id(uint64_t room_id, std::vector<uint64_t> &ids, std::vector<std::string> &titles);

namespace chatdb {
enum class EventType {
    UserMsg,
    AiStreamStart,
    AiStreamDelta,
    AiStreamEnd,
    AiStreamError,
};

enum class MessageType {
    TEXT = 1,
    IMAGE = 2,
    FILE = 3,
    SYSTEM = 4
};

struct Message {
    uint64_t conversation_id;
    uint64_t send_id;
    int type;
    std::string content;
    uint64_t send_time_ms;
    std::optional<std::string> client_message_id;
};

struct Cursor {
    uint64_t before_time_ms;
    uint64_t before_message_id;
};
} // namespace chatdb

MysqlPool::QueryResult insert_message(chatdb::Message &msg, uint64_t &message_id);
MysqlPool::QueryResult get_recent_messages(uint64_t conversation_id, std::optional<chatdb::Cursor> cursor, int limit, std::vector<std::vector<std::string>> &rows);
