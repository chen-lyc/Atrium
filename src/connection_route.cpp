#include "connection_route.h"
using namespace std;

std::unordered_map<int, std::vector<int>> ConnRoute::query(uint64_t converstaion_id) {
    lock_guard<mutex> lock(m_mutex);
    auto it = m_conv_to_conn.find(converstaion_id);
    if (it == m_conv_to_conn.end()) {
        return {};
    }

    unordered_map<int, std::vector<int>> reactor_to_fds;
    vector<ConnRef> &refs = it->second;
    for (ConnRef ref : refs) {
        reactor_to_fds[ref.reactor_id].emplace_back(ref.fd);
    }
    return reactor_to_fds;
}

void ConnRoute::add(int converstaion_id, int reactor_id, int fd) {
    lock_guard<mutex> lock(m_mutex);
    m_conv_to_conn[converstaion_id].emplace_back(reactor_id, fd);
}

void ConnRoute::remove(int converstaion_id, int reactor_id, int fd) {
    lock_guard<mutex> lock(m_mutex);
    vector<ConnRef> &refs = m_conv_to_conn[converstaion_id];
    auto it = find_if(refs.begin(), refs.end(), [&](const ConnRef &ref) {
        return ref.reactor_id == reactor_id && ref.fd == fd;
    });
    if (it == refs.end()) return;

    *it = refs.back();
    refs.pop_back();
}