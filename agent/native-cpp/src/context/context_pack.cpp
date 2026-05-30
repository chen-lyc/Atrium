#include "agent/context/context_pack.h"

#include <algorithm>
#include <utility>

namespace atrium::agent {

ContextPack::ContextPack(ContextLimits limits) : m_limits(limits) {}

void ContextPack::add(MessageRef message) {
    m_messages.emplace_back(std::move(message));
}

void ContextPack::trimToLimits() {
    while (m_messages.size() > m_limits.max_messages) {
        m_messages.erase(m_messages.begin());
    }

    while (!m_messages.empty() && contentBytes() > m_limits.max_content_bytes) {
        m_messages.erase(m_messages.begin());
    }
}

const std::vector<MessageRef> &ContextPack::messages() const {
    return m_messages;
}

bool ContextPack::empty() const {
    return m_messages.empty();
}

std::size_t ContextPack::contentBytes() const {
    std::size_t total = 0;
    for (const auto &message : m_messages) {
        total += message.content.size();
    }
    return total;
}

ContextPack buildContextPack(const TurnContext &turn, ContextLimits limits) {
    ContextPack pack(limits);
    for (const auto &message : turn.messages) {
        pack.add(message);
    }
    pack.trimToLimits();
    return pack;
}

} // namespace atrium::agent
