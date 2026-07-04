# Atrium Agent 后端接口要求

## 1. 文档地位

本文只定义 TypeScript agent 与后端控制面的进程边界，不指导 C++、数据库或前端如何实现。协议语义以 `agent/Atrium_v1_protocol_audit.md` 为唯一来源；本文把其中需要后端持久化、暴露为只读数据源、或在提交点承担的部分翻译成接入契约。本文不定义“后端把完整上下文推给 agent”的运行方式。

当前边界：

- agent 只读业务数据，不直接写消息、白板、履历、proposal、成员或阶段状态。
- 后端拥有权限、调度、持久化、确认、删除、purge、cursor 推进和广播。
- 后端发给 agent 的任务载荷只应是 wakeup / 坐标 / capability，不包含消息正文、display label、履历或白板正文。
- agent 在只读物化阶段自行读取当前 AI 需要的内容，生成 `reply / proposal / no_reply / failed / cancelled / superseded`，并返回实际 prompt exposure。
- backend->agent 信封不包含 `trigger_message_id`。旧后端若仍在内部调度日志中保留该字段,它只能作为后端排障元数据,不得传给 agent,也不得参与 prompt 边界、履历 provenance 或投毒级联。

协议版本：`atrium.agent.turn.v1`。

## 2. 最小 wakeup 信封

后端派发给 agent 的信封只包含定位信息：

```json
{
  "protocol": "atrium.agent.turn.v1",
  "ref": {
    "task_id": "task-123",
    "attempt_no": 1,
    "room_id": "7",
    "conversation_id": "42",
    "ai_id": "8"
  }
}
```

要求：

- 同一逻辑任务重试沿用 `task_id`，只递增 `attempt_no`。
- `task_id / room_id / conversation_id / ai_id` 是 wakeup 坐标，不得在同一任务内改写。
- 不要求后端预传 `visible_until / focus_message_ids / phase_at_dispatch / context_version_at_dispatch`。
- `conversation_ai_members(conversation_id, ai_id)` 必须增加或等价持有 `processed_until_message_id`。它表示后端已成功提交该 AI 处理结果后的共享消息水位，不是模型心理上的“已看见”。

## 3. Agent 只读自取通道

agent 凭 wakeup 坐标自取内容。默认实现应是 agent 通过只读 DB 连接 / 只读 DB 视图读取共享消息、成员展示信息、confirmed-only 白板和当前 AI 私有履历。若部署上改用受限 read API 或 IPC materialization API,它也只能是“agent read adapter 的只读数据源”,不得变成 wakeup 信封里的内容快照。无论实现方式如何,业务写、权限、确认、删除、purge 和 cursor 推进都归后端控制面。

只读物化产物是 agent 内部 `TurnContext`,不是后端主动 push 的 run request。物化出的 `turn.task` 必须包含：

当前代码映射:

- `agent/src/bridge/backendTransition.ts`:只处理 backend->agent 最小 wakeup 信封,以及 agent->backend 运行结果 payload。
- `agent/src/bridge/atriumAgentBridge.ts`:调用 agent-side `AtriumAgentReadMaterializer.materializeTurn(ref)`,并验证物化结果没有改写 wakeup 坐标。
- `agent/src/bridge/readMaterialization.ts`:只负责把 agent read materializer 从只读 DB/视图/read source 得到的行式数据归一化成 core 类型;它不是 backend materialization response。

```json
{
  "task_id": "task-123",
  "attempt_no": 1,
  "room_id": "7",
  "conversation_id": "42",
  "agent_id": "8",
  "processed_until_before": "1202",
  "handled_until_message_id": "1205",
  "retrieved_anchor_message_ids": ["47", "92"],
  "phase_at_materialization": "divergence",
  "context_version_at_materialization": "ctx-31",
  "context_updated_at_ms_at_materialization": 1718000000000
}
```

语义：

- 第(5)段 trigger messages 来自 `(processed_until_before, handled_until_message_id]`。
- `retrieved_anchor_message_ids` 是因显式引用、回复关系或受控检索额外拉入的旧消息，例如“回到 47 并结合 92”中的 47、92。它们进入第(3)段，不是触发消息。
- 第(3)段与第(5)段不得重复同一条消息。
- 删除、撤回或 prompt-quarantined 的消息不得进入第(3)/(5)段。
- agent 必须能返回实际注入过的 `input_message_ids / trigger_message_ids / retrieved_anchor_message_ids / input_stance_record_ids`。
- agent 调度器可在同一 `(conversation_id, ai_id)` actor 内维护短期 processed waterline cache，用来避免连续任务在后端 cursor 回写尚未可见时重复处理旧消息。该缓存只修正本进程下一轮 `processed_until_before`，不得跨 actor、跨重启或替代后端持久真相。

## 4. 消息与署名

agent 的只读消息查询必须能从数据库/只读视图解析出每条消息的 sender 元数据：

```json
{
  "id": "1205",
  "sender": {
    "id": "6",
    "kind": "user",
    "display_name": "Lyc"
  },
  "content": "继续检查这个前提",
  "kind": "speech"
}
```

`kind` 只允许 `user / agent / system`,用于选择模板角色位和识别当前 AI 自己的公开消息。`sender.role`、`owner / admin / human_member / ai_member` 等权限或成员角色不得进入 agent materialization；这些只属于后端权限控制面。prompt 可见署名只使用 agent 从只读数据源解析出的 `display_name / display_label`；裸 `sender_id / ai_id / user_id` 只进审计字段，不作为模型可见称呼。

如果同一 prompt 快照内两个不同主体会渲染成相同 label，agent read adapter 必须能读取或构造人类可读消歧后的 `display_label`，例如“小刘(后端)”和“小刘(产品)”。agent 会在模型调用前拒绝未消歧的重复 speaker label；当前 AI 自己的消息会渲染为 `display_label (current AI)`，不需要暴露内部 id。

## 5. Confirmed-only 白板

`ConversationContextReader` 必须由 agent 只读 adapter 从 confirmed-only 白板表/视图读取：

- `conversation_id`
- `context_version`
- `phase`: `divergence / convergence_execution / blocked`
- `summary`
- 结构化 entries
- `last_summarized_message_id`
- `updated_at_ms`

白板条目必须已确认。决策、约束、被否方案、未解问题和当前方向等从讨论产生的条目必须有 source anchors；没有消息来源时使用明确的 `owner_action` 或 `system_event` provenance。draft、未确认 proposal、pending 指针不得进入白板读取结果。

## 6. 私有履历读取投影

读取键必须严格是 `(conversation_id, current ai_id)`。新 AI 成员的私有履历为空；不得继承被移除 AI 或其他 AI 的履历。

每条可注入记录至少包含：

- `record_id`
- `conversation_id / ai_id`
- `task_id`
- `response_message_id`
- `response_kind`: `reply / proposal`
- proposal 时的 `proposal_id`
- proposal 的当前 `proposal_status` 读取投影
- `phase_at_generation`
- `processed_until_before`
- `handled_until_message_id`
- `input_message_ids`
- `retrieved_anchor_message_ids`
- `input_stance_record_ids`
- `content` 或状态化 digest
- `excluded_at_ms / exclusion_reason` 墓碑

proposal stance 滑出消息窗口后可进入第(4)段，但必须带当前治理状态，并渲染为 `proposal_digest + status`。不得把 rejected/expired proposal 渲染为已采纳事实。

## 7. Agent 返回

agent 返回终态、freshness、实际物化集合和可选 stance commit intent：

```json
{
  "protocol": "atrium.agent.turn.v1",
  "task_id": "task-123",
  "attempt_no": 1,
  "response": {
    "decision": "reply",
    "content": "...",
    "error": ""
  },
  "freshness": {
    "stale": false,
    "reasons": []
  },
  "materialization": {
    "processed_until_before": "1202",
    "handled_until_message_id": "1205",
    "input_message_ids": ["47", "92", "1190", "1203", "1204", "1205"],
    "trigger_message_ids": ["1203", "1204", "1205"],
    "retrieved_anchor_message_ids": ["47", "92"],
    "input_stance_record_ids": ["stance-12"],
    "phase_at_generation": "divergence",
    "context_version_at_generation": "ctx-31",
    "context_updated_at_ms_at_generation": 1718000000000,
    "prompt_template_version": "atrium.prompt.v1.2026-06-14"
  },
  "stance_commit": {
    "response_kind": "reply",
    "phase_at_generation": "divergence",
    "processed_until_before": "1202",
    "handled_until_message_id": "1205",
    "input_message_ids": ["47", "92", "1190", "1203", "1204", "1205"],
    "retrieved_anchor_message_ids": ["47", "92"],
    "input_stance_record_ids": ["stance-12"],
    "content": "..."
  }
}
```

`input_message_ids`、`retrieved_anchor_message_ids` 和 `input_stance_record_ids` 只表示实际进入 prompt 的可观测曝光，不能解释为模型内部因果。

## 8. 后端提交状态机

后端提交必须以 `task_id` 或等价唯一键幂等。一个逻辑任务最多产生一条可见 `reply` 或 `proposal` 消息和一条对应履历。

- `reply`:fresh 时可见消息落库后追加履历并推进 `processed_until_message_id`;stale/late 时消息可保留并标记 stale，但不得追加履历或推进 cursor。
- `proposal`:fresh 时落一条特殊 proposal 消息，初始 status 为 `pending`;过期则不得提交 proposal。
- `no_reply`:不落可见消息、不追加履历，但成功终态可推进 `processed_until_message_id` 并记录任务结果。
- `failed / cancelled`:不推进 cursor。
- `superseded`:由替代任务决定是否推进。

## 9. Proposal

proposal 是流内公开、单一表示的未确认事件。proposal 消息包含正文、`proposal_id`、治理状态、`base_phase`、`base_context_updated_at_ms` 和 source anchors。后端可维护治理 UI 所需的 pending 索引，但不得把 pending 索引、proposal 正文副本或白板指针提供给 agent prompt。

proposal response 中还包含：

```json
{
  "decision": "proposal",
  "content": "...",
  "proposal": {
    "kind": "whiteboard",
    "reason": "...",
    "source_message_ids": ["1205"]
  }
}
```

agent 只允许引用本轮实际 `input_message_ids`，且至少一个。后端落 proposal 消息时把这些 ids 转成 active source anchors，并以 materialization 的 phase 与 `context_updated_at_ms_at_generation` 作为确认基线。

## 10. Purge 与生命周期

owner-only `purgeBySourceMessage(conversation_id, root_message_id, reason)` 或等价控制面操作必须使用 task materialization 记录和 stance lineage 做可观测级联。默认语义是排除后续 prompt 注入 + 保留审计墓碑，不是静默物理删除。

成员生命周期：

- 新人类成员可读取全部仍被保留的共享消息历史与已确认白板，不得读取 AI 私有履历。
- 新 AI 成员从空私有履历开始，可读取全部仍被保留的共享消息历史与已确认白板。
- 成员退出或 AI 移除后停止新任务与私有履历 prompt 注入；既有公开消息按共享历史策略处理。

## 11. 人类确认门禁指标

后端治理 UI 与审计日志需要按 confirmer 和提案来源记录以下指标：

- 草稿编辑率。
- 未编辑批准率。
- 批量批准率。
- 提交到确认的延迟。

这些指标只用于提示 owner / authorized human confirmer 门禁可能退化为形式审批，不自动阻止确认。agent runtime 不读取这些指标，也不据此改变 prompt 或输出。

## 12. 验证

agent 侧当前验证命令：

```bash
npm --prefix agent run check
npm --prefix agent test
```
