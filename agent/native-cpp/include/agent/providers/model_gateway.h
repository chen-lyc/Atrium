#pragma once

#include "agent/core/agent_types.h"
#include "agent/prompt/prompt_plan.h"

#include <functional>
#include <string>

namespace atrium::agent {

struct ModelRequest {
    AgentProfile agent;
    PromptPlan prompt;
    bool stream = true;
};

struct ModelChunk {
    std::string content;
    bool done = false;
};

using ModelChunkHandler = std::function<void(const ModelChunk &)>;

class ModelGateway {
  public:
    virtual ~ModelGateway() = default;
    virtual AgentResponse complete(const ModelRequest &request, ModelChunkHandler on_chunk) = 0;
};

} // namespace atrium::agent
