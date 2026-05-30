# Agent 测试入口

当前还没有接入正式测试框架。后续测试优先覆盖这些纯逻辑点：

1. `core/`：状态和字符串转换。
2. `context/`：消息数量、内容长度裁剪。
3. `prompt/`：片段顺序和 role 映射。
4. `tools/`：注册、重复注册、未注册调用、成功调用。
5. `runtime/`：fake provider 下的 reply/no-reply/error 路径。

集成测试放到 bridge 稳定之后再补，避免一开始就把 agent 测试绑死在 WebSocket、MySQL 或外部模型上。

当前 smoke 入口：

```bash
g++ -std=c++20 -I include \
  src/agent/tests/memory_store_smoke.cpp \
  src/agent/memory/memory_store.cpp \
  src/agent/memory/in_memory_memory_store.cpp \
  -o /tmp/agent_memory_store_smoke
/tmp/agent_memory_store_smoke

g++ -std=c++20 -I include \
  src/agent/tests/conversation_context_prompt_smoke.cpp \
  src/agent/context/conversation_context.cpp \
  src/agent/prompt/conversation_context_prompt.cpp \
  src/agent/prompt/prompt_plan.cpp \
  -o /tmp/agent_conversation_context_prompt_smoke
/tmp/agent_conversation_context_prompt_smoke

g++ -std=c++20 -I include \
  src/agent/tests/conversation_context_manager_smoke.cpp \
  src/agent/context/conversation_context.cpp \
  src/agent/context/conversation_context_manager.cpp \
  src/agent/context/in_memory_conversation_context_store.cpp \
  -o /tmp/agent_conversation_context_manager_smoke
/tmp/agent_conversation_context_manager_smoke

g++ -std=c++20 -I include \
  src/agent/tests/runtime_conversation_context_smoke.cpp \
  src/agent/runtime/agent_runtime.cpp \
  src/agent/context/context_pack.cpp \
  src/agent/context/conversation_context.cpp \
  src/agent/context/in_memory_conversation_context_store.cpp \
  src/agent/prompt/conversation_context_prompt.cpp \
  src/agent/prompt/prompt_plan.cpp \
  src/agent/memory/memory_store.cpp \
  src/agent/core/agent_types.cpp \
  -o /tmp/agent_runtime_conversation_context_smoke
/tmp/agent_runtime_conversation_context_smoke
```
