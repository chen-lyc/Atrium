# Agent 子系统

这是 Atrium agent 能力的独立 TypeScript 工作区。它和 `static/` 前端一样按长期项目维护，不再放在后端 `src/` / `include/` 里，也不进入当前 C++ 服务编译链。

当前阶段目标不是做一个 demo，而是先把 agent 的领域语言、运行边界、后端过渡接口和测试入口稳定下来。

## 先读

每次进入 agent 开发，先读 [READ_ME_FIRST.md](READ_ME_FIRST.md)，再按需读 [CURRENT_AGENT_STATE.md](CURRENT_AGENT_STATE.md)、[PROJECT_NOTEBOOK.md](PROJECT_NOTEBOOK.md) 和 [CONVERSATION_CONTEXT_DESIGN.md](CONVERSATION_CONTEXT_DESIGN.md)。

默认顺序是先读项目 README 和 `docs/` 下的后端/协议/设计文档，再按需查源码验证。不要一上来直接从后端实现里推 agent 结构。

## 目录

| 路径 | 责任 |
|---|---|
| `src/core/` | agent 基础领域类型：身份、消息、turn、响应、状态 |
| `src/runtime/` | 单轮 agent 执行流程 |
| `src/context/` | 上下文窗口、conversation context 状态和治理 |
| `src/prompt/` | prompt 片段、消息角色顺序、上下文注入 |
| `src/memory/` | 未来泛化 memory 抽象和 agent 内部内存实现，不直接绑定 MySQL/Redis；不是当前 Atrium 双轴上下文主线 |
| `src/tools/` | 工具注册、工具调用和结果归一化 |
| `src/providers/` | 模型网关接口，后续包装 DeepSeek/Qwen/OpenAI 等 provider |
| `src/bridge/` | C++ 后端与 TS agent 的过渡契约和 Atrium 业务桥接接口 |
| `tests/` | agent 纯逻辑 smoke tests |

## 当前边界

- 不修改现有 C++ AI 回复链路。
- 不修改 `SubReactor`、`AiClient`、`ConvAiScheduler`、数据库 schema 或主 `Makefile`。
- Agent 内部 ID 使用字符串，`src/bridge/` 负责把 C++/JSON 里的数字 ID 归一化，避免 TypeScript 的 53-bit number 精度风险。
- `runtime/` 不直接认识 MySQL、Redis、WebSocket、Reactor 或 provider HTTP 细节。
- 需要后端配合时，先写到 [BACKEND_INTERFACE.md](BACKEND_INTERFACE.md)，由后端侧实现转接。

## 开发命令

当前不要求安装依赖也能跑 smoke tests：

```bash
npm --prefix agent test
```

安装 `agent/package.json` 的 devDependencies 后可运行类型检查：

```bash
npm --prefix agent run check
```

## 开发顺序

1. 先判断新能力属于 `core`、`context`、`prompt`、`memory`、`tools`、`providers`、`runtime` 还是 `bridge`。
2. 再补充最小接口或类型，优先让边界清楚。
3. 最后由 `bridge/` 把 agent 输入输出接回现有 Atrium 消息、调度、广播系统。
