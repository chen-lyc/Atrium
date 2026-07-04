# Conversation Context Design

状态：Superseded

本文件只保留设计演进说明。当前可执行协议以 `agent/Atrium_v1_protocol_audit.md` 为准，当前代码状态看 `agent/CURRENT_AGENT_STATE.md`，后端接入看 `agent/BACKEND_INTERFACE.md`。

## 设计演进

早期方案把 Atrium 当作“结构化 conversation summary + 最近消息 + 检索钩子”。复审后确认这不足以表达多人、多 AI 的独立判断，因此 v1 改为双轴：

```text
ConversationContextState(conversation_id, confirmed shared whiteboard)
+ AgentStanceHistory(conversation_id, ai_id, private evidence)
+ bounded shared messages
+ phase-specific re-instantiation
```

随后对抗与生命周期审计又补上：

- 私有履历是长期 prompt 源，必须有 task materialization 与 lineage。
- 删除/撤回默认使用排除注入 + 审计墓碑。
- proposal 是消息流内唯一正文表示，不进入独立 pending prompt 段。
- `trigger_message_id` 不是可观测因果,也不进入 backend->agent 信封；当前边界使用 `task_id + processed_until_before + handled_until_message_id + retrieved_anchor_message_ids`。
- agent 只读业务数据，后端负责确认、提交、purge 和权限。
- sender 的 display label 与主体类型 kind 由 agent read adapter 从只读数据源显式解析/构造；权限角色不进入 agent。agent 不比较人员 id,也不把裸内部 id 渲染给模型。
- 新成员可读取全部 retained shared history；新 AI 私有履历从空开始。

## 当前五段式

```text
1. static prefix
2. confirmed shared whiteboard
3. bounded context messages
4. current AI private evidence + phase re-instantiation
5. trigger messages
```

第(5)段来自 `(processed_until_before, handled_until_message_id]`;retrieved anchors 是被触发消息额外拉回的旧证据,进入第(3)段。第(3)/(5)段严格去重。第(4)段只读取当前 AI 的未排除履历；原公开消息仍在第(3)/(5)段时，对应 stance 不重复注入。

## 已废弃概念

- 单轴 conversation memory。
- 可写 `ConversationContextStore` / `AgentStanceHistoryStore` runtime 接口。
- “当前触发消息”作为固定第(5)段和精确因果。
- `visible_until / focus_message_ids` 作为后端预切 prompt 边界。
- agent 侧 context manager 自动冲突检测、自动仲裁或自动决策写入。
- RAG/向量召回作为 v1 记忆通道。
- proposal 的白板 pending 指针或独立 `pending_proposals` prompt 区。

这些概念若在历史 notebook、commit 或讨论中出现，只表示当时的探索，不得覆盖当前协议。
