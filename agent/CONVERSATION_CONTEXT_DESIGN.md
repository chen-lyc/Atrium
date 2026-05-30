# Conversation Context Design

状态：Superseded into Atrium double-axis context / implemented in agent core

本文件记录早期 conversation context 设计。当前约束以 `agent/Atrium.md` 为准：Atrium 上下文不是单轴长对话摘要，而是**对话轴共享白板 + 每个 AI 私有主体轴**。

## 目标

Atrium 的 agent 上下文系统不是普通聊天记忆，也不是全局用户偏好记忆。它服务的是一个持续讨论空间：

> 一个 conversation 可以围绕前端布局、产品设计、技术方案等长期推进；讨论中会形成目标、约束、决策、否定方案、开放问题和前提变化。Agent 必须能基于这些历史状态继续判断，而不是只看最近几条消息。

这类能力最初接近 GPT / Claude 的长对话体验；后续 Atrium 校正后，目标升级为：同一个 conversation 内既保持公共事实连续性，又保持每个 AI 各自的判断、担忧和依据连续性。这里的连续性不是人格连续性，也不是要求某个 AI 每轮表演固定标签。

## 选型

早期方案是：

```text
结构化对话状态 + 来源锚点 + 最近原文窗口 + 检索钩子 + 上下文治理层
```

对应行业方案：

- 4：分层结构化上下文是主骨架。
- 5：检索式记忆作为证据召回，不替代常驻上下文。
- 6：上下文治理层负责更新、冲突检测、过期标记和重建。

当前 Atrium 方案保留其中的对话轴部分，但新增主体轴：

```text
ConversationContextState(共享) + AgentStanceHistory(conversation_id, ai_id 私有) + 最近原文窗口 + 阶段化重新实例化指令
```

因此旧方案不再单独作为 prompt 组织依据。

## 为什么不是普通 Memory

通用长期 memory 关注“用户偏好、跨会话事实、全局记忆”。Atrium 当前要解决的是：

- 当前 conversation 的目标是否还一致。
- 已确认的设计 / 技术决策是否仍有效。
- 哪些方案已经被否定，不该反复提出。
- 当前新观点是否和旧约束冲突。
- 做到一半发现早期前提错了时，能回到来源消息重新判断。

因此对话轴核心对象仍叫 `ConversationContextState`，不是普通 `MemoryRecord`。但它只回答“这场讨论公认发生了什么”。每个 AI 在本场的发言履历由 `AgentStanceHistory` 承担。

## 核心结构

每个 conversation 拥有一份持久化状态：

- `conversation_id`
- `phase`：内部阶段，当前值为发散期 / 收敛执行期 / 撞墙期，只能 owner 切换；prompt 解释上应尽量理解为探索 / 形成共同方向 / 复查前提，避免把所有讨论窄化成项目执行流。
- `summary`：对话长期摘要，只描述当前仍有用的背景。
- `entries`：结构化条目。
- `last_summarized_message_id`：摘要覆盖到哪条消息。
- `updated_at_ms`

条目类型：

- `Goal`：当前目标。
- `Constraint`：硬约束或用户明确要求。
- `Decision`：已经确认的决策。
- `RejectedOption`：已否定方案，必须记录方案本身、否决理由、否决时依赖的前提，供撞墙期人工回滚参照。
- `OpenQuestion`：待裁决问题。
- `Risk`：风险、冲突、可能失效的前提。
- `KeyFact`：关键事实。
- `ProgressNote`：阶段推进记录。

条目状态：

- `Active`：当前有效。
- `Superseded`：被后续决策替代。
- `Resolved`：问题已解决。
- `Rejected`：明确废弃。

每个条目可以带 source anchors：

- `message_id`
- `note`

来源锚点是关键：摘要和结构化状态不能成为无来源的“二手真相”。以后发现摘要错了，必须能回到原始 messages 重建。

另有一张物理分开的主体轴：

- 主键：`(conversation_id, ai_id)`。
- 内容：该 AI 在这场 conversation 内自己的发言原文或简单摘要，用作此前判断、担忧和依据的证据。
- 访问边界：A 的履历绝不进入 B 的上下文。
- 语义边界：履历不定义这个 AI 的人格或角色，不要求它为了维持旧角度而发言。

## Prompt 组装

每次 agent 回复时，当前 prompt 顺序为：

1. 静态层：runtime common + 模型/provider 身份 + thinking adapter 静态定义。
2. 对话轴共享白板：目标、约束、决策、带因果的被否方案、开放问题等。
3. 最近原文消息窗口。
4. 当前 AI 的私有立场履历 + 阶段化重新实例化指令。
5. 当前触发消息。

Conversation context state 应优先注入：

- summary
- active goals
- active constraints
- active decisions
- rejected options
- open questions
- risks
- key facts

默认不把 resolved / superseded / rejected 全部塞进 prompt；只有需要审计、冲突检测或用户追问时再检索。`MemoryStore` 本期不主动注入 runtime，避免把泛化长期记忆混入 Atrium 双轴主线。

Thinking adapter 的优先级低于发言判断。AI 先判断这一轮是否值得作为房间成员发言；如果不值得，合法沉默成立；如果值得，adapter 才影响它注意什么、怎样评估、怎样表达。

## 检索钩子

第一版可以不做向量检索，但数据结构必须保留 source anchors 和 `last_summarized_message_id`。

后续触发检索的时机：

- 用户说“之前不是说过……”
- agent 准备提出新决策前。
- 当前观点可能和旧约束冲突。
- 更新 summary 前需要校验原文。
- 用户提醒 agent 忘记了某个早期观点。

## 上下文治理层

后续需要一个 context manager，而不是让 provider 随手改状态。

它负责：

- 何时更新 summary。
- 从新消息中提取目标、约束、风险、开放问题等现状区信息。
- 只在 owner patch 中写入决策、带因果的被否方案、阶段标记。
- 标记旧条目为 superseded / resolved / rejected。
- 检测当前输出是否和 active constraints / decisions 冲突。
- 提醒用户需要重新裁决方向。

第一版不允许 AI 自动写决策区、自动否决、自动切阶段或自动检测前提变化。

## 当前实现边界

第一步只做 agent 内部：

- `ConversationContextState` 数据结构。
- `ConversationContextStore` 抽象。
- `AgentStanceHistoryStore` 抽象和内存实现。
- `appendConversationContextToPrompt()`。
- `appendPrivateStanceToPrompt()`。
- runtime 五段式 prompt 拼装。
- smoke 测试。

不做：

- 后端数据库表修改。
- HTTP API。
- WebSocket 协议。
- 自动摘要生成。
- 自动冲突检测。
- 向量检索。

需要后端持久化时，只在 `BACKEND_INTERFACE.md` 记录表结构和函数需求。
