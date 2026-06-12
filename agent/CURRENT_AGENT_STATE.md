# Current Agent State

最后更新：2026-05-31

## 当前阶段

Agent 子系统处于 Phase 0：从 C++ 后端目录迁出，并切换到根目录 TypeScript 子项目。

已经建立：

- `agent/package.json`
- `agent/tsconfig.json`
- `agent/src/core/`
- `agent/src/context/`
- `agent/src/prompt/`
- `agent/src/memory/`
- `agent/src/tools/`
- `agent/src/providers/`
- `agent/src/runtime/`
- `agent/src/bridge/`
- `agent/tests/`

当前代码定义 TypeScript 骨架类型、接口、conversation context、未来泛化 memory 抽象、runtime、bridge 过渡契约和 smoke tests，不接入主服务。

## 当前边界

- 不修改现有 AI 回复链路。
- 不修改 `SubReactor`、`AiClient`、`ConvAiScheduler`。
- 不修改数据库 schema。
- 不把 agent 加入后端 `Makefile`。
- 不改变 DeepSeek/Qwen 现有 provider 行为。
- Agent 开发者只处理 `agent/`，后端接入只能先写方案，不能直接动运行代码。
- 后端接口需求统一记录在 `agent/BACKEND_INTERFACE.md`。
- C++/JSON 到 TypeScript 的字段和 ID 转换统一放在 `agent/src/bridge/`。

## 已有 agent 能力

- `AgentRuntime`：单轮执行入口，能组装 prompt 并调用 `ModelGateway`。
- `PromptPlan`：保存 system/user/assistant/tool 片段。
- 最近消息窗口渲染：runtime 会把 owner、其他人类和具体 AI 成员渲染成不同署名；其他参与者消息保持在 user 侧他者发言位置。
- `ContextPack`：按消息数量和内容字节裁剪 turn 消息。
- `MemoryStore` / `InMemoryMemoryStore`：支持 search / upsert / forget / loadForTurn，作为未来泛化 memory 材料保留；本期不进入 Atrium 双轴上下文 prompt 主线。
- `ConversationContextState`：单个 conversation 的结构化上下文状态。
- `ConversationContextStore` / `InMemoryConversationContextStore`：上下文状态读取/保存抽象与内存实现。
- `ConversationContextManager`：显式 patch 应用器，支持 upsert entry、标记状态、移除 entry、更新 summary、更新 last summarized message、owner-only 当前方向和阶段切换。
- `ConversationContextState.phase`：三态阶段标记，当前为 `divergence / convergence_execution / blocked`。
- `RejectedOptionRecord`：被否方案现在记录方案本身、否决理由、否决前提和 source anchors，供撞墙期人工回滚参照。
- `ConversationContextEntryKind.CurrentDirection`：owner 确认后的当前推进方向，收敛执行期 prompt 会和最新决策一起读取。
- `AgentStanceHistoryStore` / `InMemoryAgentStanceHistoryStore`：按 `(conversation_id, ai_id)` 保存每个 AI 的私有立场履历；reply 才追加，`<NO_REPLY>` 不追加；记录 `phaseAtGeneration`、`contextUntilMessageId`、`inputStanceRecordIds`，并支持 owner 按 source message 溯源排除。
- `appendConversationContextToPrompt()`：把对话轴共享白板注入 prompt。
- `appendPrivateStanceToPrompt()`：把当前 AI 自己的私有履历和阶段化重新实例化指令注入 prompt。
- `backendTransition.ts`：定义第一版 C++ 后端到 TypeScript agent 的最小 dispatch 契约、可选 phase/context watermark 和 ID 归一化；兼容旧 full payload，但推荐不再跨进程搬运完整 messages 或当前 AI display name。
- `AtriumAgentReadBridge`：定义 agent 进程只读 materialize 边界，后端只发送本轮定位字段，agent 侧读取 AI 配置、消息窗口、owner/sender 信息、对话轴和当前 AI 私有履历。

## 当前设计判断

Agent 不是新的“聊天 API 调用器”。它应该逐步承接 Atrium 的 AI 成员语义：

- 根据房间/对话上下文决定是否发言。
- 支持合法沉默。
- 支持 thinking adapter 作为思维取向：它偏置注意力、判断权重和表达角度，不是人格、角色或强制发言义务。
- 支持多 AI 在同一轮基于相同历史独立思考。
- Prompt 拼装按 Atrium 五段式：静态层 -> 对话轴共享白板 -> 最近原文消息 -> 当前 AI 私有履历 + 阶段化重新实例化指令 -> 当前触发消息。
- 未来支持工具和显式启用的泛化 memory 材料，但不能把讨论空间变成工具控制台，也不能把当前讨论上下文误叫成普通“记忆功能”。
- 当前主线是 Atrium 双轴 context，不是泛化长期 memory；`MemoryStore` 保留但本期 runtime 不主动注入。
- Agent 的发言顺序必须先判断是否值得参与；如果不值得，合法沉默优先于 adapter 模板；如果值得，adapter 才影响思考角度。
- 发散期的阶段化重新实例化指令使用第三人称评估框架，并只在发散期加入 owner 倾向只是输入、不是裁决的对冲句。
- quoted evidence / delimiter 只能当 prompt guardrail；确定性补救依赖 source anchors 与 stance lineage 的溯源排除。
- 第一版接入边界调整为 agent 允许只读查询、禁止写操作；`AgentRuntime.runTurnDetailed()` 可在 `recordStanceOnReply: false` 下返回 `phaseAtGeneration`、`contextUntilMessageId`、`inputStanceRecordIds`，由后端在 reply 落库成功后 append 私有履历。

## 当前下一步

推荐下一步：

1. 定稿 agent 只读 adapter：AI 配置、消息窗口、owner/sender 信息、对话轴和当前 AI 私有履历读取。
2. 落 agent 进程入口，让 C++ 后端能通过最小 `atrium.agent.turn.v1` dispatch loopback 调用 TS runtime。
3. 设计 provider adapter，让现有 DeepSeek/Qwen 行为能被 `ModelGateway` 包装。
