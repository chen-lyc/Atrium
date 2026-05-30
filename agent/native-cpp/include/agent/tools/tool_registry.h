#pragma once

#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace atrium::agent {

struct ToolSpec {
    std::string name;
    std::string description;
    std::string input_schema_json;
};

struct ToolCall {
    std::string name;
    std::string arguments_json;
};

struct ToolResult {
    bool ok = false;
    std::string content;
    std::string error;
};

using ToolHandler = std::function<ToolResult(const ToolCall &)>;

class ToolRegistry {
  public:
    bool registerTool(ToolSpec spec, ToolHandler handler);
    bool contains(const std::string &name) const;
    ToolResult call(const ToolCall &call) const;
    std::vector<ToolSpec> list() const;

  private:
    struct Entry {
        ToolSpec spec;
        ToolHandler handler;
    };

    std::unordered_map<std::string, Entry> m_tools;
};

} // namespace atrium::agent

