# Agent Project Notebook

这份笔记记录 agent 子系统的长期方向、用户纠偏和架构判断。它不是快捷入口；新会话先读 `READ_ME_FIRST.md` 和 `CURRENT_AGENT_STATE.md`。

## 2026-05-29 - 子系统启动

用户要求开始开发项目 agent 部分，目录设为 `src/agent`。重点不是马上写功能，而是先建立熟悉、清晰、可长期维护的结构和框架。

用户特别指出：agent 开发不同于前端。前端乱了还能重构，agent 如果一开始堆在一起，后面可能直接乱掉。因此第一阶段要先创建框架、Markdown 文档、结构和边界。

后续用户再次强调：agent 开发一定要结构清晰、框架分明，不然每次新对话开始都会很乱。这是 agent 子系统长期开发原则，不是一次性代码风格建议。

初始结构判断：

- `core/` 放稳定领域类型。
- `runtime/` 编排单轮 agent 执行。
- `context/` 管上下文窗口和裁剪。
- `prompt/` 管 prompt 片段和请求计划。
- `memory/` 管记忆抽象。
- `tools/` 管工具注册和调用协议。
- `providers/` 管模型网关。
- `bridge/` 是唯一认识 Atrium 房间、对话、数据库、WebSocket 的层。

## 2026-05-29 - 文档优先纠偏

用户提醒：后端逻辑已经有 README 和相应文档，agent 开发也应像前端一样设置项目文档、记忆、笔记。

这条纠偏很重要：后续 agent 开发不能默认直接啃后端代码。正确顺序是先读：

- `README.md`
- `docs/DESIGN_NOTES.md`
- `docs/BACKEND_ARCHITECTURE.md`
- `docs/REALTIME_PROTOCOL.md`
- 需要 API 时再读 `docs/API_REFERENCE.md`

然后才按需查源码验证当前实现。

这个规则已经写入 `agent/READ_ME_FIRST.md`。后续如果新会话直接进入 agent 任务，应先走这个入口。

## 2026-05-29 - Agent 开发禁止动后端代码

用户补充一条铁律：和前端开发一样，开发 agent 的时候禁止动后端代码。

落实为当前工作边界：

- 可以继续改 `agent/`。
- TypeScript 主实现放在 `agent/src/`。
- 不改现有后端运行文件，例如 `src/sub_reactor.cpp`、`src/ai_client.cpp`、`src/connection_route.cpp`、`include/sub_reactor.h`、`include/ai_client.h`、`include/connection_route.h`、数据库 schema、protobuf、Makefile 服务编译链等。
- 如果某个 agent 方案需要后端接入，先写设计和接入边界，不能默认直接修改后端实现。
- 用户再次强调：agent 开发时，Codex 就只是 agent 开发者；后端属于后端开发，前端属于前端开发。需要 API 接口函数时要告诉用户，而不是自己去改。

## 2026-05-29 - 公共头文件迁入 include/agent

用户提出是否把头文件拆到 `include/agent`，并明确要求不要盲目迎合。

判断后采纳：当前 agent 头文件都是公共边界类型或接口，不是私有实现细节。放在 `include/agent` 更符合本仓库已有 `include/` 公共头文件结构，也能让未来 bridge 接入时使用稳定 include 路径。

执行边界：

- 只移动 agent 头文件到 `include/agent/<layer>/`。
- `.cpp`、文档、测试入口继续留在 `src/agent`。
- Include 统一为 `agent/<layer>/<file>.h`。
- 这不解除“禁止修改现有后端代码”的铁律。

后续状态：这条已被 TypeScript 迁移取代。旧 C++ 骨架参考已移除，当前 agent 只保留 TypeScript 实现入口。

## 2026-05-29 - Agent 记忆模块第一版

用户要求先完成 agent 的记忆功能，并强调任何后端接口需求都要反馈，不要自己改后端。

第一版实现边界：

- 只实现 agent 内部记忆抽象和内存实现。
- `MemoryStore` 提供 `search / upsert / forget / loadForTurn`。
- `InMemoryMemoryStore` 支持作用域、类型、标签、权重、pinned 和简单关键词相关性。
- `AgentRuntime` 会把相关记忆注入 prompt。
- 后端持久化、数据库表、HTTP API、WebSocket 同步全部不实现，只写到 `BACKEND_INTERFACE.md`。

后续状态：这条路线已被 Atrium 双轴上下文纠偏取代。`MemoryStore` / `InMemoryMemoryStore`
作为未来泛化 memory 材料保留，但当前 Atrium 主线不应对外叫“记忆功能”，也不应把
`MemoryStore` 注入 prompt。当前进入 prompt 的是讨论上下文 / 房间白板 / 当前 AI 私有立场履历。

## 2026-05-29 - Backend interface 文档抽象度纠偏

用户指出上一版 `BACKEND_INTERFACE.md` 不符合预期：只写 search/upsert/forget 能力太抽象。后端交接应该明确说明是否需要数据库、建议表结构、需要哪些函数、函数签名大概是什么、函数作用是什么，以及后端如何调用 agent 接口取得和注入记忆。

客观判断：这是 Codex 给得不好，不是用户缺能力。生产环境里的跨模块交接不能停在抽象能力名，至少要给到表结构草案、字段含义、索引方向、函数签名、调用时机和不做事项。用户需要培养的是识别抽象交接不够落地的能力，但这次主要问题在交付质量。

## 2026-05-29 - Agent 记忆需求与工作方式纠偏

用户指出这次 agent 记忆开发不符合预期：Codex 没有先理解需求和沟通方案，就按自己的通用架构开始实现。这是工作方式错误。

后续 agent 开发要沿用之前前端设计开发的协作方式：

- 用户是项目指挥者，方向和需求由用户提出。
- Codex 可以设计、质疑、反驳、补充方案，但必须主动交流，不能在需求没对齐时自己开始实现。
- 工程实现如果有多个选择，Codex 应先说明方案、利弊、边界和推荐，再由用户判断。
- Agent 开发时只做 agent，不跨到后端或前端；需要后端接口时写清需求并反馈，不自己修改后端。

当前真实需求不是泛化长期记忆系统，而是：

> 实现类似 GPT / Claude 的“单个对话内上下文保持一致”：在同一个对话里，无论聊多久，AI 都能持续记住前文上下文；服务重启后也不影响这个对话上下文的恢复。

这和“用户长期偏好记忆 / 全局记忆 / 跨房间记忆 / 自动沉淀长期知识”不是同一个问题。前面已经写出的 `MemoryStore` / `InMemoryMemoryStore` 可以作为底层材料保留，但不能替代这个需求，也不能默认把需求扩展成长记忆系统。

下一步不应继续写代码，而应先和用户讨论工程路径。候选方向至少包括：

- 全量历史回放：每次从数据库取当前 conversation 的所有消息组成上下文。优点是语义最直接；缺点是 token 成本和上下文窗口会很快爆炸。
- 最近窗口：只取最近 N 条消息。优点是实现简单、成本可控；缺点是长对话会遗忘早期关键信息，不满足“怎么聊都记得”。
- 对话摘要 + 最近窗口：长期部分做滚动摘要，短期部分保留最近消息。优点最接近 GPT/Claude 的实际工程形态；缺点是摘要质量、何时更新、如何纠错需要设计。
- 分层上下文：系统 prompt + 对话长期摘要 + 关键事实/决策 + 最近消息。优点是可控、可恢复、适合长对话；缺点是需要更明确的数据结构和更新策略。

需要先确认：

1. “单个对话”是否对应现有 `conversations.id`。
2. 上下文恢复是只恢复给 AI 的 prompt，还是用户也能看到摘要/记忆。
3. 是否允许 agent 自动生成对话摘要，还是必须保留原文历史作为唯一依据。
4. 服务重启后的恢复由后端持久化提供，还是 agent 只定义接口和数据结构。
5. 当摘要写错时，是否需要可回滚、可重建或可人工纠正。

## 2026-05-29 - Atrium conversation context 总体设计

用户确认：这是上下文系统的总体设计，必须先记入 agent 文档，避免上下文不够时新对话不知道怎么设计。记入之后再一步步实现。

最终方向不是只选“4 分层结构化上下文”，而是 Atrium 版本的：

```text
结构化对话状态 + 来源锚点 + 最近原文窗口 + 检索钩子 + 上下文治理层
```

含义：

- 4 是主骨架：conversation state 常驻 prompt，保存目标、约束、决策、当前方向、否定方案、开放问题、风险、关键事实和进展。
- 5 是证据召回：不是替代记忆，而是在冲突、用户提醒、更新摘要、做新决策前检索原始历史。
- 6 是上下文治理：后续由 context manager 决定何时更新摘要、标记旧决策过期、检测冲突、提醒用户重新裁决。

这符合 Atrium 的本质：一个 conversation 是持续讨论空间，可以专门讨论前端布局、设计方向、学习、创作或开放探索。Agent 的核心不是“记住用户喜欢什么”，而是让讨论持续有方向、有历史、有连续性，并且能基于早期观点质疑当前观点。

当前已新增 `CONVERSATION_CONTEXT_DESIGN.md` 作为长期设计源。第一步实现只做 agent 内部：`ConversationContextState`、`ConversationContextStore`、`appendConversationContextToPrompt()` 和 runtime prompt 注入。后端持久化、自动摘要、检索和上下文治理后续逐步做。

## 2026-05-29 - Agent 迁出后端目录并转 TypeScript

用户明确要求：agent 将转 TypeScript，且像前端开发一样是长期大项目，不是玩具或 demo。Agent 部分要直接从后端 `src/` 和 `include/` 移出，在根目录单独文件夹实现；过渡接口由 agent 开发者合理安排。

本次判断：

- 根目录 `agent/` 成为唯一 agent 工作区。
- `agent/src/` 是 TypeScript 主线。
- `agent/src/bridge/` 承担 C++ 后端与 TS agent 的过渡契约。
- 旧 C++ 骨架不再保留为迁移参考。
- 后端 `src/` / `include/` 不再新增 agent 专属代码。
- TypeScript 内部 ID 使用字符串，避免 C++ `uint64_t` / MySQL `BIGINT UNSIGNED` 进入 JS number 后产生精度风险。

## 2026-05-29 - Atrium 双轴上下文工程落地

用户纠正：通用 `conversation_state + recall + governance` 只解决“这场对话发生了什么”，不能表达 Atrium 多 AI 思维碰撞的核心。新的约束写入 `agent/Atrium.md`，并已落到 TypeScript agent 内部。

当前实现判断：

- 对话轴仍由 `ConversationContextState` 承担，但新增 `phase`，取值为发散期、收敛执行期、撞墙期。
- 被否方案从单点字符串升级为 `RejectedOptionRecord`，记录方案本身、否决理由和否决时依赖前提。
- Owner-only 字段：决策、当前方向、被否方案、阶段标记只能通过 `ConversationContextPatchAuthor.Owner` 写；system patch 不能写这些。当前方向不归入狭义决策区，但按“需要采纳判断”处理。
- 主体轴新增 `AgentStanceHistoryStore`，主键语义为 `(conversation_id, ai_id)`，第一版只 append 当前 AI 的发言原文或简单摘要。
- Runtime prompt 改为 Atrium 五段式：静态层 -> 对话轴共享白板 -> 最近原文消息 -> 当前 AI 私有履历 + 阶段化重新实例化指令 -> 当前触发消息。
- Runtime 在 AI 回复后把该回复 append 到该 AI 自己的私有履历；A 的履历不会进入 B 的 prompt。
- `MemoryStore` 保留为未来泛化长期记忆材料，但本期 runtime 不主动注入，避免重新走回单 agent 长记忆方案。

这次改造的目的不是最轻松地补字段，而是把 Atrium 的产品特色落实为结构边界：共享白板保证大家面对同一场讨论，私有履历保证多 AI 不互相锚定成同一个声音，阶段化重新实例化指令让 thinking adapter 在当轮成为具体思维动作，而不是静态角色标签。

## 2026-05-30 - Thinking adapter 是高认知倾向，不是强制角色行为

用户提出一个 agent 开发的核心追问：现实中高认知的人确实有稳定思维取向，例如有人更大胆、有人更全面、有人更容易注意到情绪或风险。但他们不是每次别人说话都强迫自己“必须提出一个全新观点”“必须找一个反例”“必须照顾一个情绪点”。真实的思维取向更像长期形成的注意力偏置、判断权重、习惯和情境触发模式，而不是每轮显式执行的标签任务。

因此后续 agent 设计必须把 thinking adapter 理解为认知倾向：

- 它可以在 system prompt 层设定初始认知方向，因为 LLM 需要稳定的处理方法。
- 它不能变成强制行为、角色扮演或发言义务。
- 它应该偏置 AI 更容易注意什么、怎样评估证据、在决定发言后怎样表达。
- 它不能覆盖“这一轮是否值得发言”的上游判断；不值得发言时，合法沉默优先。
- 立场履历保存的是该 AI 在本场讨论中的判断、担忧、依据和连续性，不是身份连续性或人格表演。

未来 agent 开发前必须先问：我们是在建模一个高认知成员，让稳定倾向通过注意力、判断、情境和发言阈值自然出现；还是不小心做成了一个低认知角色表演器，每轮机械满足 adapter 标签？

## 已稳定判断

- Agent core 不能直接依赖后端传输层和存储层。
- Runtime 不认识 MySQL、Redis、WebSocket、Reactor。
- Provider 不决定 Atrium 产品语义。
- Bridge 是现有后端和新 agent core 之间的缓冲层，过渡契约统一放在 `agent/src/bridge/`。
- 初期不接主服务，不改现有行为。
- Agent 开发期间现有后端代码只读，除非用户在同一任务里明确解除禁令。
