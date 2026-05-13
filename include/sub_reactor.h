#pragma once

#include "ai_client.h"
#include "connection.h"
#include "http_route.h"
#include "memory_pool.h"
#include "timerheap.h"
#include <atomic>
#include <memory>
#include <protocol_frame.h>
#include <queue>
#include <sys/eventfd.h>
#include <thread>
#include <unordered_map>

class Reactor {
  private:
    struct BroadcastTask;
    struct RoomMembershipUpdata;

  public:
    class AiReplyTask {
      public:
        AiReplyTask(Reactor &reactor, std::string &provider, uint64_t conversation_id, uint64_t trigger_message_id, uint64_t context_until_message_id, uint64_t user_id, uint64_t room_id, uint64_t ai_id, std::string ai_model, uint64_t ai_message_id, size_t round = 0);
        void process();
        void onChunk(AiSseData &data);
        void broadcastAiReply(const std::string reply);
        void sendError();
        void dispatchToOtherAis();

      private:
        Reactor &m_reactor;
        std::string m_provider;
        std::unique_ptr<AiClient> m_client;
        uint64_t m_conversation_id;
        uint64_t m_trigger_message_id;
        uint64_t m_context_until_message_id;
        uint64_t m_user_id;
        uint64_t m_room_id;
        uint64_t m_ai_id;
        std::string m_ai_reply;
        std::string m_ai_model;
        uint64_t m_ai_message_id;
        bool m_send_start_frame = false;
        size_t m_round = 0;
    };

    Reactor(int index, std::vector<std::unique_ptr<Reactor>> &sub_reactors, size_t num_memory = 100);
    ~Reactor();
    void addConnection(int fd, ProtocolType protocol);
    void enqueueBroadcast(BroadcastTask task);
    void enqueueRoomMembership(RoomMembershipUpdata updata);
    void shutDown();

  private:
    void loop();
    void conn_notify();
    void broadcast_notify();
    void room_membership_notify();
    void addfd(int fd);
    void modfd(int fd, uint32_t events);
    void trySend(Connection &conn, bool should_mod = true);
    void closeFile(Connection &conn);
    void closeNow(int fd);
    void process(Connection &conn);
    FrameResult checkFrame(Connection &conn);
    std::string_view getMimeType(const std::string &file_path);
    bool sendError(Connection &conn, std::string_view resp, uint64_t end_pos = 0);
    void sendError(Connection &conn, uint16_t close_code);

  private:
    int m_index;
    int m_epollfd;
    int m_conn_notifyfd;
    int m_broadcast_notifyfd;
    int m_room_membership_notifyfd;
    std::vector<std::unique_ptr<Reactor>> &m_sub_reactors;
    std::queue<std::pair<int, ProtocolType>> m_conn_queue;
    std::mutex m_queue_mutex;

    struct BroadcastTask {
        uint64_t room_id;
        std::vector<int> target_fds;
        std::shared_ptr<const std::string> frame;
    };
    std::queue<BroadcastTask> m_broadcast_queue;
    std::mutex m_broadcast_mutex;

    struct RoomMembershipUpdata {
        uint64_t room_id;
        std::vector<int> target_fds;
        bool join;
    };
    std::queue<RoomMembershipUpdata> m_room_membership_queue;
    std::mutex m_room_membership_mutex;

    TimerHeap m_timer_heap;
    MemoryPool m_conn_pool;
    std::unordered_map<int, std::unique_ptr<Connection, ConnDeleter>> m_conns;
    std::thread m_thread;
    std::atomic<bool> m_running{true};
    http::Router m_router;
};
