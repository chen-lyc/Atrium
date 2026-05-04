#pragma once

#include <cstdint>
#include <mutex>
#include <unordered_map>
#include <vector>

class ConnRoute {
  public:
    static ConnRoute &getInstance() {
        static ConnRoute instance;
        return instance;
    }
    std::unordered_map<int, std::vector<int>> queryByRoom(uint64_t room_id);
    void addRoomConn(uint64_t room_id, int reactor_id, int fd);
    void removeRoomConn(uint64_t room_id, int reactor_id, int fd);
    void queryByUser(uint64_t user_id, std::unordered_map<int, std::vector<int>> &reactor_to_fds);
    void addUserConn(uint64_t user_id, int reactor_id, int fd);
    void removeUserConn(uint64_t user_id, int reactor_id, int fd);

  private:
    struct ConnRef {
        int reactor_id;
        int fd;
    };

    std::unordered_map<uint64_t, std::vector<ConnRef>> m_room_to_conn;
    std::mutex m_room_to_conn_mutex;
    std::unordered_map<uint64_t, std::vector<ConnRef>> m_user_to_conn;
    std::mutex m_user_to_conn_mutex;
};