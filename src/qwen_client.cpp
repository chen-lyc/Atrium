#include "ai_client.h"
#include "json.hpp"
#include "logger.h"
using namespace std;
using json = nlohmann::json;

Qwen::Qwen() : AiClient({.provider = "qwen",
                   .display_name = "Qwen",
                   .avatar_url = "/avatars/qwen-logo.svg",
                   .base_url = "dashscope.aliyuncs.com",
                   .api_path = "/compatible-mode/v1/chat/completions",
                   .common_prompt = "config/prompt/shared/common.md",
                   .models = {
                       {"qwen3.5-flash", "config/prompt/qwen/qwen3.5-flash/adapter.md"},
                       {"qwen3.5-plus", "config/prompt/qwen/qwen3.5-plus/adapter.md"}},
                   .stream_include_usage = true}) {}

void Qwen::init() {
    AiClient::registerModels({.provider = "qwen",
        .display_name = "Qwen",
        .avatar_url = "/avatars/qwen-logo.svg",
        .base_url = "dashscope.aliyuncs.com",
        .api_path = "/compatible-mode/v1/chat/completions",
        .common_prompt = "config/prompt/shared/common.md",
        .models = {
            {"qwen3.5-flash", "config/prompt/qwen/qwen3.5-flash/adapter.md"},
            {"qwen3.5-plus", "config/prompt/qwen/qwen3.5-plus/adapter.md"}},
        .stream_include_usage = true});
}

AiClientStatus Qwen::parseSseLine(std::string_view sse_line, AiSseData &data) {
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

        if (chunk_json["choices"].empty()) {
            if (chunk_json.contains("usage") && !chunk_json["usage"].is_null()) {
                const json &usage = chunk_json["usage"];

                data.prompt_tokens =
                    usage.value("prompt_tokens", 0ULL);

                data.completion_tokens =
                    usage.value("completion_tokens", 0ULL);

                data.total_tokens =
                    usage.value("total_tokens", data.prompt_tokens + data.completion_tokens);

                data.prompt_cache_miss_tokens = data.prompt_tokens;
            }
            return AiClientStatus::Success;
        }

        const json &delta = chunk_json["choices"][0]["delta"];
        string content;
        if (delta["content"].is_string())
            content = delta["content"];
        if (!content.empty())
            data.content = std::move(content);

        return AiClientStatus::Success;
    } catch (const json::exception &e) {
        LOG_WARN("parse usage failed: ", e.what());
        return AiClientStatus::InvalidResponse;
    }
}
