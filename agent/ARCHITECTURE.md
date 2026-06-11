# Agent 架构草图

本目录的设计原则是：agent 核心只关心“在某个对话时刻，一个 AI 成员应该如何理解上下文并做出下一步决策”。房间、数据库、WebSocket、provider HTTP 细节都在核心外侧。

Agent 已迁出后端 `src/` / `include/`，当前主实现语言是 TypeScript。

## 分层

### 1. Core

`src/core/` 保存稳定领域类型，例如 `AgentProfile`、`TurnContext`、`AgentResponse`。这些类型应该小、直接、可测试，不依赖任何外部服务。

内部 ID 统一用字符串。C++ 后端或 JSON 边界传来的数字 ID 必须先经过 bridge 归一化，避免 TypeScript number 精度问题扩散到 core。

### 2. Context

`src/context/` 负责从原始消息历史里整理上下文包，也保存 Atrium 双轴上下文：

- `ConversationContextState` 是对话轴共享白板，按 `conversation_id` 保存目标、约束、决策、当前方向、被否方案、阶段标记等。
- `AgentStanceHistory` 是主体轴私有履历，按 `(conversation_id, ai_id)` 保存某个 AI 在本场说过/主张过什么。

Context 层可以做长度限制、消息选择、阶段标记和 owner/system patch 边界，但不访问数据库。

### 3. Prompt

`src/prompt/` 把系统提示、群聊上下文、对话轴、主体轴、工具说明组合成一个请求计划。prompt 组织规则在这里，不散落到 provider 或 reactor 里。

当前 Atrium 五段式顺序是：静态层 -> 对话轴共享白板 -> 最近原文消息 -> 当前 AI 私有履历 + 阶段化重新实例化指令 -> 当前触发消息。

最近原文消息必须保留他者角色位：owner、其他人类和具体 AI 成员都要带结构化署名；除当前 AI 自己的历史发言外，其他参与者消息不能进入 assistant 续写位。

### 4. Memory

`src/memory/` 只提供抽象接口和 agent 内部内存实现。它是未来泛化长期记忆材料，不是当前 Atrium 双轴上下文主线；runtime 本期不主动把 `MemoryStore` 注入 prompt。

### 5. Tools

`src/tools/` 负责工具声明、注册、调用和结果归一化。工具实现可以在更外层，但 runtime 只通过 registry 看到统一接口。

### 6. Providers

`src/providers/` 定义模型网关。DeepSeek/Qwen/OpenAI/本地模型都应该被包装成同一种 `ModelGateway`，不要让 runtime 认识 SSE、API key 或不同 provider 的响应格式。

### 7. Runtime

`src/runtime/` 是单轮执行编排层。它可以调用 context、prompt、tools、provider，并在 AI 可见回复后把该 AI 的内容连同 provenance append 到主体轴履历；`<NO_REPLY>`、失败、空回复不产生履历。runtime 不能直接访问 MySQL、Redis、WebSocket 或 Reactor。

### 8. Bridge

`src/bridge/` 是唯一允许定义 Atrium 业务桥接和 C++ 后端过渡契约的层。

Bridge 负责：

- 把后端房间/对话/消息/AI 阵容转换为 `TurnContext`，包括 `owner_user_id` 以支持 prompt 署名保真。
- 传递可选 phase/context watermark，供过期写回和草稿确认检查使用。
- 把 `AgentResponse` 转成现有落库、广播或静默行为。
- 归一化 snake_case/camelCase 字段。
- 归一化 C++/JSON 传来的数字 ID。

真正接入现有后端前，先写方案，不直接修改后端运行代码。

## 目标数据流

```text
Atrium message event in C++ backend
  -> backend transition payload
  -> bridge normalizes ids and fields
  -> runtime builds ContextPack
  -> runtime asks ConversationContextStore / AgentStanceHistoryStore
  -> prompt builds PromptPlan
  -> provider ModelGateway streams/completes response
  -> runtime appends current AI reply and provenance to its private stance history
  -> runtime returns AgentResponse
  -> bridge/backend adapter persists and broadcasts through existing Atrium path
```

## 明确不做

- agent core 不直接管理 socket、epoll、eventfd。
- agent core 不直接执行 SQL。
- runtime 不拼 provider 专属 JSON。
- provider 不决定 Atrium 产品语义，例如 `<NO_REPLY>` 是否落库。
- bridge 不塞 prompt 规则和工具策略。
- 旧 C++ 骨架不再作为设计依据；当前源码以 TypeScript 分层为准。

## 现有代码迁移目标

当前线上 AI 能力主要还在这些后端位置：

- `include/ai_client.h` / `src/ai_client.cpp`：provider 请求、prompt 拼装、历史消息查询、quota、NO_REPLY 缓冲。
- `include/sub_reactor.h` / `src/sub_reactor.cpp`：AI 任务、广播、落库、接力。
- `include/connection_route.h` / `src/connection_route.cpp`：conversation + AI 维度的串行调度。

后续迁移时不要一次性搬后端运行链路。优先按以下顺序收敛：

1. 在 `src/bridge/` 固定 C++ 后端和 TS agent 的进程/消息契约。
2. 把 provider HTTP/SSE 适配到 `src/providers/ModelGateway`。
3. 把 prompt 组装从 `AiClient` 分离到 `src/prompt/`。
4. 把消息历史选择从 SQL 结果处理分离到 `src/context/`。
5. 把调度语义从 Reactor 周边收敛到 agent runtime 或专门 scheduler。
