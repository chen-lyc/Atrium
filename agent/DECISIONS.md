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

后续判断：agent 主实现切到 TypeScript 后，公共边界不再用 C++ header 承载。旧 C++ 骨架参考已在 TypeScript 分层稳定后移除。

## ADR-0008: agent 成为根目录 TypeScript 子项目

状态：Accepted

原因：用户明确要求 agent 将转 TypeScript，且和前端开发一样是长期大项目，不是玩具或 demo。Agent 继续留在后端 `src/` / `include/` 会让语言边界、构建边界和责任边界继续混在一起。

影响：

- 根目录 `agent/` 是唯一 agent 工作区。
- TypeScript 主源码放 `agent/src/`。
- 旧 C++ 骨架不再保留为参考入口。
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
- `MemoryStore` 仅保留为 legacy/experimental 材料，不作为当前 Atrium 上下文主线，也不从 v1 公共入口导出；未来若启用，必须先完成独立记忆投毒与数据生命周期审计。
- Prompt 必须按五段式拼装：静态层 -> confirmed-only 对话轴共享白板 -> 有界上下文消息 + retrieved anchors -> 当前 AI 私有履历 + 阶段化重新实例化指令 -> trigger messages。
- Owner-only 字段：已做决策、当前方向、带因果的被否方案、阶段标记不能由 AI 自动写入。狭义决策区仍是已做决策、被否方案、阶段标记；当前方向按“需要采纳判断”单独 owner-confirmed。

## ADR-0011: Agent runtime 采用业务只读边界

状态：Accepted

原因：消息、白板、proposal、履历和 phase 的权限与事务属于后端控制面。让 runtime 持有写接口会绕过 authorized human confirmer，并使重试和 stale 写回难以统一。

影响：runtime 只依赖 `ConversationContextReader` 与 `AgentStanceHistoryReader`，返回 materialization 和 stance commit intent；后端在消息落库后幂等提交。

## ADR-0012: 用处理水位和 retrieved anchors 替代 trigger 因果

状态：Accepted

原因：多人快照中无法观测模型“实际回应哪条消息”。单一 `trigger_message_id` 既不能表达处理区间，也不能支持可靠 lineage。

影响：后端 dispatch 只发 wakeup 坐标；agent 只读物化 `processed_until_before + handled_until_message_id + retrieved_anchor_message_ids + phase/context watermark`。`trigger_message_id` 不进入 backend->agent 信封；旧系统若保留唤醒来源,只作后端内部排障日志。第(5)段来自处理水位区间，第(3)段可包含 retrieved anchors，两段严格去重。

## ADR-0013: Proposal 是流内公开事件且正文只有一个 prompt 表示

状态：Accepted

原因：proposal 需要可讨论、可追踪，但未确认内容不能进入白板。消息流与独立 pending prompt 同时保留正文会重复锚定。

影响：proposal 作为特殊消息进入第(3)或第(5)段；pending 索引只属于治理 UI。滑出消息窗口后，可由同一 AI 的 stance 投影承载历史观点，但必须带当前 proposal status。

## ADR-0014: Sender 主体类型由 agent read adapter 解析，Agent 不接收权限角色

状态：Accepted

原因：agent 需要知道消息来自 `user / agent / system`,以保证模板角色位保真；但不需要也不应该知道 `owner / admin / human_member / ai_member` 这类权限或成员角色。把权限角色放进 agent materialization 会让展示语义与授权语义重新耦合,并把 owner 权威性泄露给模型。

影响：agent read adapter 从只读数据源为每条消息物化 `kind + display label + stable sender id`。`sender.role` 不进入 agent materialization；若旧读取路径仍带该字段,agent 拒绝物化。prompt 可见署名使用 display label,内部 id 只进审计字段。

## ADR-0015: 新成员拥有完整 retained shared history，AI 私有履历不继承

状态：Accepted

原因：共享讨论历史属于房间上下文，按加入时间截断会让新成员系统性缺失共同事实；私有履历则是特定 AI 的证据位，继承会制造身份与判断混淆。

影响：新人类和新 AI 均可读取全部仍保留的共享历史与 confirmed whiteboard；新 AI 从空私有履历开始。
