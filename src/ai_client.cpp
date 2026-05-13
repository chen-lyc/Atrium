#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "httplib.h"
#include "ai_client.h"
#include "json.hpp"
#include "logger.h"
#include "utils.h"
using namespace std;
using json = nlohmann::json;

AiClient::AiClient(AiClientConfig config) : m_config(std::move(config)) {
    for (auto &[model, adapter_path] : m_config.models) {
        static const string sql = "SELECT id FROM ai WHERE model = ?";
        MysqlPool::MysqlParams params{model};
        vector<vector<string>> rows;
        size_t col_count = 1;
        MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, rows, col_count);
        if (ret == MysqlPool::QueryResult::Success) {
            uint64_t id = 0;
            try {
                id = stoull(rows[0][0]);
            } catch (const exception &e) {
                continue;
            }
            m_model_id.emplace(model, id);
        }
    }
}

void AiClient::registerModels(const AiClientConfig &config) {
    for (auto &[model, adapter_path] : config.models) {
        registerModel(model, adapter_path, config.common_prompt, config.display_name, config.avatar_url, config.provider);
    }
}

std::unique_ptr<AiClient> AiClient::create(const std::string &provider) {
    if (provider == "deepseek") {
        return std::make_unique<DeepSeek>();
    }
    if (provider == "qwen") {
        return std::make_unique<Qwen>();
    }
    throw std::runtime_error("unknown provider: " + provider);
}

AiClientStatus AiClient::chat(const AiChatRequest &request, uint64_t &ai_id, std::function<void(AiSseData &reply)> &onChunk) {
    auto it = m_model_id.find(request.model);
    if (it == m_model_id.end()) {
        return AiClientStatus::ModelNotRegistered;
    }
    uint64_t id = it->second;
    ai_id = id;

    MysqlPool::QueryResult usage_ret = checkAndIncrementUsage(request.user_id);
    if (usage_ret == MysqlPool::QueryResult::AlreadyExists) {
        return AiClientStatus::QuotaExceeded;
    }
    if (usage_ret != MysqlPool::QueryResult::Success) {
        return AiClientStatus::ServerError;
    }

    vector<RecentMessage> recent_messages;
    MysqlPool::QueryResult ret = getRecentMessages(recent_messages, request.conversation_id, request.context_until_message_id);
    if (ret != MysqlPool::QueryResult::NotFound && ret != MysqlPool::QueryResult::Success) {
        return AiClientStatus::ServerError;
    }

    string body;
    try {
        json out;
        out["model"] = request.model;
        out["stream"] = true;
        if (m_config.stream_include_usage) {
            json stream_opts;
            stream_opts["include_usage"] = true;
            out["stream_options"] = stream_opts;
        }
        json messages = json::array();

        string system_prompt;
        ret = getSystemPrompt(id, system_prompt);

        string thinking_adapter;
        if (get_thinking_adapter_for_ai_in_conversation(request.conversation_id, id, thinking_adapter) == MysqlPool::QueryResult::Success && !thinking_adapter.empty()) {
            if (!system_prompt.empty()) system_prompt += "\n\n";
            system_prompt += thinking_adapter;
        }

        if (!system_prompt.empty()) {
            json sys_msg;
            sys_msg["role"] = "system";
            sys_msg["content"] = std::move(system_prompt);
            messages.emplace_back(std::move(sys_msg));
        }

        for (auto &[send_id, display_name, content] : recent_messages) {
            json message;
            if (send_id != id) {
                message["role"] = "user";
                message["content"] = '[' + display_name + "] " + content;
            } else {
                message["role"] = "assistant";
                message["content"] = content;
            }
            messages.emplace_back(std::move(message));
        }
        out["messages"] = messages;
        body = out.dump();
    } catch (const json::exception &e) {
        LOG_WARN("%s chat failed: model = %s, step = build request body, error = %s",
            m_config.provider.c_str(),
            std::string(request.model).c_str(),
            e.what());
        return AiClientStatus::BuildRequestFailed;
    }

    LOG_DEBUG("begin to be client");
    httplib::SSLClient cli(m_config.base_url);
    cli.set_bearer_token_auth(request.api);
    cli.set_read_timeout(60, 0);
    httplib::Headers headers = {{"Content-Type", "application/json"}};

    string buffer;
    string pending;
    bool start_sent = false;
    static const string kNoReplyToken = "<NO_REPLY>";
    // NO_REPLY 检测的缓冲上限。
    // 取 30 是为了覆盖 Qwen 等模型可能吐出的 tool_call 前缀
    // 例如 "<tool_call>\n<NO_REPLY>" (22 字符)
    static const size_t kNoReplyBufferLimit = 30;
    httplib::Result res = cli.Post(m_config.api_path, headers, body, "application/json", [&buffer, &pending, &start_sent, &onChunk, this](const char *data, size_t len) -> bool {
        buffer.append(data, len);
        while (true) {
            size_t pos = buffer.find("\n\n");
            size_t sep_len = 2;
            if (pos == string::npos) {
                pos = buffer.find("\r\n\r\n");
                sep_len = 4;
            }
            if (pos == string::npos) return true;

            if (!buffer.starts_with("data:")) return false;

            string event = buffer.substr(0, pos);
            buffer.erase(0, pos + sep_len);
            AiSseData data;
            AiClientStatus ret = parseSseLine(event, data);

            if (ret == AiClientStatus::SseDone) {
                if (!start_sent && !pending.empty() && pending != kNoReplyToken) {
                    AiSseData flush;
                    flush.content = pending;
                    onChunk(flush);
                    start_sent = true;
                }
                return true;
            }
            if (ret == AiClientStatus::InvalidResponse) return false;

            if (data.content.empty() && data.total_tokens == 0) continue;

            if (data.content.empty() && data.total_tokens > 0) {
                onChunk(data);
                continue;
            }

            if (start_sent) {
                onChunk(data);
                continue;
            }

            pending += data.content;
            if (pending.size() < kNoReplyBufferLimit) continue;
            if (pending.find(kNoReplyToken) != string::npos) {
                if (data.total_tokens) {
                    data.content.clear();
                    onChunk(data);
                }
                continue;
            }

            AiSseData flush;
            flush.content = pending;
            onChunk(flush);
            start_sent = true;
            pending.clear();
        }
        return false;
    });
    LOG_DEBUG("after ai post");
    if (!res) return AiClientStatus::NetworkError;
    LOG_DEBUG("ai response status = %d, body = %s", res->status, res->body.c_str());
    switch (res->status) {
        case 200: {
            if (start_sent) return AiClientStatus::Success;
            else return AiClientStatus::NoReply;
        }
        case 401: return AiClientStatus::Unauthorized;
        case 500: return AiClientStatus::ServerError;
        default: return AiClientStatus::ServerError;
    }
}

MysqlPool::QueryResult AiClient::getRecentMessages(std::vector<RecentMessage> &recent_messages, uint64_t conversation_id, uint64_t last_message_id, int limit) {
    static const string sql =
        "SELECT m.send_id, p.display_name, m.content "
        "FROM messages m "
        "JOIN participants p ON p.id = m.send_id "
        "WHERE m.conversation_id = ? AND m.id <= ? AND m.deleted_at_ms IS NULL "
        "ORDER BY m.send_time_ms DESC, m.id DESC "
        "LIMIT ?";
    MysqlPool::MysqlParams params{conversation_id, last_message_id, limit};
    vector<vector<string>> rows;
    size_t col_count = 3;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, rows, col_count);
    if (ret != MysqlPool::QueryResult::Success) return ret;

    for (size_t i = 0; i < rows.size(); ++i) {
        if (rows[i].size() < col_count) return MysqlPool::QueryResult::ServerError;

        uint64_t send_id = 0;
        try {
            send_id = stoull(rows[i][0]);
        } catch (const exception &e) {
            LOG_ERROR("get recent messages failed: parse send_id error, row = %zu, value = '%s', err = %s, conversation_id = %llu",
                i,
                rows[i][0].c_str(),
                e.what(),
                conversation_id);
            return MysqlPool::QueryResult::ServerError;
        }

        recent_messages.emplace_back(send_id, rows[i][1], rows[i][2]);
    }
    reverse(recent_messages.begin(), recent_messages.end());
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult AiClient::getSystemPrompt(uint64_t ai_id, std::string &prompt) {
    static const string sql = "SELECT system_prompt FROM ai WHERE id = ?";
    MysqlPool::MysqlParams params{ai_id};
    vector<vector<string>> rows;
    size_t col_count = 1;
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(sql, params, rows, col_count);
    if (ret != MysqlPool::QueryResult::Success) return ret;
    if (rows.empty() || rows[0].empty()) return MysqlPool::QueryResult::NotFound;
    prompt = std::move(rows[0][0]);
    return MysqlPool::QueryResult::Success;
}

MysqlPool::QueryResult AiClient::checkAndIncrementUsage(uint64_t user_id) {
    static const string select_sql =
        "SELECT count, daily_quota FROM ai_usage WHERE user_id = ? AND date = CURDATE()";
    static const string insert_sql =
        "INSERT INTO ai_usage (user_id, date, count, daily_quota) VALUES (?, CURDATE(), 1, 20)";
    static const string update_sql =
        "UPDATE ai_usage SET count = count + 1 WHERE user_id = ? AND date = CURDATE() AND count < daily_quota";

    MysqlPool::MysqlParams params{user_id};
    vector<vector<string>> rows;
    size_t col_count = 2;
    auto increment_existing_usage = [&]() -> MysqlPool::QueryResult {
        uint64_t affected_rows = 0;
        MysqlPool::QueryResult ret = MysqlPool::getInstance().executeUpdateAffected(update_sql, params, affected_rows);
        if (ret != MysqlPool::QueryResult::Success) return MysqlPool::QueryResult::ServerError;
        if (affected_rows == 0) return MysqlPool::QueryResult::AlreadyExists;
        return MysqlPool::QueryResult::Success;
    };

    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(select_sql, params, rows, col_count);
    if (ret == MysqlPool::QueryResult::Success) {
        int count = 0, quota = 20;
        try {
            count = stoi(rows[0][0]);
            quota = stoi(rows[0][1]);
        } catch (const exception &e) {
            return MysqlPool::QueryResult::ServerError;
        }
        if (count >= quota) return MysqlPool::QueryResult::AlreadyExists;

        return increment_existing_usage();
    }
    if (ret == MysqlPool::QueryResult::NotFound) {
        ret = MysqlPool::getInstance().executeQuery(insert_sql, params);
        if (ret == MysqlPool::QueryResult::AlreadyExists) return increment_existing_usage();
        if (ret != MysqlPool::QueryResult::Success) return MysqlPool::QueryResult::ServerError;
        return MysqlPool::QueryResult::Success;
    }
    return MysqlPool::QueryResult::ServerError;
}

MysqlPool::QueryResult AiClient::readPromptFile(const std::string &path, std::string &prompt) {
    int file_fd = open(path.c_str(), O_RDONLY);
    if (file_fd == -1) {
        LOG_ERROR("AiClient open prompt file failed, errno=%d, path=%s", errno, path.c_str());
        return MysqlPool::QueryResult::ServerError;
    }
    struct stat st;
    fstat(file_fd, &st);
    size_t file_size = st.st_size;
    prompt.assign(file_size, '\0');
    size_t recvd = 0;
    while (recvd < file_size) {
        ssize_t n = read(file_fd, prompt.data() + recvd, file_size - recvd);
        if (n <= 0) {
            LOG_ERROR("AiClient read prompt file failed, errno=%d, recvd=%zu, file_size=%zu",
                errno,
                recvd,
                file_size);
            close(file_fd);
            return MysqlPool::QueryResult::ServerError;
        }
        recvd += static_cast<size_t>(n);
    }
    close(file_fd);
    return MysqlPool::QueryResult::Success;
}

bool AiClient::registerModel(const std::string &model, const std::string &adapter_path, const std::string &common_prompt, const std::string &display_name, const std::string &avatar_url, const std::string &provider) {
    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeTransaction([&](MysqlTxnContext &txn) -> MysqlPool::QueryResult {
        const string sql = "SELECT id FROM ai WHERE model = ?";
        MysqlPool::MysqlParams params{model};
        vector<vector<string>> rows;
        size_t col_count = 1;
        MysqlPool::QueryResult ret = txn.executeQuery(sql, params, rows, col_count);
        if (ret == MysqlPool::QueryResult::Success) {
            uint64_t id = 0;
            try {
                id = stoull(rows[0][0]);
            } catch (const exception &e) {
                LOG_ERROR("registerModel failed: model = %s, step = parse ai id, raw_id = %s, error = %s",
                    model.data(),
                    rows.empty() || rows[0].empty() ? "<empty>" : rows[0][0].data(),
                    e.what());
                return MysqlPool::QueryResult::ServerError;
            }

            string prompt_buf;
            ret = readPromptFile(common_prompt, prompt_buf);
            if (ret != MysqlPool::QueryResult::Success) return ret;
            string adapter_buf;
            ret = readPromptFile(adapter_path, adapter_buf);
            if (ret != MysqlPool::QueryResult::Success) return ret;
            prompt_buf += "\n\n";
            prompt_buf += std::move(adapter_buf);

            static const string up_sql = "UPDATE ai SET system_prompt = ? WHERE id = ?";
            MysqlPool::MysqlParams up_params{MysqlPool::Blob{prompt_buf.data(), prompt_buf.size()}, id};
            ret = txn.executeQuery(up_sql, up_params);
            if (ret != MysqlPool::QueryResult::Success) {
                LOG_ERROR("registerModel update system_prompt failed, model = %s", model.c_str());
                return MysqlPool::QueryResult::ServerError;
            }

            return MysqlPool::QueryResult::Success;
        } else if (ret == MysqlPool::QueryResult::NotFound) {
            string insert_participants_sql =
                "INSERT INTO participants (kind, display_name, avatar_url) "
                "VALUES (2, ?, ?)";
            MysqlPool::MysqlParams p_params{display_name, avatar_url};
            uint64_t participant_id = 0;
            ret = txn.executeQuery(insert_participants_sql, p_params, &participant_id);
            if (ret != MysqlPool::QueryResult::Success) {
                LOG_ERROR("registerModel failed: model = %s, step = insert participant, ret = %d",
                    model.data(),
                    ret);
                return MysqlPool::QueryResult::ServerError;
            }
            string insert_ai_sql =
                "INSERT INTO ai (id, provider, model) "
                "VALUES (?, ?, ?)";
            MysqlPool::MysqlParams ai_params{participant_id, provider, model};
            ret = txn.executeQuery(insert_ai_sql, ai_params);
            if (ret != MysqlPool::QueryResult::Success) {
                LOG_ERROR("registerModel failed: model = %s, step = insert ai, ret = %d",
                    model.data(),
                    ret);
                return MysqlPool::QueryResult::ServerError;
            }

            string prompt_buf;
            ret = readPromptFile(common_prompt, prompt_buf);
            if (ret != MysqlPool::QueryResult::Success) return ret;
            string adapter_buf;
            ret = readPromptFile(adapter_path, adapter_buf);
            if (ret != MysqlPool::QueryResult::Success) return ret;
            prompt_buf += "\n\n";
            prompt_buf += std::move(adapter_buf);

            static const string up_sql = "UPDATE ai SET system_prompt = ? WHERE id = ?";
            MysqlPool::MysqlParams up_params{MysqlPool::Blob{prompt_buf.data(), prompt_buf.size()}, participant_id};
            ret = txn.executeQuery(up_sql, up_params);
            if (ret != MysqlPool::QueryResult::Success) {
                LOG_ERROR("registerModel update system_prompt failed, model = %s", model.c_str());
                return MysqlPool::QueryResult::ServerError;
            }

            return MysqlPool::QueryResult::Success;
        } else {
            LOG_ERROR("registerModel failed: model = %s, step = query ai, ret = %d",
                model.data(),
                ret);
            return MysqlPool::QueryResult::ServerError;
        }
        LOG_ERROR("registerModel failed in unknown error");
        return MysqlPool::QueryResult::ServerError;
    });
    return ret == MysqlPool::QueryResult::Success ? true : false;
}
