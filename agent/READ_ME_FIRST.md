# Agent Read First

每次进入 agent 子系统开发前，先读本文件。这里是启动路由，不保存全部细节。

## 先读项目文档，再看代码

Agent 开发默认阅读顺序：

1. 根目录 `README.md`：确认 Atrium 是什么、后端主链路和文档导航。
2. `docs/DESIGN_NOTES.md`：确认 AI 成员、可沉默、thinking adapter、多 AI 独立思考等产品判断。
3. `docs/BACKEND_ARCHITECTURE.md`：确认 Reactor、AI 调度、广播、落库、provider 调用在现有系统里的位置。
4. `docs/REALTIME_PROTOCOL.md`：确认 WebSocket 消息、AI 流事件、`<NO_REPLY>` 当前协议。
5. `docs/API_REFERENCE.md`：只有涉及 HTTP API、AI 阵容、用量、房间/对话接口时再读。
6. `agent/Atrium.md`：涉及上下文工程、AI 独立思考、阶段状态或 prompt 拼装时必须读；它优先于早期通用 conversation context 设计。
7. `agent/CURRENT_AGENT_STATE.md`：确认 agent 子系统当前状态。
8. `agent/PROJECT_NOTEBOOK.md`：需要理解长期方向或历史决定时再读。
9. 只有在上述文档不足、需要验证当前实现、或准备接入具体边界时，才查后端源码。

代码是验证源，不是第一阅读入口。若文档和代码冲突，先记录冲突，再用当前源码确认真实行为，最后更新 agent 文档或提出文档需要修正。

## 当前工作边界

- Agent 实现、文档和测试入口放在根目录 `agent/`。
- TypeScript 主源码放在 `agent/src/`。
- 旧 C++ 骨架已移除；TypeScript 是 agent 的唯一实现入口。
- Agent 开发必须结构清晰、框架分明。新能力先判断归属层，再写代码。
- 初期不改后端 `Makefile`，不接主服务，不改变现有聊天行为。
- 铁律：开发 agent 时禁止修改现有后端代码。
- Agent 开发者只处理 agent；不要跨到后端架构、后端优化、数据库处理或前端实现。
- 现有后端代码包括但不限于非 agent 的 `src/*.cpp`、`include/*.h`、数据库 schema、`message.proto`、后端 `Makefile` 服务编译链，以及 `docs/` 中描述当前后端契约的文档。
- 如果 agent 需要接入后端，先写到 `agent/BACKEND_INTERFACE.md`，再反馈给用户和后端开发。不要自己进入后端改动。
- 新能力先落文档和边界，再落实现。

## 开发节奏

1. 先判断新需求属于哪一层：core、runtime、context、prompt、memory、tools、providers、bridge。
2. 需要产品判断时，先更新 `PROJECT_NOTEBOOK.md` 或 `CURRENT_AGENT_STATE.md`。
3. 需要实现时，保持代码只落在对应层，不跨层顺手写。
4. 需要接后端时，通过 `agent/src/bridge` 定义过渡契约，不要让 runtime 直接认识 MySQL、WebSocket 或 Reactor。

## 必须保留的 Atrium 语义

- AI 是房间成员，不是悬浮工具。
- AI 可以合法沉默，`<NO_REPLY>` 不产生用户可见消息、不追加私有履历、不触发链式传导。
- 多 AI 同一轮应独立思考，不能被本轮其他 AI 输出锚定。
- 上下文工程是双轴：对话轴是共享白板，主体轴是 `(conversation_id, ai_id)` 私有立场履历。
- 决策区只能 owner 写；AI 不自动采纳、否决、切阶段或填写否决前提。
- 主对话承载人和人的普通交流，不应默认惊动 AI。
- Thinking adapter 是思维取向，不是角色扮演身份。
- Thinking adapter 是高认知倾向，不是强制发言模板：先判断是否值得发言；不值得时合法沉默；值得时 adapter 才影响注意力、判断权重和表达角度。
- 私有立场履历是此前判断、担忧和依据的证据，不是人格锚点，不能要求 AI 维持某种表演人设。
- 私有立场履历是私有证据位，不是身份位；隔离理由是模板位置先验。履历必须携带 provenance，并支持 owner 溯源排除污染来源。
