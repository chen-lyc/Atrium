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

struct AiClientConfig {
    std::string provider;
    std::string display_name;
    std::string avatar_url;
    std::string base_url;
    std::string api_path;
    std::string common_prompt;
    std::vector<std::pair<std::string, std::string>> models;
    bool stream_include_usage = false;
};

struct AiChatRequest {
    uint64_t conversation_id;
    uint64_t trigger_message_id;
    uint64_t context_until_message_id;
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

class AiClient {
  protected:
    struct RecentMessage;

  public:
    AiClient(AiClientConfig config);
    virtual ~AiClient() = default;
    static void registerModels(const AiClientConfig &config);
    static std::unique_ptr<AiClient> create(const std::string &provider);
    AiClientStatus chat(const AiChatRequest &request, uint64_t &ai_id, std::function<void(AiSseData &reply)> &onChunk);
    const std::string &provider() const {
        return m_config.provider;
    }
    const std::string &display_name() const {
        return m_config.display_name;
    }
    const std::string &avatar_url() const {
        return m_config.avatar_url;
    }

  protected:
    struct RecentMessage {
        uint64_t send_id;
        std::string display_name;
        std::string content;
    };
    static bool registerModel(const std::string &model, const std::string &adapter_path, const std::string &common_prompt, const std::string &display_name, const std::string &avatar_url, const std::string &provider);
    static MysqlPool::QueryResult readPromptFile(const std::string &path, std::string &prompt);
    MysqlPool::QueryResult getRecentMessages(std::vector<RecentMessage> &recent_messages, uint64_t conversation_id, uint64_t last_message_id, int limit = 30);
    MysqlPool::QueryResult getSystemPrompt(uint64_t ai_id, std::string &prompt);
    MysqlPool::QueryResult checkAndIncrementUsage(uint64_t user_id);
    virtual AiClientStatus parseSseLine(std::string_view line, AiSseData &data) = 0;

  protected:
    AiClientConfig m_config;
    std::unordered_map<std::string, uint64_t> m_model_id;
};

class DeepSeek : public AiClient {
  public:
    DeepSeek();
    static void init();

  private:
    AiClientStatus parseSseLine(std::string_view line, AiSseData &data);
};

class Qwen : public AiClient {
  public:
    Qwen();
    static void init();

  private:
    AiClientStatus parseSseLine(std::string_view line, AiSseData &data);
};
