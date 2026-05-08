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

AiClientResult DeepSeek::chat(const uint64_t conversation_id, const uint64_t user_id, const std::string &api, const std::string &model, const string &content) {
    auto it = m_model_id.find(model);
    if (it == m_model_id.end()) {
        return {AiClientStatus::ModelNotRegistered};
    }
    uint64_t id = it->second;

    MysqlPool::QueryResult usage_ret = checkAndIncrementUsage(user_id);
    if (usage_ret == MysqlPool::QueryResult::AlreadyExists) {
        return {AiClientStatus::QuotaExceeded};
    }
    if (usage_ret != MysqlPool::QueryResult::Success) {
        return {AiClientStatus::ServerError};
    }

    vector<RecentMessage> recent_messages;
    MysqlPool::QueryResult ret = getRecentMessages(recent_messages, conversation_id);
    if (ret != MysqlPool::QueryResult::NotFound && ret != MysqlPool::QueryResult::Success) {
        return {AiClientStatus::ServerError};
    }

    string body;
    try {
        json out;
        out["model"] = model;
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
            std::string(model).c_str(),
            e.what());
        return {AiClientStatus::BuildRequestFailed};
    }

    LOG_DEBUG("begin to be client");
    httplib::SSLClient cli("api.deepseek.com");
    cli.set_default_headers({{"Authorization", "Bearer " + api}});
    LOG_DEBUG("before ai post");
    httplib::Result res = cli.Post("/chat/completions", body, "application/json");
    LOG_DEBUG("after ai post");
    if (!res) return {AiClientStatus::NetworkError};
    LOG_DEBUG("ai response status = %d, body = %s", res->status, res->body.c_str());
    switch (res->status) {
        case 200: break;
        case 401: return {AiClientStatus::Unauthorized};
        case 500: return {AiClientStatus::ServerError};
        default: return {AiClientStatus::ServerError};
    }

    try {
        json in = json::parse(res->body);
        string reply = in["choices"][0]["message"]["content"];
        LOG_DEBUG("get ai reply success");
        return {AiClientStatus::Success, id, std::move(reply)};
    } catch (const json::exception &e) {
        LOG_WARN("ai bad json: %s, body: %s", e.what(), res->body.data());
        return {AiClientStatus::ServerError};
    }
}

MysqlPool::QueryResult DeepSeek::getRecentMessages(std::vector<RecentMessage> &recent_messages, uint64_t conversation_id, int limit) {
    static const string sql =
        "SELECT m.send_id, p.display_name, m.content "
        "FROM messages m "
        "JOIN participants p ON p.id = m.send_id "
        "WHERE m.conversation_id = ? AND m.deleted_at_ms IS NULL "
        "ORDER BY m.send_time_ms DESC, m.id DESC "
        "LIMIT ?";
    MysqlPool::MysqlParams params{conversation_id, limit};
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

MysqlPool::QueryResult DeepSeek::checkAndIncrementUsage(uint64_t user_id) {
    static const string select_sql =
        "SELECT count FROM ai_usage WHERE user_id = ? AND date = CURDATE()";
    static const string insert_sql =
        "INSERT INTO ai_usage (user_id, date, count) VALUES (?, CURDATE(), 1)";
    static const string update_sql =
        "UPDATE ai_usage SET count = count + 1 WHERE user_id = ? AND date = CURDATE() AND count < 20";

    MysqlPool::MysqlParams params{user_id};
    vector<vector<string>> rows;
    size_t col_count = 1;
    auto increment_existing_usage = [&]() -> MysqlPool::QueryResult {
        uint64_t affected_rows = 0;
        MysqlPool::QueryResult ret = MysqlPool::getInstance().executeUpdateAffected(update_sql, params, affected_rows);
        if (ret != MysqlPool::QueryResult::Success) return MysqlPool::QueryResult::ServerError;
        if (affected_rows == 0) return MysqlPool::QueryResult::AlreadyExists;
        return MysqlPool::QueryResult::Success;
    };

    MysqlPool::QueryResult ret = MysqlPool::getInstance().executeQuery(select_sql, params, rows, col_count);
    if (ret == MysqlPool::QueryResult::Success) {
        int count = 0;
        try {
            count = stoi(rows[0][0]);
        } catch (const exception &e) {
            return MysqlPool::QueryResult::ServerError;
        }
        if (count >= 20) return MysqlPool::QueryResult::AlreadyExists;

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
                errno, recvd, file_size);
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
