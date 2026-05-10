#include "mysql_pool.h"
#define CPPHTTPLIB_OPENSSL_SUPPORT
#include "httplib.h"
#include "ai_client.h"
#include "json.hpp"
#include "logger.h"
using namespace std;
using json = nlohmann::json;

std::unordered_map<std::string, uint64_t> DeepSeek::m_model_id;

void DeepSeek::init() {
    loadOrRegisterAiModel("deepseek-v4-flash");
    loadOrRegisterAiModel("deepseek-v4-pro");
}

AiClientStatus DeepSeek::chat(const AiChatRequest &request, uint64_t &ai_id, std::function<void(AiSseData &reply)> &onChunk) {
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
        json messages = json::array();

        string system_prompt;
        ret = getSystemPrompt(id, system_prompt);
        if (ret == MysqlPool::QueryResult::Success && !system_prompt.empty()) {
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
        LOG_WARN("DeepSeek chat failed: model = %s, step = build request body, error = %s",
            std::string(request.model).c_str(),
            e.what());
        return AiClientStatus::BuildRequestFailed;
    }

    LOG_DEBUG("begin to be client");
    httplib::SSLClient cli("api.deepseek.com");
    cli.set_bearer_token_auth(request.api);
    cli.set_read_timeout(60, 0);
    httplib::Headers headers = {{"Content-Type", "application/json"}};

    string buffer;
    string pending;
    bool start_sent = false;
    static const string kNoReplyToken = "<NO_REPLY>";
    httplib::Result res = cli.Post("/chat/completions", headers, body, "application/json", [&buffer, &pending, &start_sent, &onChunk, this](const char *data, size_t len) -> bool {
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

            if (data.content.empty()) continue;

            if (start_sent) {
                onChunk(data);
                continue;
            }

            pending += data.content;
            if (pending.size() < kNoReplyToken.size()) continue;
            if (pending == kNoReplyToken) return true;

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

MysqlPool::QueryResult DeepSeek::getRecentMessages(std::vector<RecentMessage> &recent_messages, uint64_t conversation_id, uint64_t last_message_id, int limit) {
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

MysqlPool::QueryResult DeepSeek::getSystemPrompt(uint64_t ai_id, std::string &prompt) {
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

AiClientStatus DeepSeek::parseSseLine(std::string_view sse_line, AiSseData &data) {
    size_t colon_pos = sse_line.find(':');
    if (colon_pos == string::npos) {
        return AiClientStatus::InvalidResponse;
    }
    size_t data_pos = sse_line.find_first_not_of(" \t", colon_pos + 1);
    string_view chunk = sse_line.substr(data_pos);
    if (chunk == "[DONE]") {
        return AiClientStatus::SseDone;
    }

    try {
        json chunk_json = json::parse(chunk);
        const json &delta = chunk_json["choices"][0]["delta"];
        string content;
        if (delta["content"].is_string())
            content = delta["content"];
        if (!content.empty())
            data.content = std::move(content);

        if (!chunk_json["choices"][0]["finish_reason"].is_string()) return AiClientStatus::Success;
        string finish_reason = chunk_json["choices"][0]["finish_reason"];
        if (finish_reason == "stop") {
            if (!chunk_json.contains("usage") || chunk_json["usage"].is_null()) {
                return AiClientStatus::InvalidResponse;
            }
            const json &usage = chunk_json["usage"];

            data.prompt_tokens =
                usage.value("prompt_tokens", 0ULL);

            data.completion_tokens =
                usage.value("completion_tokens", 0ULL);

            data.total_tokens =
                usage.value("total_tokens", data.prompt_tokens + data.completion_tokens);

            data.cached_tokens =
                usage.value("prompt_tokens_details", json::object())
                    .value("cached_tokens", 0ULL);

            data.prompt_cache_hit_tokens =
                usage.value("prompt_cache_hit_tokens", data.cached_tokens);

            data.prompt_cache_miss_tokens =
                usage.value("prompt_cache_miss_tokens",
                    data.prompt_tokens >= data.prompt_cache_hit_tokens
                        ? data.prompt_tokens - data.prompt_cache_hit_tokens
                        : 0ULL);
        }
        return AiClientStatus::Success;
    } catch (const json::exception &e) {
        LOG_WARN("parse usage failed: ", e.what());
        return AiClientStatus::InvalidResponse;
    }
}

MysqlPool::QueryResult DeepSeek::checkAndIncrementUsage(uint64_t user_id) {
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

MysqlPool::QueryResult DeepSeek::readPromptFile(std::string &prompt) {
    string prompt_path = "config/prompt/deepseek/prompt.md";
    int file_fd = open(prompt_path.c_str(), O_RDONLY);
    if (file_fd == -1) {
        LOG_ERROR("deepseek open prompt file failed, errno=%d, path=%s", errno, prompt_path.c_str());
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
            LOG_ERROR("deepseek read prompt file failed, errno=%d, recvd=%zu, file_size=%zu",
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

bool DeepSeek::loadOrRegisterAiModel(const std::string &model) {
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
                LOG_ERROR("DeepSeek init failed: model = %s, step = parse ai id, raw_id = %s, error = %s",
                    model.data(),
                    rows.empty() || rows[0].empty() ? "<empty>" : rows[0][0].data(),
                    e.what());
                return MysqlPool::QueryResult::ServerError;
            }
            m_model_id.emplace(model, id);

            string prompt_buf;
            ret = readPromptFile(prompt_buf);
            if (ret != MysqlPool::QueryResult::Success) return ret;

            static const string up_sql = "UPDATE ai SET system_prompt = ? WHERE id = ?";
            MysqlPool::MysqlParams up_params{MysqlPool::Blob{prompt_buf.data(), prompt_buf.size()}, id};
            ret = txn.executeQuery(up_sql, up_params);
            if (ret != MysqlPool::QueryResult::Success) {
                LOG_ERROR("deepseek update system_prompt failed, model = %s", model.c_str());
                return MysqlPool::QueryResult::ServerError;
            }

            return MysqlPool::QueryResult::Success;
        } else if (ret == MysqlPool::QueryResult::NotFound) {
            string insert_participants_sql =
                "INSERT INTO participants (kind, display_name, avatar_url) "
                "VALUES (2, 'deepseek', '/avatars/deepseek-logo.svg')";
            uint64_t participant_id = 0;
            MysqlPool::MysqlParams empty_params;
            ret = txn.executeQuery(insert_participants_sql, empty_params, &participant_id);
            if (ret != MysqlPool::QueryResult::Success) {
                LOG_ERROR("DeepSeek init failed: model = %s, step = insert participant, ret = %d",
                    model.data(),
                    ret);
                return MysqlPool::QueryResult::ServerError;
            }
            string insert_ai_sql =
                "INSERT INTO ai (id, provider, model) "
                "VALUES (?, 'deepseek', ?)";
            MysqlPool::MysqlParams params{participant_id, model};
            ret = txn.executeQuery(insert_ai_sql, params);
            if (ret != MysqlPool::QueryResult::Success) {
                LOG_ERROR("DeepSeek init failed: model = %s, step = insert ai, ret = %d",
                    model.data(),
                    ret);
                return MysqlPool::QueryResult::ServerError;
            }
            m_model_id.emplace(model, participant_id);

            string prompt_buf;
            ret = readPromptFile(prompt_buf);
            if (ret != MysqlPool::QueryResult::Success) return ret;

            static const string up_sql = "UPDATE ai SET system_prompt = ? WHERE id = ?";
            MysqlPool::MysqlParams up_params{MysqlPool::Blob{prompt_buf.data(), prompt_buf.size()}, participant_id};
            ret = txn.executeQuery(up_sql, up_params);
            if (ret != MysqlPool::QueryResult::Success) {
                LOG_ERROR("deepseek update system_prompt failed, model = %s", model.c_str());
                return MysqlPool::QueryResult::ServerError;
            }

            return MysqlPool::QueryResult::Success;
        } else {
            LOG_ERROR("DeepSeek init failed: model = %s, step = query ai, ret = %d",
                model.data(),
                ret);
            return MysqlPool::QueryResult::ServerError;
        }
        LOG_ERROR("DeepSeek init failed in unknown error");
        return MysqlPool::QueryResult::ServerError;
    });
    return ret == MysqlPool::QueryResult::Success ? true : false;
}
