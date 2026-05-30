# Agent 决策记录

## ADR-0001: agent 子系统最初先放在 `src/agent`

状态：Superseded by ADR-0008

原因：当时现有 AI 逻辑横跨 provider、reactor、调度、数据库和 WebSocket。`src/agent` 先作为独立目录，可以快速稳定 agent 自己的语言和边界。

后续判断：用户明确要求 agent 将转 TypeScript，并像前端一样作为长期大项目维护。因此 agent 不应继续放在后端 `src/` / `include/`。

## ADR-0002: 第一版骨架不改变线上行为

状态：Accepted

原因：agent 是新系统，不应该在边界未清楚时改动现有聊天、AI 回复、广播和落库路径。

影响：本目录的初始代码只做类型、抽象和 smoke tests，不修改后端 `Makefile`、`SubReactor`、`AiClient` 或数据库 schema。

## ADR-0003: runtime 不认识 Atrium 传输层

状态：Accepted

原因：runtime 要表达 agent 的单轮决策，不应该知道消息是从 WebSocket、HTTP、测试夹具还是未来后台任务进来的。

影响：WebSocket frame、ConnRoute、MySQL 查询和 Redis session 都只能出现在 `bridge/` 或更外层。

## ADR-0004: provider 通过 `ModelGateway` 接入

状态：Accepted

原因：DeepSeek、Qwen 等 provider 的 HTTP/SSE 差异应该被包装掉。agent runtime 只需要看到统一的请求和响应语义。

影响：后续迁移现有 `AiClient` 时，优先写 adapter 包住它，不急着重写 provider 逻辑。

## ADR-0005: agent 开发默认文档优先

状态：Accepted

原因：后端已有 README、设计笔记、架构文档、实时协议和 API 参考。Agent 是新子系统，不能靠临时啃后端实现来推结构，否则很容易把已有运行路径、产品语义和新 agent 边界搅在一起。

影响：每次 agent 开发先读 `agent/READ_ME_FIRST.md`，再读项目 README 和相关 `docs/`。源码用于验证当前真实行为或接入点，不作为第一阅读入口。

## ADR-0006: agent 开发期间现有后端代码只读

状态：Accepted

原因：Agent 是新部分，当前任务目标是先把独立结构、文档、边界和框架立起来。过早修改现有后端运行代码，会把 agent 设计和当前 Reactor / AI 回复链路耦合在一起，后续很难拆清。

影响：开发 agent 时禁止修改现有后端代码。需要后端接入时，先写清接入方案和被影响边界，等用户明确解除禁令后再改后端运行代码。

## ADR-0007: 公共头文件曾放入 `include/agent`

状态：Superseded by ADR-0008

原因：在 C++ 骨架阶段，仓库已有 `include/` 作为公共头文件根目录，`include/agent` 能区分公共接口和内部实现。

后续判断：agent 主实现切到 TypeScript 后，公共边界不再用 C++ header 承载。迁移前头文件已收进 `agent/native-cpp/include/agent`，只作为参考。

## ADR-0008: agent 成为根目录 TypeScript 子项目

状态：Accepted

原因：用户明确要求 agent 将转 TypeScript，且和前端开发一样是长期大项目，不是玩具或 demo。Agent 继续留在后端 `src/` / `include/` 会让语言边界、构建边界和责任边界继续混在一起。

影响：

- 根目录 `agent/` 是唯一 agent 工作区。
- TypeScript 主源码放 `agent/src/`。
- 旧 C++ 骨架收进 `agent/native-cpp/` 作为迁移参考。
- 后端转接契约放 `agent/src/bridge/`。
- 后端 `src/` / `include/` 不再新增 agent 专属代码。

## ADR-0009: TypeScript 内部 ID 使用字符串

状态：Accepted

原因：C++/MySQL 使用 `uint64_t` / `BIGINT UNSIGNED`，而 TypeScript number 只有 53-bit 安全整数范围。Agent 是长期项目，不能在 core 层默认引入 ID 精度隐患。

影响：`src/core` 中的 `AgentId`、`ConversationId`、`MessageId`、`RoomId`、`UserId` 都是 string。`src/bridge/backendTransition.ts` 负责从 number/bigint/string 归一化。

## ADR-0010: Atrium 上下文工程采用双轴而不是泛化 Memory

状态：Accepted

原因：Atrium 不是单 agent 长对话，而是多人多 AI 的思维碰撞场。通用 conversation state 只能表达“这场讨论公认发生了什么”，不能表达“这个 AI 在本场讨论中自己坚持过什么”。如果多个 AI 共享同一份履历或互相读取对方履历，会产生 cross-AI anchoring，破坏独立思考。

影响：

- `ConversationContextState` 只承载对话轴共享白板，按 `conversation_id` 读取。
- `AgentStanceHistory` 承载主体轴私有履历，按 `(conversation_id, ai_id)` 读取。
- `MemoryStore` 保留为未来泛化长期记忆材料，但不作为当前 Atrium 上下文主线。
- Prompt 必须按五段式拼装：静态层 -> 对话轴共享白板 -> 最近原文消息 -> 当前 AI 私有履历 + 阶段化重新实例化指令 -> 当前触发消息。
- 决策区 owner-only：已做决策、带因果的被否方案、阶段标记不能由 AI 自动写入。
