#include "ai_client.h"
#include "json.hpp"
#include "logger.h"
using namespace std;
using json = nlohmann::json;

DeepSeek::DeepSeek() : AiClient({
    .provider = "deepseek",
    .display_name = "deepseek",
    .avatar_url = "/avatars/deepseek-logo.svg",
    .base_url = "api.deepseek.com",
    .api_path = "/chat/completions",
    .common_prompt = "config/prompt/shared/common.md",
    .models = {
        {"deepseek-v4-flash", "config/prompt/deepseek/deepseek-v4-flash/adapter.md"},
        {"deepseek-v4-pro", "config/prompt/deepseek/deepseek-v4-pro/adapter.md"}
    }
}) {}

void DeepSeek::init() {
    AiClient::registerModels({
        .provider = "deepseek",
        .display_name = "deepseek",
        .avatar_url = "/avatars/deepseek-logo.svg",
        .base_url = "api.deepseek.com",
        .api_path = "/chat/completions",
        .common_prompt = "config/prompt/shared/common.md",
        .models = {
            {"deepseek-v4-flash", "config/prompt/deepseek/deepseek-v4-flash/adapter.md"},
            {"deepseek-v4-pro", "config/prompt/deepseek/deepseek-v4-pro/adapter.md"}
        }
    });
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
