#include "connection_route.h"
using namespace std;

std::unordered_map<int, std::vector<int>> ConnRoute::queryByRoom(uint64_t room_id) {
    lock_guard<mutex> lock(m_room_to_conn_mutex);
    auto it = m_room_to_conn.find(room_id);
    if (it == m_room_to_conn.end()) {
        return {};
    }

    unordered_map<int, std::vector<int>> reactor_to_fds;
    vector<ConnRef> &refs = it->second;
    for (ConnRef ref : refs) {
        reactor_to_fds[ref.reactor_id].emplace_back(ref.fd);
    }
    return reactor_to_fds;
}

void ConnRoute::addRoomConn(uint64_t room_id, int reactor_id, int fd) {
    lock_guard<mutex> lock(m_room_to_conn_mutex);
    m_room_to_conn[room_id].emplace_back(reactor_id, fd);
}

void ConnRoute::removeRoomConn(uint64_t room_id, int reactor_id, int fd) {
    lock_guard<mutex> lock(m_room_to_conn_mutex);
    vector<ConnRef> &refs = m_room_to_conn[room_id];
    auto it = find_if(refs.begin(), refs.end(), [&](const ConnRef &ref) {
        return ref.reactor_id == reactor_id && ref.fd == fd;
    });
    if (it == refs.end()) return;

    *it = refs.back();
    refs.pop_back();
}

void ConnRoute::queryByUser(uint64_t user_id, std::unordered_map<int, std::vector<int>> &reactor_to_fds) {
    lock_guard<mutex> lock(m_user_to_conn_mutex);
    auto it = m_user_to_conn.find(user_id);
    if (it == m_user_to_conn.end()) {
        return;
    }

    vector<ConnRef> &refs = it->second;
    for (ConnRef ref : refs) {
        reactor_to_fds[ref.reactor_id].emplace_back(ref.fd);
    }
}

void ConnRoute::addUserConn(uint64_t user_id, int reactor_id, int fd) {
    lock_guard<mutex> lock(m_user_to_conn_mutex);
    m_user_to_conn[user_id].emplace_back(reactor_id, fd);
}
void ConnRoute::removeUserConn(uint64_t user_id, int reactor_id, int fd) {
    lock_guard<mutex> lock(m_user_to_conn_mutex);
    vector<ConnRef> &refs = m_user_to_conn[user_id];
    auto it = find_if(refs.begin(), refs.end(), [&](const ConnRef &ref) {
        return ref.reactor_id == reactor_id && ref.fd == fd;
    });
    if (it == refs.end()) return;

    *it = refs.back();
    refs.pop_back();
}

void ConvAiScheduler::submit(uint64_t conversation_id, uint64_t trigger_message_id, Launcher launcher) {
    bool trigger = false;
    Launcher callback;
    {
        lock_guard<mutex> lock(m_mutex);
        auto it = m_conv_to_state.find(conversation_id);
        if (it == m_conv_to_state.end()) {
            m_conv_to_state.try_emplace(conversation_id, true, nullopt);
            m_conv_to_handle[conversation_id] = std::move(launcher);
            callback = m_conv_to_handle[conversation_id];
            trigger = true;
        } else {
            ConversationStatus &state = it->second;
            if (state.ai_running) {
                state.pending_trigger_id = trigger_message_id;
                m_conv_to_handle[conversation_id] = std::move(launcher);
            } else {
                state.ai_running = true;
                state.pending_trigger_id = nullopt;
                m_conv_to_handle[conversation_id] = std::move(launcher);
                callback = m_conv_to_handle[conversation_id];
                trigger = true;
            }
        }
    }
    if (trigger) callback(trigger_message_id, trigger_message_id);
}

void ConvAiScheduler::finish(uint64_t conversation_id, std::optional<uint64_t> completed_ai_message_id) {
    Launcher callback;
    uint64_t trigger_message_id = 0;
    uint64_t context_until_message_id = 0;
    bool trigger = false;
    {
        lock_guard<mutex> lock(m_mutex);
        auto it = m_conv_to_state.find(conversation_id);
        if (it == m_conv_to_state.end()) return;
        optional<uint64_t> &pending_trigger_id = it->second.pending_trigger_id;
        if (pending_trigger_id.has_value()) {
            trigger_message_id = pending_trigger_id.value();
            context_until_message_id = completed_ai_message_id.has_value()
                                           ? max(trigger_message_id, completed_ai_message_id.value())
                                           : trigger_message_id;
            pending_trigger_id = nullopt;
            callback = m_conv_to_handle[conversation_id];
            trigger = true;
        } else {
            it->second.ai_running = false;
        }
    }
    if (trigger) callback(trigger_message_id, context_until_message_id);
}
