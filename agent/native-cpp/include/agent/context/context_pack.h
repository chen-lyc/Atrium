#pragma once

#include "agent/core/agent_types.h"

#include <cstddef>
#include <vector>

namespace atrium::agent {

struct ContextLimits {
    std::size_t max_messages = 30;
    std::size_t max_content_bytes = 12000;
};

class ContextPack {
  public:
    explicit ContextPack(ContextLimits limits = {});

    void add(MessageRef message);
    void trimToLimits();
    const std::vector<MessageRef> &messages() const;
    bool empty() const;

  private:
    std::size_t contentBytes() const;

  private:
    ContextLimits m_limits;
    std::vector<MessageRef> m_messages;
};

ContextPack buildContextPack(const TurnContext &turn, ContextLimits limits = {});

} // namespace atrium::agent
