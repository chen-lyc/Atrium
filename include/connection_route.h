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
    std::unordered_map<int, std::vector<int>> query(uint64_t room_id);
    void add(uint64_t room_id, int reactor_id, int fd);
    void remove(uint64_t room_id, int reactor_id, int fd);

  private:
    struct ConnRef {
        int reactor_id;
        int fd;
    };

    std::unordered_map<uint64_t, std::vector<ConnRef>> m_room_to_conn;
    std::mutex m_mutex;
};