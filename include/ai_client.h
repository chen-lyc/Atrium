#pragma once

#include "mysql_pool.h"
#include <string>
#include <unordered_map>

enum class AiClientStatus {
    Success,
    NoReply,
    ModelNotRegistered,
    BuildRequestFailed,
    NetworkError,
    Unauthorized,
    ServerError,
    QuotaExceeded,
    InvalidResponse,
    SseDone,
};

struct AiChatRequest {
    uint64_t conversation_id;
    uint64_t trigger_message_id;
    uint64_t user_id;
    std::string api;
    std::string model;
};

struct AiSseData {
    std::string content;
    uint64_t prompt_tokens = 0;
    uint64_t completion_tokens = 0;
    uint64_t total_tokens = 0;
    uint64_t cached_tokens = 0;
    uint64_t prompt_cache_hit_tokens = 0;
    uint64_t prompt_cache_miss_tokens = 0;
};

class DeepSeek {
  private:
    struct RecentMessage;

  public:
    static void init();
    AiClientStatus chat(const AiChatRequest &request, uint64_t &ai_id, std::function<void(AiSseData &reply)> &onChunk);

  private:
    struct RecentMessage {
        uint64_t send_id;
        std::string display_name;
        std::string content;
    };
    static bool loadOrRegisterAiModel(const std::string &model);
    static MysqlPool::QueryResult readPromptFile(std::string &prompt);
    MysqlPool::QueryResult getRecentMessages(std::vector<RecentMessage> &recent_messages, uint64_t conversation_id, uint64_t last_message_id, int limit = 30);
    MysqlPool::QueryResult getSystemPrompt(uint64_t ai_id, std::string &prompt);
    AiClientStatus parseSseLine(std::string_view line, AiSseData &data);
    MysqlPool::QueryResult checkAndIncrementUsage(uint64_t user_id);

  private:
    static std::unordered_map<std::string, uint64_t> m_model_id;
};