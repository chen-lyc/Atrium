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

struct ConvAiKey {
    uint64_t conversation_id;
    uint64_t ai_id;
    bool operator==(const ConvAiKey &other) const {
        return conversation_id == other.conversation_id && ai_id == other.ai_id;
    }
};

struct ConvAiKeyHash {
    size_t operator()(const ConvAiKey &key) const {
        return std::hash<uint64_t>()(key.conversation_id) ^ (std::hash<uint64_t>()(key.ai_id) << 1);
    }
};

class ConvAiScheduler {
  public:
    using Launcher = std::function<void(uint64_t trigger_message_id, uint64_t context_until_message_id)>;

    static ConvAiScheduler &getInstance() {
        static ConvAiScheduler instance;
        return instance;
    }
    void submit(uint64_t conversation_id, uint64_t ai_id, uint64_t trigger_message_id, Launcher launcher, bool from_ai = false);
    void finish(uint64_t conversation_id, uint64_t ai_id, std::optional<uint64_t> completed_ai_message_id);

  private:
    struct ConversationStatus {
        ConversationStatus(bool running, std::optional<uint64_t> id) : ai_running(running), pending_trigger_id(id) {}
        bool ai_running;
        std::optional<uint64_t> pending_trigger_id;
    };
    std::unordered_map<ConvAiKey, ConversationStatus, ConvAiKeyHash> m_conv_to_state;
    std::unordered_map<ConvAiKey, Launcher, ConvAiKeyHash> m_conv_to_handle;
    std::unordered_map<uint64_t, uint64_t> m_conv_user_msg_id;
    std::mutex m_mutex;
};

class ConvAiTaskGuard {
  public:
    ConvAiTaskGuard(uint64_t conversation_id, uint64_t ai_id) : m_conversation_id(conversation_id), m_ai_id(ai_id) {}
    void setCompletedAiMessageId(uint64_t message_id) {
        m_completed_ai_message_id = message_id;
    }
    ~ConvAiTaskGuard() {
        ConvAiScheduler::getInstance().finish(m_conversation_id, m_ai_id, m_completed_ai_message_id);
    }

  private:
    uint64_t m_conversation_id;
    uint64_t m_ai_id;
    std::optional<uint64_t> m_completed_ai_message_id;
};
