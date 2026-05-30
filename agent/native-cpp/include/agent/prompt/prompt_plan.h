#pragma once

#include <string>
#include <vector>

namespace atrium::agent {

enum class PromptRole {
    System,
    User,
    Assistant,
    Tool,
};

struct PromptFragment {
    PromptRole role = PromptRole::User;
    std::string name;
    std::string content;
    bool required = true;
};

class PromptPlan {
  public:
    void add(PromptFragment fragment);
    void addSystem(std::string name, std::string content);
    void addUser(std::string name, std::string content);
    void addAssistant(std::string name, std::string content);

    const std::vector<PromptFragment> &fragments() const;
    bool empty() const;

  private:
    std::vector<PromptFragment> m_fragments;
};

const char *toString(PromptRole role);

} // namespace atrium::agent

