#pragma once

#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
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

class ConvAiScheduler {
  public:
    using Launcher = std::function<void(uint64_t trigger_message_id, uint64_t context_until_message_id)>;

    static ConvAiScheduler &getInstance() {
        static ConvAiScheduler instance;
        return instance;
    }
    void submit(uint64_t conversation_id, uint64_t trigger_message_id, Launcher launcher);
    void finish(uint64_t conversation_id, std::optional<uint64_t> completed_ai_message_id);

  private:
    struct ConversationStatus {
        ConversationStatus(bool running, std::optional<uint64_t> id) : ai_running(running), pending_trigger_id(id) {}
        bool ai_running;
        std::optional<uint64_t> pending_trigger_id;
    };
    std::unordered_map<uint64_t, ConversationStatus> m_conv_to_state;
    std::unordered_map<uint64_t, Launcher> m_conv_to_handle;
    std::mutex m_mutex;
};

class ConvAiTaskGuard {
  public:
    ConvAiTaskGuard(uint64_t conversation_id) : m_conversation_id(conversation_id) {}
    void setCompletedAiMessageId(uint64_t message_id) {
        m_completed_ai_message_id = message_id;
    }
    ~ConvAiTaskGuard() {
        ConvAiScheduler::getInstance().finish(m_conversation_id, m_completed_ai_message_id);
    }

  private:
    uint64_t m_conversation_id;
    std::optional<uint64_t> m_completed_ai_message_id;
};
