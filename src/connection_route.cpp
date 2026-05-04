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