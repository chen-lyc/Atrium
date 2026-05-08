#pragma once

#include "mysql_pool.h"
#include <string>
#include <unordered_map>

enum class AiClientStatus {
    Success,
    ModelNotRegistered,
    BuildRequestFailed,
    NetworkError,
    Unauthorized,
    ServerError,
    QuotaExceeded,
};

struct AiClientResult {
    AiClientStatus state;
    uint64_t ai_id;
    std::string reply;
};

class DeepSeek {
  private:
    struct RecentMessage;

  public:
    static void init();
    AiClientResult chat(const uint64_t conversation_id, const uint64_t user_id, const std::string &api, const std::string &model, const std::string &content);

  private:
    struct RecentMessage {
        uint64_t send_id;
        std::string display_name;
        std::string content;
    };
    static bool loadOrRegisterAiModel(const std::string &model);
    static MysqlPool::QueryResult readPromptFile(std::string &prompt);
    MysqlPool::QueryResult getRecentMessages(std::vector<RecentMessage> &recent_messages, uint64_t conversation_id, int limit = 30);
    MysqlPool::QueryResult getSystemPrompt(uint64_t ai_id, std::string &prompt);
    MysqlPool::QueryResult checkAndIncrementUsage(uint64_t user_id);

  private:
    static std::unordered_map<std::string, uint64_t> m_model_id;
};