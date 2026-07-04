# Agent 架构

Agent 核心只回答一个问题：在不可变对话快照上，某个 AI 成员是否应发言，以及应返回普通发言、proposal 还是合法沉默。权限、数据库、WebSocket、广播、确认和删除全部留在后端控制面。

## 分层

### Core

`src/core/` 保存任务、消息、主体类型、成员展示标签、proposal、响应终态等稳定领域类型。内部 ID 使用字符串；bridge 负责边界归一化。权限角色(owner/admin/human_member 等)不属于 agent core。

### Context

`src/context/` 负责：

- 按 `processedUntilBefore / handledUntilMessageId` 切出 trigger messages,并将 retrieved anchors 放入 context 段。
- 读取 confirmed-only `ConversationContextState`。
- 读取 `(conversation_id, current ai_id)` 私有履历并去重、截断。
- 记录 prompt materialization。
- 计算可观测 message exposure + stance lineage purge 计划。

Context 只有 read boundary。测试 ledger 可模拟 append/exclude，但 runtime 不依赖写接口。

### Prompt

`src/prompt/` 严格按五段组织：

```text
1 static prefix
2 confirmed shared whiteboard
3 bounded context messages
4 current AI private evidence + phase re-instantiation
5 trigger messages
```

sender 的 `kind=user/agent/system` 和 display label 由 agent read adapter 从只读数据源解析/构造。`sender.role` 与 owner/admin/human_member 等权限角色不得进入 agent。agent 不通过 id 推导 owner 或权限；prompt 可见署名只使用 display label,不暴露裸内部 id。其他成员消息不能进入当前 AI 的 assistant 续写位。

proposal 正文只作为第(3)或第(5)段中的特殊消息出现一次。独立 pending 索引只属于治理 UI，不进入 prompt。

### Runtime

`src/runtime/AgentRuntime`：

1. 验证任务不可变字段。
2. 读取并验证 confirmed whiteboard 与当前 AI 私有履历。
3. 构造五段 prompt 和 materialization。
4. 生成前检查 phase/context freshness。
5. 调用统一 `ModelGateway`。
6. 规范化 response，并在生成后再次检查 freshness。
7. 返回 response、freshness、materialization 和可选 stance commit intent。

Runtime 不落消息、不 append 履历、不确认 proposal、不写白板。

### Bridge

`src/bridge/` 是唯一业务进程边界：

- 标准化 `atrium.agent.turn.v1` wakeup/result payload。
- 逐字段验证 read materializer 未改写 immutable task。
- 通过 `readMaterialization` 标准化 agent 只读查询得到的 sender kind/display label、proposal source anchors 和 lifecycle tombstone；拒绝 `sender.role`。
- 把 runtime 结果转换成后端可提交 payload。

### Providers

`src/providers/` 把 DeepSeek、Qwen、OpenAI 或本地模型包装为统一 `ModelGateway`。Provider 不决定 Atrium 的 `no_reply`、proposal、phase 或持久化语义。

### Memory 与 Tools

`src/memory/` 是未来泛化 memory 实验区，不属于当前双轴 prompt 主线；P-2 禁止把 RAG/向量召回当作 v1 记忆通道。

当前没有 `src/tools/` 执行注册表或业务动作路径。任何 web/file/外呼/共享状态能力在接入前必须单独完成对抗审计和确定性授权设计；v1 只保留 `ProposalKind.ToolOrResource` 作为申请语义。

## 数据流

```text
backend sends minimal wakeup coordinates
  -> agent read adapter queries read-only data and materializes retained shared messages + confirmed whiteboard
     + current AI private stance projection + display labels
  -> runtime builds context/trigger split and five-segment PromptPlan
  -> ModelGateway returns terminal AgentResponse
  -> runtime returns freshness + exact materialization + optional stance intent
  -> backend rechecks watermark and commits idempotently
  -> visible reply/proposal persists first, stance append second
```

## 信任边界

- 共享消息是不可信输入。
- confirmed whiteboard 是人类确认后的共享状态，但 source anchors 仍可能 stale/purged。
- 私有履历是长期 prompt 源，必须视为可信计算基的一部分并保留 lineage。
- prompt delimiter/quoted evidence 只是概率性 guardrail。
- 权限、确认、purge 与动作授权必须由后端确定性执行。

## 不做

- agent core 不执行 SQL、WebSocket、Reactor 或 provider HTTP。
- agent 不根据 owner/admin id 做权限判断。
- agent 不自动写决策、否决方案、切 phase 或调用工具。
- agent 不读取隐藏 CoT，也不以隐藏 CoT 作为评测信号。
