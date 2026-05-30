#include "agent/tools/tool_registry.h"

#include <utility>

namespace atrium::agent {

bool ToolRegistry::registerTool(ToolSpec spec, ToolHandler handler) {
    if (spec.name.empty() || !handler) {
        return false;
    }

    const auto name = spec.name;
    auto [it, inserted] = m_tools.emplace(name, Entry{std::move(spec), std::move(handler)});
    (void)it;
    return inserted;
}

bool ToolRegistry::contains(const std::string &name) const {
    return m_tools.find(name) != m_tools.end();
}

ToolResult ToolRegistry::call(const ToolCall &call) const {
    auto it = m_tools.find(call.name);
    if (it == m_tools.end()) {
        return ToolResult{false, "", "tool not registered: " + call.name};
    }
    return it->second.handler(call);
}

std::vector<ToolSpec> ToolRegistry::list() const {
    std::vector<ToolSpec> specs;
    specs.reserve(m_tools.size());
    for (const auto &[name, entry] : m_tools) {
        (void)name;
        specs.emplace_back(entry.spec);
    }
    return specs;
}

} // namespace atrium::agent
