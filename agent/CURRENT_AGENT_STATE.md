# Agent 当前状态

更新时间：2026-06-16

## 权威边界

- `Atrium_v1_protocol_audit.md` 是 v1 上下文、治理、生命周期和安全语义的唯一协议源。
- `BACKEND_INTERFACE.md` 只描述后端必须持久化/暴露给 agent 只读查询的数据、wakeup 信封和提交语义。
- `Atrium.md` 已删除，不再作为设计源。
- agent 工作区只修改 `agent/`；现有 C++ 后端与前端保持只读。

## 已实现

### Wakeup 与物化任务

- 后端 dispatch 只给 `taskId / attemptNo / roomId / conversationId / agentId` 这类 wakeup 坐标。
- agent 只读物化阶段生成 `processedUntilBefore / handledUntilMessageId / retrievedAnchorMessageIds / phaseAtMaterialization / contextVersionAtMaterialization`。
- 同一 `task_id` 的逻辑字段不可改；同一 attempt 重入直接复用结果，retry 使用新 `attempt_no`。
- bridge 验证只读物化结果没有改写 wakeup 坐标。

### 五段 prompt

1. 静态前缀。
2. confirmed-only 共享白板。
3. 有界上下文消息。
4. 当前 AI 私有证据 + 阶段化实例化指令。
5. trigger messages。

第(5)段来自 `(processedUntilBefore, handledUntilMessageId]`。显式旧证据通过 `retrievedAnchorMessageIds` 进入第(3)段,可越过近期窗口,但不能落在 trigger range 内或超过 `handledUntilMessageId`。第(3)/(5)段严格去重。

### 角色与私有边界

- sender 的 kind 与 display label 由 agent read adapter 从只读数据源解析/构造；权限角色不进入 agent。agent 不比较 owner/admin id,也不把裸内部 id 渲染给模型。
- 其他参与者消息始终进入他者发言位；只有当前 AI 自己的历史公开发言可进入 assistant 位。
- 私有履历只按 `(conversation_id, current ai_id)` 读取；跨 AI 或跨 conversation 读取会失败。
- 新 AI 的私有履历按 `(conversation_id, ai_id)` 查询不到记录即为空；全部 retained shared history 仍可作为消息候选，不按加入时间截断。

### 履历、proposal 与沉默

- `reply` 和 `proposal` fresh 时只返回 stance commit intent，agent 不写业务数据。
- 后端必须在可见消息落库后 append stance，并补齐 `response_message_id`；proposal 还要补齐 `proposal_id`。
- proposal 是消息流内唯一正文表示，不存在 `pending_proposals` prompt 段或白板指针。
- proposal stance 滑出消息窗口后可进入私有证据位，但必须由读 adapter 联接当前 proposal status。
- `no_reply`、失败、取消、supersede 和 stale/late 结果不产生 stance commit。

### Provenance 与生命周期

- task materialization 记录实际 `input_message_ids / trigger_message_ids / retrieved_anchor_message_ids / input_stance_record_ids`、phase、context version/update time 和 prompt template version。
- provenance 模块可沿公开消息曝光边与 stance 注入边构建 owner 审查或保守 security/privacy purge 计划。
- 删除、撤回或 prompt quarantine 的消息不进入 prompt；excluded stance 不进入私有证据位。
- 白板 source anchors 支持 `active / stale / purged`，无消息来源时必须有明确 non-message provenance。

### Phase 竞态

- 生成前快照已过期：任务直接 superseded，不调用 provider。
- 生成后过期的普通 reply 可作为 stale/late 消息返回，但无 stance commit。
- 生成后过期的 proposal 被 superseded，不允许提交边界动作。
- 后端提交点仍必须再次校验 watermark。

### 文献干预边界

- 第三人称发散框架和人类倾向对冲句默认关闭，只能由 Atrium 场景评测决定是否启用；prompt 文案不得把 owner 权限词写成模型语义权威。
- 对冲句即使启用也只允许在 divergence 阶段。
- 投毒与差异度评测只看公开输出、公开 summary、stance digest、选择/排序或预定义立场评分，不依赖隐藏 CoT。
- `src/evaluation/observableEvaluation.ts` 要求 clean/poisoned/purged 在同快照、模型和探针下成组比较，拒绝 embedding-only 结论，并可检查多轮持续性覆盖。

## 仍由后端/产品承担

- 消息、proposal、白板、履历和 task 终态的持久化与幂等提交。
- authorized human confirmer 权限、proposal 生命周期、phase 单一写入口。
- owner-only `purgeBySourceMessage` 的实际事务、墓碑和审计日志。
- 新成员完整共享历史读取、退出/移除后的停止派发与私有履历封存。
- owner 门禁退化仪表、proposal 校准指标、差异度展示和行为评测运行器。
- 未来工具/外呼能力的独立对抗审计。

## 验证命令

```bash
npm --prefix agent run check
npm --prefix agent test
```
