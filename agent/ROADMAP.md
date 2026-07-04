# Agent 开发路线

## Phase 0: 根目录 TypeScript 结构落地

- 建立 `agent/` 独立工作区。
- 迁出旧 `src/agent` 和 `include/agent`。
- 建立 TypeScript 目录、基础类型、抽象接口和 smoke tests。
- 不接主服务，不改现有行为。

## Phase 1: 最小单轮 runtime

- 用测试夹具构造 `TurnContext`。
- `AgentRuntime` 能组装 `PromptPlan`。
- 用 fake `ModelGateway` 验证 `NoReply`、普通回复、错误三条路径。
- 让 Atrium 双轴上下文进入 prompt：对话轴共享白板 + 当前 AI 私有立场履历。
- 不把泛化长期 `MemoryStore` 接入当前 prompt 主线，也不从 v1 公共入口导出；后续若启用，必须先做记忆投毒/数据生命周期审计，并和用户偏好、房间材料、对话上下文显式区分。

状态：已完成，并扩展为 wakeup/materialization 边界、五段 prompt、私有履历去重、合法沉默、proposal 与 phase freshness。

## Phase 2: C++ 后端过渡接口

- 固定 `src/bridge/backendTransition.ts` 的请求/响应协议。
- 明确 C++ 后端如何触发 TS agent：进程、IPC、HTTP loopback 或后续更合适的方式。
- 统一 snake_case/camelCase 和 ID 字符串归一化。
- 仍然不直接改 C++ 后端运行代码，先形成方案和边界。

状态：TypeScript 协议与 `BACKEND_INTERFACE.md` 已定稿；等待后端实现只读 materialization 与幂等提交。

## Phase 3: 包装现有 provider

- 用 adapter 包住当前 DeepSeek/Qwen 行为。
- 把 provider 差异限制在 `src/providers/`。
- 不让 runtime 认识 SSE、API key 或 provider 专属 JSON。

## Phase 4: Atrium bridge

- 从现有房间、对话、消息、AI 阵容加载 `TurnContext`。
- 把 `AgentResponse` 转为现有落库和广播流程。
- 明确 `<NO_REPLY>`、失败、重试、接力的归属。
- 实现 retained shared history 对新成员不设 join-time cutoff，新 AI 私有履历为空。
- 实现 owner-only provenance purge、prompt quarantine、anchor stale/purged 和 stance exclusion tombstone。

## Phase 5: 工具和显式泛化 memory

- 工具执行路径保持不存在；未来即使先接只读工具，也必须先完成独立 prompt injection、数据外泄和授权边界审计。
- 再评估是否接用户偏好、房间材料或跨会话 memory；必须显式启用,并和 Atrium 讨论上下文 / 房间白板 / AI 立场履历分开命名。
- 所有写操作都必须经过权限和审计边界。

## Phase 6: 调度与观测

- 把 per-conversation/per-agent 串行语义抽象出来。
- 增加 trace id、单轮耗时、provider 状态、工具调用状态。
- 形成 agent 专属测试和回归样例。
- 增加 owner 门禁退化、proposal 校准、多轮 sycophancy、clean/poisoned/purged 与中文/混合语言注入评测。
