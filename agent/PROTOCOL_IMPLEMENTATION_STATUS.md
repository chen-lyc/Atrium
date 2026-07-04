# Atrium v1 协议实现覆盖矩阵

更新时间：2026-06-16

状态说明：

- `Agent enforced`：TypeScript runtime/bridge 已确定性执行。
- `Agent modeled`：agent 已提供类型、校验或纯逻辑，但最终事务由后端执行。
- `Backend required`：属于权限、持久化、调度或产品控制面，agent 不得实现。
- `Evaluation/config`：实现建议或产品配置，不是 runtime 自动行为。

| INV | 状态 | 当前证据与剩余责任 |
|---|---|---|
| 1 物理分表 | Agent modeled + Backend required | confirmed context 与 private stance 使用独立类型/readers；后端 schema 必须按 `conversation_id` 与 `(conversation_id, ai_id)` 分离。 |
| 2 对话轴字段 | Agent enforced + Backend required | `ConversationContextEntryKind` 覆盖目标、约束、决策、被否方案、未解问题、当前方向，phase 为三值枚举；后端必须完整物化。 |
| 3 被否方案与 anchors | Agent enforced | validator 要求 option/reason/premise 分字段、每条白板 entry 有 message anchor 或 `owner_action / system_event` provenance，message anchor 有 active/stale/purged，未知 provenance type 会失败。 |
| 4 append + owner purge | Agent modeled + Backend required | runtime 无 stance 写接口；测试 ledger 只 append/exclude；owner-only 鉴权、墓碑事务和审计日志由后端实现。 |
| 5 五段顺序 | Agent enforced | `PromptPlan` 固定 1..5 且拒绝逆序；runtime 总是按五段拼装。 |
| 6 私有证据隔离 | Agent enforced | 只调用 `load(conversationId, current agent.id)`，返回其他 AI/conversation 数据时失败。 |
| 7 共享消息与角色位 | Agent enforced | 不按 AI 过滤消息；显式 sender kind + display label，其他成员始终 user/他者位；bridge 拒绝 `sender.role`。 |
| 8 phase 实例化 | Agent enforced | divergence/convergence_execution/blocked 分别从目标、决策/方向、被质疑方案/前提生成指令。 |
| 9 stance 去重与截断 | Agent enforced | 当前第(3)/(5)段已有 `response_message_id` 时不注入 stance；实际 ids 写 materialization；默认首条 + 最近 K。 |
| 10 静态前缀稳定 | Agent enforced | 静态模板与版本常量集中在 `agentIdentityPrompt.ts`；动态白板、消息、stance 不进第(1)段。 |
| 11 决策区确认 | Agent modeled + Backend required | agent 只能产出 proposal；confirmed-only reader 不接受 draft 通道。人类确认、基线复核和写白板事务由后端。 |
| 12 现状区自动维护边界 | Backend required | agent 不提供自动冲突、采纳、否决或决策写入；后端只能自动维护无判断性的进展字段。 |
| 13 phase 单一入口 | Backend required | agent 无 phase 写接口；后端必须只有 authorized human confirmer 的显式写路径。 |
| 14 stance 追加时机 | Agent enforced + Backend required | 仅 fresh reply/proposal 返回 commit intent；no_reply/failed/cancelled/superseded/stale 无 intent。后端须先落可见消息再幂等 append。 |
| 15 差异度方法 | Agent modeled + Evaluation/config | `observableEvaluation.ts` 只接受公开输出/summary/stance digest，并拒绝 embedding-only 投毒结论；指标运行与 owner-only 展示由产品评测层实现。 |
| 16 成员选型 | Evaluation/config | 不进入 runtime 行为；房间默认配置优先异构与实测，不把外部 CoT 数据当产品许可。 |
| 17 记忆投毒 lineage | Agent modeled + Backend required | materialization 记录 message/stance 曝光；`buildProvenancePurgePlan` 遍历消息与 stance 边。实际 quarantine/exclusion/stale/purged 事务归后端。 |
| 18 数据生命周期 | Agent enforced + Backend required | runtime 排除 deleted/withdrawn/quarantined 消息与 excluded stance；后端负责 anchor/draft/proposal 状态、新成员完整共享历史、退出/移除停止派发。 |
| 19 phase watermark | Agent enforced + Backend required | 生成前 stale 直接 superseded；生成后 stale reply 无 stance、stale proposal superseded。提交点仍须后端复核。 |
| 20 人类门禁退化 | Backend required | `BACKEND_INTERFACE.md` 固定编辑率、未编辑批准率、批量批准率与确认延迟；只告警，不自动阻止。 |
| 21 权限盲/角色位保真 | Agent enforced | agent read adapter 只物化 sender kind/display label/stable id；agent 不接收 owner/admin/member role，也不接收 owner id 推导权限；prompt 不暴露裸内部 id 作为称呼；不同主体同名时 agent 拒绝未消歧 label。 |
| 22 coalescing actor 与触发分段 | Agent enforced | `processedUntilBefore / handledUntilMessageId` 切 trigger range；retrieved anchors 可越过近期窗口但不进入第(5)段；第(3)/(5)段互斥均有测试。 |
| 23 单 actor 与幂等 | Agent enforced + Backend required | runtime 冻结 materialized task fingerprint、缓存同 attempt；read materializer 可选同 actor processed waterline cache 防止短时重复处理；retry 可增加 attempt。最终消息/stance/cursor 唯一提交由后端唯一键保证。 |
| 24 只读与单一表示 | Agent enforced | runtime 只有 readers；白板 confirmed-only；无 pending proposal prompt；materialization 可重放实际曝光。 |
| 25 流内 proposal | Agent enforced + Backend required | proposal 特殊消息唯一渲染且标记 no authority/current status/source anchors；完整治理状态与确认事务由后端。 |
| 26 稀缺性与校准 | Agent modeled + Evaluation/config | response 区分 reply/proposal/no_reply/needs-context；false/missed proposal、pending age 等由评测与治理层统计。 |
| 27 综合草稿员 | Agent enforced + Evaluation/config | synthesis proposal 必须结构化包含结论、理由、最强反方、少数意见、不确定性、可推翻前提与 source ids；轮换/双草稿策略由产品配置。 |
| 28 wakeup / 自取 / 后端提交 | Agent enforced + Backend required | bridge dispatch 只接 wakeup 坐标；agent read adapter 自取并物化 processed/handled/retrieved/context watermark；后端仍负责 cursor 推进和原子提交。 |

## 禁止项检查

| 禁止项 | 当前状态 |
|---|---|
| P-1 自动冲突检测/仲裁/状态写入 | runtime 未实现；AI 普通发言仍可指出问题。 |
| P-2 RAG/向量召回作为 v1 记忆 | `MemoryStore` 未进入 runtime prompt，也不从 v1 公共入口导出。 |
| P-3 决策区自动写入 | agent 无业务写接口。 |
| P-4 AI 自主确认、切 phase 或执行工具动作 | 只有 proposal 类型，无确认/phase mutation/工具执行注册表。 |

## 当前测试覆盖

- 五段顺序、trigger range、retrieved anchors、非法旧锚点失败。
- display label 可见署名、同名 speaker 未消歧失败、`sender.role` 输入失败、跨 AI stance 读取失败。
- stance 去重/截断、proposal 当前 status、proposal 正文单一表示。
- no_reply、空 reply、非法 source anchors、fresh/stale reply/proposal。
- task 不可变、同 attempt 幂等、retry attempt、read materializer wakeup 坐标防篡改、同 actor 本地 processed waterline cache。
- source anchor validation、non-message provenance type validation、被否方案四元组、confirmed-only prompt。
- message exposure + stance lineage 的普通审查和保守 purge。
- synthesis draft 结构完整性。
- clean/poisoned/purged 成组可观测评测、embedding-only 判据拒绝和多轮覆盖校验。

## 接入阻塞项

Agent 侧协议代码已具备，但完整产品验收仍阻塞于后端实现：

1. task/result 幂等持久化和 stale 提交复核。
2. confirmed whiteboard、private stance current-status projection。
3. proposal 生命周期、确认基线和 authorized human confirmer 审计。
4. owner-only purge 事务、quarantine、墓碑和 anchor/draft/proposal 级联。
5. 新成员全部 retained shared history 读取与移除成员停止派发。
6. 门禁退化、proposal 校准、差异度与投毒行为评测运行器。
