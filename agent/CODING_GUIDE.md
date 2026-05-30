# Agent 编码约定

## 阅读顺序

Agent 任务先读 `agent/READ_ME_FIRST.md`。涉及后端逻辑时，先读根目录 `README.md` 和 `docs/` 里的对应文档，再查源码。不要直接从后端实现细节开始设计 agent。

## 目录落点

- TypeScript 主实现放 `agent/src/<layer>/`。
- 新基础类型放 `src/core/`，不要放到 runtime 文件里顺手定义。
- 单轮流程编排放 `src/runtime/`。
- 上下文窗口、裁剪、消息选择策略和 conversation context 放 `src/context/`。
- prompt 片段、拼装顺序、模板展开放 `src/prompt/`。
- 工具声明和调用协议放 `src/tools/`。
- 模型厂商和 SSE/HTTP 细节放 `src/providers/`。
- 和现有 Atrium 房间、对话、MySQL、WebSocket 交互的边界放 `src/bridge/`。
- `native-cpp/` 只保存迁移参考，不新增业务能力。

## 依赖方向

允许：

```text
bridge -> runtime -> context/prompt/memory/tools/providers -> core
```

禁止：

```text
core/runtime/context/prompt -> C++ sub_reactor/mysql_pool/http_route
providers -> C++ sub_reactor
tools -> WebSocket broadcast
```

如果发现某个文件需要反向 import，通常说明类型放错了层。

## TypeScript 约定

- 内部 ID 一律用字符串。
- 只有 `src/bridge/` 负责从 C++/JSON 的 number/bigint/string 归一化 ID。
- 对外字段在 bridge 边界可以接受 snake_case；进入 core 后使用 camelCase。
- 避免 TypeScript enum，使用 `as const` 对象 + union type，方便 Node 直接 strip types 运行 smoke tests。
- 纯逻辑模块保持无外部依赖，先让测试能用 `node --experimental-strip-types` 跑起来。

## 实现原则

- Agent 子系统必须保持清晰结构和明确框架，因为后续新对话会依赖这些文档和目录快速恢复上下文。
- 新功能先判断归属层：context、prompt、runtime、memory、tools、providers、bridge 或 backend interface。
- 不允许为了快把多层逻辑堆进一个实现文件。
- 小接口先行，等行为稳定后再扩展。
- 复杂 agent 行为必须有文档入口：改 `ARCHITECTURE.md`、`DECISIONS.md` 或新增局部说明。
- 长期方向、用户纠偏、阶段状态分别写入 `PROJECT_NOTEBOOK.md` 和 `CURRENT_AGENT_STATE.md`。
- 开发 agent 时禁止修改现有后端代码；需要后端配合时先写 `BACKEND_INTERFACE.md` 并反馈给用户。
- Agent 开发者只处理 agent 模块。不要顺手做后端架构、后端优化、数据库处理或前端实现。
- 不在 runtime 中硬编码 provider 名称。
- 不在 provider 中硬编码 Atrium 产品语义。
- 不让工具直接写用户可见消息；工具只返回结构化结果，由 runtime/bridge 决定如何呈现。
- 测试优先覆盖纯逻辑层：core、context、prompt、tools、runtime。

## 命名

- 一轮输入叫 `TurnContext`。
- agent 的最终判断叫 `AgentResponse`。
- 发给模型的计划叫 `PromptPlan`。
- provider 统一入口叫 `ModelGateway`。
- Atrium 业务接入点叫 `AtriumAgentBridge`。
- C++/TS 过渡契约放在 `backendTransition.ts`。
