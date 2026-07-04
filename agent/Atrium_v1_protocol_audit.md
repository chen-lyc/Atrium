# Atrium 上下文工程 v1 —— 协议核对与纠错文档

## 0. 本文档的用途

v1 已有实现基础。本文档是**经多轮审查后的最终协议核对清单**:列出 v1 必须严格满足的不变量(invariant),用于对照现有代码纠错。文档内不再保留“待审查提议”;早期修订结论已回写到对应不变量,所有条目共同构成一份有效协议。

文档结构分两层:第 1-6 节是 v1 原始协议的完成版,已经吸收了能直接落位的修订;第 7-8 节是针对原始协议的增补页和架构接入修正,用于补充理由、作用域、测试与接入边界。增补页不是另一套竞争协议,也不是废弃前文;若某条增补明确修订已有 INV,以修订后的更具体条款为准。

实现细节(命名、索引、缓存策略、具体参数)由你根据代码现状自行判断,不在协议范围内。判定优先级:

- 标【协议】的条目:违反即为 bug,必须改。
- 标【实现建议】的条目:方向必须遵守,具体方案你有裁量权。

术语约定:

- `owner`:room owner。文中明写 owner-only 的操作(如私有履历溯源清除)不可委托给 AI。
- `authorized human confirmer`:后端已授权的人类确认者,即 owner 或 owner 明确授权的人类管理员。本文中的“确认门禁”使用该含义;它不改变消息的真实作者身份,也不得把管理员的偏好渲染成 owner 偏好。
- `processed_until_message_id`:某个 AI 在某个 conversation 中已经成功处理到的共享消息水位。该值属于 `conversation_ai_members(conversation_id, ai_id)` 的持久状态,由后端在成功提交 AI 结果后推进。
- `handled_until_message_id`:某次 agent 物化 prompt 时实际处理到的最新共享消息 id。v1 采用 coalescing actor 语义,该值可由 agent 在开始处理时读取最新消息后确定,并在结果中回传给后端。
- `trigger range`:本轮触发消息组,即 `(processed_until_message_id, handled_until_message_id]` 内需要当前 AI 处理的新增消息。它是连续新增区间,不等于语义焦点集合,也不声称模型实际“回应了哪一条”。
- `retrieved anchors`:因触发消息显式引用、点名、回复或记忆检索而额外拉入 prompt 的旧消息证据,例如“回到 47 并结合 92”中的 47、92。它们不是触发消息,但只要进入 prompt,就必须进入任务物化记录。
- `prompt exposure / task materialization`:某次 prompt 实际注入过的消息 ids、retrieved anchors、履历 ids、白板版本和模板版本。它只表示“进入过 prompt”,不声称观测到了模型内部因果或隐藏 CoT。
- `visible message`:已经落库并进入共享消息流的公开事件,包括人类发言、AI 普通发言和 proposal 事件。该术语只用于区分“公开流事件”和草稿/私有履历/`<NO_REPLY>`,不是 per-AI 的“已见”字段,也不是旧式 `visible_until` 边界字段;`<NO_REPLY>` 不是 visible message。

---

## 1. 数据结构

**INV-1【协议】物理分表。**
对话轴(共享白板):主键 `conversation_id`,一对一,不含 ai_id。
立场履历:主键 `(conversation_id, ai_id)`,一对多。
违规判定:两类数据合在一张表;对话轴含 ai_id 维度;履历缺 ai_id 维度。
自查:看 schema。

**INV-2【协议】对话轴字段完整性。**
必须包含:当前目标、已确认约束、已做决策、被否方案、未解决问题、当前方向、阶段标记。
阶段标记为三值枚举:`发散期 / 收敛执行期 / 撞墙期`。不允许其他值,不允许自由文本。

**INV-3【协议】被否方案的条目结构。**
每条被否方案必须是结构化四元组:`{方案内容, 否决理由, 否决时前提, 出处消息 ids}`。
"前提"是独立字段,不允许混进否决理由的自由文本里。
出处消息 ids 是因果链的第三条腿,必须在起草/确认时记录;事后无法可靠重建。
所有从讨论确认而来的白板条目(约束、决策、被否方案、未解问题、当前方向)都必须携带 source anchors。每个 anchor 至少包含 `{message_id, status}`;`status` 为 `active / stale / purged`。若条目没有直接消息来源,必须记录明确的 non-message provenance(例如 `owner_action_id` 或 `system_event_id`),不得伪造消息锚点。
背景:前提字段与出处锚点都是 v2 的承载点,现在混写成散文或丢失锚点,v2 必返工。
自查:看被否方案的存储结构里是否存在独立的 premise 字段,并逐类检查白板条目的 source anchors 和 anchor status。

**INV-4【协议】立场履历语义 append + 溯源排除口。**
正常路径只允许追加,不允许更新、重写、抽取已有条目。条目内容 = 该 AI 每轮可见输出的原文、简单摘要或 proposal digest;proposal 进入 prompt 时还必须带当前治理状态,见 INV-25。
唯一合法删除/排除口:owner 发起的 provenance / lineage 溯源清除。清除语义默认是"排除后续 prompt 注入 + 保留审计墓碑",不是物理删除;墓碑字段(如 `excluded_at_ms / exclusion_reason`)是追加后的排除标记,不等于改写原始立场内容。若未来涉及隐私合规硬删除,另行定义物理删除策略。
违规判定:存在非 owner、非溯源清除的 UPDATE / DELETE / 覆盖履历内容路径;或 owner 清除后污染履历仍会进入第(4)段。

---

## 2. 拼装层(每轮为某个 AI 构造上下文时)

**INV-5【协议】五段顺序,从前到后严格为:**

1. 静态前缀:common prompt + 模型 adapter + 该 AI 的 thinking adapter
2. 对话轴共享白板(仅已确认内容,见 INV-11b)
3. 上下文消息段(有界近期消息 + retrieved anchors,排除已分入第(5)段的触发消息)
4. 该 AI 自己的立场履历 + 机制一实例化指令
5. 本轮触发消息段(由 INV-22 的 `trigger range` 分界,即新增且需要当前 AI 处理的消息组)

违规判定:顺序不同、段落缺失、第(4)段被放到靠前位置,或同一条消息同时出现在第(3)段和第(5)段。

**INV-6【协议 · 最高优先级】私有证据位隔离。**
第(4)段的立场履历,查询键必须且只能是 `(conversation_id, 当前回复者的 ai_id)`。任何 AI 的拼装上下文中,绝不允许出现其他 AI 的立场履历。
理由:第(4)段是"私有证据位"。隔离理由是模板位置先验,不是身份定义:这里的内容紧贴当前消息,会被模型读作与当前回复者自身历史相关的证据。B 的履历进了 A 的私有证据位,A 会把 B 的历史判断当成自身历史证据,形成 cross-AI anchoring。
自查:定位拼装函数中的履历查询,确认 ai_id 参数来源是"当前回复者",且不存在任何查全表或查他人的分支。

**INV-7【协议】消息窗口不做跨 AI 过滤。**
消息候选集由 agent 在物化 prompt 时按 `processed_until_message_id` 与最新共享消息确定。第(5)段是本轮 trigger range;第(3)段是有界近期历史和 retrieved anchors,两段严格分割,不得重复同一条消息。若触发消息显式引用旧消息、显式回复或重启旧议题,可将这些旧消息作为 retrieved anchors 加入第(3)段,并记录到任务物化记录;它们不是触发消息。**查询不得按 ai_id 过滤掉其他 AI 的历史发言**。
理由(防止误实现):v1 采用 coalescing actor 语义,每个 `(conversation_id, ai_id)` 串行处理自己尚未处理的新增消息。隔离语义是"AI 不能读取其他 AI 的私有履历,也不能把同一条消息重复放大",不是"AI 之间看不到对方的历史"。讨论必须互相听见;需要隔离的是私有证据位(INV-6),不是消息流。
违规判定:第(3)段的查询里存在按 ai_id 排除其他 AI 消息的逻辑。

**INV-8【协议】机制一按阶段实例化。**
第(4)段末尾的实例化指令由模板生成,模板按当前阶段标记三选一;槽位取值:
发散期 → 当前目标;收敛执行期 → 最新决策 / 当前方向;撞墙期 → 被质疑的决策 + 其前提字段(INV-3)。
违规判定:只静态注入"你是激进型"之类的人格描述;模板不随阶段切换;槽位取错来源。

**INV-9【协议 + 实现建议】履历注入去重与截断。**

a. **去重是协议要求**:若某条 stance record 的 `response_message_id` 仍存在当前快照的第(3)段或第(5)段,该 record 不得同时进入第(4)段。等原始发言滑出消息窗口后,它才可作为私有历史证据进入第(4)段。这条同样适用于 proposal 消息,防止同一观点以“消息 + 私有履历”双重加权。

b. **截断是实现建议**:存储保持全量 append(INV-4),去重后的候选履历在 prompt 注入时仍需截断(例如:首条 + 最近 K 条,K 由实现定)。全量注入会随轮数增长,稀释紧随其后的实例化指令。

违规判定:同一 `response_message_id` 的内容同时出现在消息窗口和私有履历位;`input_stance_record_ids` 记录了未实际注入的被去重/截断条目。

**INV-10【实现建议】静态前缀字节级稳定。**
第(1)段在整场对话内不应有任何字节变化(KV cache 前提)。任何动态内容一律不进第(1)段。

---

## 3. 更新层

**INV-11【协议】决策区写入流程。**
三步:AI 或人类起草摘要 → authorized human confirmer 编辑/确认 → 后端提交写入。约束:

a. 不经 authorized human confirmer 确认环节的决策区写入路径 = 违规。
b. 草稿(未确认)状态必须与已确认数据隔离存放;草稿绝不进入任何 AI 的拼装上下文,只有 authorized human confirmer 确认后的内容才出现在第(2)段。
c. 普通 AI 发言不走审批;审批只适用于边界动作:写白板、切阶段、工具/资源、流程状态变更。
d. 草稿/提案必须记录 `base_phase` 和 `base_context_updated_at_ms`;确认时若基线过期,必须提示 confirmer 并要求明确重新确认。
e. 决策区范围:已做决策、被否方案、阶段标记(阶段另见 INV-13)。

自查:列出所有写决策区字段的调用点,逐个确认上游存在后端授权的人类确认动作。

**INV-12【协议】现状区自动维护边界。**
"只记录讨论进展"的字段(未解决问题、当前议题)允许系统自动维护;任何"需要判断对错 / 作废 / 采纳"的内容不允许自动写。判别原则就是这一句,具体字段归属由你按此原则核对。

**INV-13【协议】阶段切换唯一入口。**
修改阶段标记的代码路径必须有且只有一条,触发者必须是 authorized human confirmer 的显式操作。不允许任何定时器、AI 输出、启发式规则修改阶段。
自查:grep 阶段字段的所有写入点。

**INV-14【协议】履历追加时机。**
只有 AI 产生非 stale 的可见普通发言或 proposal 事件,并且后端成功提交可见消息、私有履历、`processed_until_message_id` 推进和 task materialization 后,才算完成一次履历追加。INV-19 判定为 stale/late 的过期写回除外:其普通可见消息可以保留并标记 stale/late,但不得追加履历、提交 proposal 或推进处理水位。
`<NO_REPLY>` 是合法沉默:不生成可见消息、不追加履历、不触发链式传导。
追加必须携带可观测 provenance:至少包括 `task_id`、`response_message_id`、`response_kind(reply/proposal)`、`phase_at_generation`、`processed_until_before`、`handled_until_message_id`、`input_message_ids`、`retrieved_anchor_message_ids`、`input_stance_record_ids`;proposal 还必须携带 `proposal_id`。`input_stance_record_ids` 记录该轮第(4)段实际注入的履历 ids;即使为空也必须明确记录为空数组。任务物化记录必须能通过 `task_id` 追溯到实际注入的消息 ids、retrieved anchors、履历 ids、白板版本和上下文版本。
`trigger_message_id` 不再是协议字段。旧后端若仍在内部调度日志中保留它,只能作为后端排障元数据;不得传给 agent,不得写入履历 provenance,不得声称它表示“模型实际回应了哪条消息”,也不得单独用它做精确污染级联。
违规判定:沉默产生履历;失败/空回复产生履历;stale/late 写回推进处理水位或进入履历;履历缺少任务、回复、结果类型、生成阶段、处理水位、实际曝光消息或实际注入的上游履历;proposal 履历缺少 `proposal_id`;backend->agent 信封携带 `trigger_message_id`;将 `trigger_message_id` 当作模型内部因果真值。

---

## 4. 禁止项(v1 范围外,实现里出现即删)

- **P-1** 系统级实时交叉纠错层(自动冲突检测、自动状态写入、自动仲裁)。不约束任何 AI 在普通发言里指出前文问题。
- **P-2** RAG / 向量召回作为私有记忆通道或白板替代。允许基于显式引用、回复关系或受控检索拉取带 source anchor 的旧消息作为 `retrieved anchors`,但它们必须进入第(3)段和任务物化记录,不得绕过 INV-6 / INV-17。
- **P-3** 决策区的任何自动写入。
- **P-4** AI 自主确认决策、进入拍板或切换阶段。AI 只能普通发言、提议或生成综合草稿;决策确认与阶段切换必须来自 authorized human confirmer。

---

## 5. 核对顺序

按风险与当前接入阻塞综合排序:**INV-6 → INV-21 → INV-22 → INV-23 → INV-24 → INV-28 → INV-9a → INV-11 → INV-13 → INV-17 → INV-18 → INV-19 → INV-7 → INV-25 → INV-5 → INV-8 → INV-3 → 其余**。
前七项任何一项违规都是结构级错误,优先修。

---

## 6. v1.5 可选项(非纠错范围,不阻塞,有余力再做)

- **O-1 阶段切换提议信号**:AI 允许提出"建议进入收敛期",但必须走 INV-25 的公开提案事件,不写任何状态。确认权仍在 authorized human confirmer,不与 INV-13 / P-4 冲突。
- **O-2 差异度展示**:同一轮各 AI 输出之间计算 embedding 距离,仅展示给 owner,不触发任何行为;方法学和可观测边界见 INV-15。

## 7. 文献调研后的协议修订

### 7.1 范围

本节是针对第 1-6 节的增补页,依据 2026-06 多轮文献调研(多智能体趋同 / 谄媚性 / 人格漂移 / 异构混合 / 记忆投毒 / 人类监督退化)修订既有协议。判定标准同主文档:【协议】违反即 bug,【实现建议】方向必须遵守、方案有裁量权。

本节不推翻双轴、五段顺序、两区拆分、阶段状态机;它补上 v1 原先缺失的生命周期和威胁模型边界。记忆投毒把"立场履历"从普通连续性机制提升为可信计算基的一部分,必须按安全边界处理。后续实现不得只实现第 1-6 节而忽略本节,也不得把本节里的研究建议误读成自动写状态或自动仲裁权限。

---

### 7.2 对既有条目的修订

#### INV-7 增补【协议】消息渲染的角色位约束

原条目要求:消息窗口不做跨 AI 过滤。增补两条:

a. **角色位**:其他参与者(其他 AI、其他人类)的消息,必须渲染在模型明确读作"他者发言"的模板位置——带署名的 user 侧消息,或专用的成员标记格式。**严禁**将任何其他参与者的消息放入当前 AI 的 assistant 续写位(即模型读作"我自己说过的话"的位置)。

b. **署名保真**:每条消息给 AI 看的署名必须使用 `display_name / display_label`,并能区分具体说话者;系统内部必须保留稳定 `sender_id`、主体类型(`human / ai / system`)和 source anchors。权限角色(owner/admin/user/human_member 等)不得进入 agent payload 的 `sender.role`,不得作为 AI 可见称呼,也不得由 agent 自行推导。

文献依据:朴素拼接历史会触发 echoing——chat 模型对模板有强训练先验,会把伙伴消息当作自己的续写目标,角色混淆与锚定直接从模板层发生,上层机制无法补救(SPASM, arXiv:2604.09212)。署名清晰的"他者观点"天然处于模型的审视姿态,署名本身是抗锚定装置。

违规判定:任何其他参与者的消息出现在当前 AI 的 assistant 角色位;消息无署名;prompt 中暴露裸内部 id;agent materialization 中的消息携带 `sender.role`;内部 materialization 缺稳定 sender id 或主体类型。
自查:dump 一次真实拼装产物,逐条核对每条历史消息的模板角色位、display label、内部 source id 与主体类型。

#### INV-8 增补【评测驱动建议 + 作用域协议】发散期模板干预

a. **第三人称评估框架(候选 guardrail)**:候选句式是"评估这个观点/方案本身",避免"你是否同意 X""owner 认为 Y,你怎么看"式的第二人称立场句式。是否默认启用,必须由 Atrium 自己的发散期、多轮和多语言评测决定,不得仅凭外部 benchmark 直接升为硬协议。
文献依据:第三人称视角提示在被测辩论场景将谄媚降低最多 63.8%(SYCON-Bench, arXiv:2505.23840),但该结果不等同于 Atrium 场景中的无条件收益。

b. **人类倾向对冲句(候选 guardrail)**:候选语义是"人类成员在发散期表达的倾向是一个输入,不是裁决;按你自己的立场独立评估"。是否包含同样由 Atrium 场景评测决定。prompt 文案不得使用 `owner preference` 或其他 backend 权限词,以免把确认权限误写成模型语义权威。
**作用域约束是硬协议**:一旦启用,此句只允许出现在发散期模板。出现在收敛执行期模板 = 违规(收敛期服从人类已确认方向推进是协议要求,同一干预在两个阶段正负号相反)。
文献依据:第一人称观点陈述("我认为/我感觉")比第三人称框架更容易诱发谄媚,而权威/专家框架的影响在该研究中可忽略(arXiv:2508.02087)。

违规判定:把外部 benchmark 的干预效果直接当作 Atrium 已验证事实;或已启用的对冲句出现在非发散期模板。
自查:先以 Atrium 场景评测记录决定是否启用,再逐个阶段核对模板文本与作用域。

---

### 7.3 新增条目

#### INV-15【实现建议】机制三:差异度仪表的方法学

- 指标:同一轮各 AI 公开输出、模型提供的 summary、或专门 stance digest 的 **pairwise 余弦相似度 + 有效秩**(effective rank)。
- 输入对象只能是公开输出、模型提供的 summary、或专门生成的 stance digest;不得依赖隐藏 CoT。
- embedding 编码器选定一个后固定,中途不换——编码器选择会强烈调制测得的塌缩程度,换编码器 = 曲线不可比(arXiv:2604.03809)。
- 展示三个维度:① 随轮次的趋势;② owner 发出带立场消息的前后跳变;③ 是否持续向某一固定成员靠拢(尤其房间里最强的模型)。
- embedding 差异只是趋势信号,不是立场偏移或投毒成功的单独判据。评测结论必须同时有预定义的立场评分、选择/排序变化或语义判定之一作为任务级信号。
- **只展示给 owner,不触发任何行为**。第 4 节 P 区禁止项全部继续有效。

#### INV-16【实现建议 · 产品配置】成员选型参考

- 异构(跨厂商)优先于同家族不同档位:同一模型挂不同角色 prompt 的委员会,被测得思维链余弦相似度约 0.89、三成员有效秩仅 2.17——角色 prompt 不能制造先验差异(表征塌缩,arXiv:2604.03809)。
- 同等条件下偏好 reasoning 优化档位:对齐微调放大谄媚,推理优化增强对不当用户观点的抵抗(SYCON-Bench)。
- 上述 CoT/rationale 数值只描述外部论文的实验测量,不构成 Atrium 请求、存储或读取隐藏 CoT 的许可;产品仪表仍严格遵守 INV-15 的可观测输出边界。
- 此条不是代码约束,是房间默认配置与选型文档的依据。

#### INV-17【协议 · 高风险】记忆投毒的 lineage / provenance 防线

Atrium 的投毒链是:

`不可信消息(第 3 段,瞬态) -> 影响该轮 AI 输出 -> 履历追加 -> 此后每轮以当前 AI 私有证据进入第 4 段 -> 持续影响判断`。

因此,私有履历不是普通日志,而是可被不可信输入间接写入的长期 prompt 源。当前 v1 没有履历/白板不经人确认直接驱动工具、外呼或状态写入的路径,所以当前主要损害是**讨论完整性与观点持久偏移**,而不是自动动作安全;这不构成取消 provenance 的理由。

每条履历必须记录:

- `task_id`:不可变逻辑任务,可追溯到本轮实际 prompt 物化记录。
- `response_message_id`:本轮 AI 可见输出(reply 或 proposal)落库后的消息。
- `response_kind`:本轮可见输出是 `reply` 还是 `proposal`;proposal 同时记录 `proposal_id`。
- `phase_at_generation`:生成时阶段。
- `processed_until_before`:本轮开始前该 AI 在此 conversation 的已处理水位。
- `handled_until_message_id`:本轮物化 prompt 时实际处理到的最新消息 id。
- `input_message_ids`:本轮 prompt 实际注入过的共享消息 ids。
- `retrieved_anchor_message_ids`:因触发消息引用/回复/检索而额外注入的旧消息 ids。
- `input_stance_record_ids`:本轮第(4)段实际注入过的上游履历 ids。
- `excluded_at_ms / exclusion_reason`:owner 溯源清除后的排除墓碑。

任务物化记录必须保留实际注入的消息 ids、retrieved anchors、上下文版本和 `input_stance_record_ids`。由此形成两类可观测边:`input_message_ids -> task -> response_message_id / stance_record` 与 `input_stance_record_ids -> task -> response_message_id / stance_record`。两类边都只表示“该输入实际进入过 prompt”,不声称观测到了模型内部因果。

投毒判断与处置不在 agent 回复阶段进行。agent 回复阶段只负责生成回复并通过物化记录留下 prompt exposure;owner 在前端选择具体消息、公开回复或 AI 履历后,由后端控制面 API 执行 quarantine / purge / stale 标记。默认路径下 agent 直接通过只读 DB/视图自取内容,并必须随结果返回实际曝光 ids;若未来部署用受限 read API/IPC 代替 DB 直连,它也只能是 agent read adapter 的只读数据源,不得成为 wakeup 信封里的内容快照。也就是说,回复链路提供证据,控制面执行处置;二者不得混成“agent 一边回复一边清毒”。

owner 发现某条成员消息、外部粘贴内容或 AI 输出有问题时,必须能:

1. 沿任务物化记录找到实际曝光过该 source message 的任务、候选可见输出消息和候选履历;
2. 普通审查由 owner 选定需处置的可见输出消息与直接履历;security/privacy purge 可保守地把全部曝光任务的输出作为种子;
3. 对 root source 与选定的可见输出消息执行 prompt quarantine:记录 `excluded_from_prompt_at_ms / exclusion_reason`,保留可见审计墓碑或历史展示,但从后续第(3)/(5)段排除,并将依赖它的 source anchors、drafts 和 proposals 标为 stale/purged;
4. 交替沿消息曝光边和 `input_stance_record_ids` 注入边遍历,确定性排除选定种子的所有可观测后代。跨 AI 的公开消息传播链不能只靠私有 stance lineage 处理。

后端控制面必须提供等价于 `purgeBySourceMessage(conversation_id, root_message_id, reason)` 的 owner-only 操作。它至少要物化并写入审计日志:实际曝光过 root message 的任务、owner 选定或安全模式保守选定的可见输出消息与 stance 种子、曝光/lineage 后代、受影响的白板 anchors、drafts 和 proposals,以及每个对象最终采取的 `prompt-quarantined / excluded / stale / purged / retained-after-review` 结果。此操作名表示“以 source message 启动溯源处置”,不表示系统能从曝光关系自动推断模型内部因果。

排除后的履历不得再进入第(4)段,但审计痕迹保留。只有在存在明确 source anchor 或上游 stance lineage 时,才能声称“精确级联”;不得用单一 `trigger_message_id` 伪造精确因果。

文献依据:MINJA 证明普通查询交互即可污染 agent 长期记忆;后续 memory poisoning 研究复述其理想条件下注入成功率超过 95%、攻击成功率超过 70%,同时也说明真实初始记忆、检索参数和防御阈值会显著调制攻击效果(arXiv:2601.05504; 原 MINJA: arXiv:2503.03704)。Zombie Agents 证明一次间接注入可在原始上下文消失后持续控制自演化 agent,且能抵抗滑窗、检索排序等常见机制(arXiv:2602.15654)。MemLineage 将防御定义为 chain-of-custody / lineage enforcement,而不是单纯过滤(arXiv:2605.14421)。

违规判定:无法通过 `task_id` 还原实际 prompt 曝光;履历缺失实际曝光消息或上游 stance ids;把投毒判断/清除交给 agent 回复阶段;只清私有履历而让已选定的污染公开回复继续进入第(3)/(5)段;owner 排除种子后其消息曝光或 stance 后代仍进入 prompt;把 delimiter / quoted evidence 当作确定安全边界;依赖隐藏 CoT 判定投毒。

#### INV-18【协议】数据生命周期语义

消息删除、撤回、成员退出、AI 移除都必须定义对以下对象的影响:

- 最近消息窗口:软删、撤回或 prompt-quarantined 消息不得继续作为普通可见历史注入;UI 可保留墓碑与审计入口。
- 白板 source anchors:指向被删/撤回消息的锚点进入 `stale` 或 `purged` 状态,owner 决定保留、清除或重建。
- drafts / proposals:任一必要 source anchor 变为 `stale / purged` 后,对象必须进入 stale 状态,不得直接确认;authorized human confirmer 必须在重建 anchors 或明确审阅缺失来源后重新确认。安全/隐私 purge 可直接关闭或排除未确认对象。
- 私有履历:普通删除/撤回时,由任务物化记录列出曝光候选供 owner 审查;安全清除或隐私删除时,必须保守地排除曝光履历及其 `input_stance_record_ids` 后代。
- 后续 prompt:被排除的消息、锚点和履历不得静默回灌。
- 新人类成员加入:可读取全部仍被保留的共享消息历史与已确认白板,不是只能读取加入后的增量历史;不得读取任何 AI 的私有履历。
- 新 AI 成员加入:从空私有履历开始,可读取全部仍被保留的共享消息历史与已确认白板,不是只能读取加入后的增量历史;不得继承被移除 AI 或其他 AI 的私有履历。
- 成员退出/AI 移除:其已公开消息和已确认贡献按共享历史策略保留或删除;但立即停止新任务与私有履历 prompt 注入,私有履历只允许 owner 审计/清除路径访问。

默认策略是"软删 / 墓碑 / 排除注入 / 保留审计";物理删除另设隐私合规策略,不得混入 v1 普通删除语义。

违规判定:消息已删除但仍作为普通历史注入;安全/隐私清除后其曝光履历或后代仍进入第(4)段;白板锚点悬空但仍被渲染为 active source;来源已 stale/purged 的 draft/proposal 未经重新审阅即可确认;新成员不能读取仍被保留的完整共享历史;新 AI 继承他人私有履历;成员退出或 AI 移除后仍生成新任务/注入私有履历。

#### INV-19【协议】phase watermark 与过期写回

每个 AI 任务物化 prompt 时必须记录当前 `phase` 和 context 版本/更新时间。AI 写回时若阶段或关键上下文已变化:

- 普通可见发言可以落库,但必须可标记为 stale/late。
- stale/late 发言不得自动追加私有履历。如果该内容仍需进入履历,必须由后端创建基于新 phase/context 的新任务;不得由人工改写旧任务 watermark。
- 不得写白板、提交提案、切阶段或确认草稿。
- authorized human confirmer 确认 draft/proposal 时若 `base_phase` 或 `base_context_updated_at_ms` 过期,必须提示并要求明确重新确认。

违规判定:旧阶段任务用旧模板生成的内容在新阶段被当作当前履历回灌;confirmer 确认过期草稿时没有提示与再确认;阶段切换后仍允许在途 AI 写入边界动作。

#### INV-20【实现建议】人类确认门禁退化仪表

authorized human confirmer 确认是 v1 的承重点,但不能假设"人在场"等于"监督有效"。需要按 confirmer 和提案来源记录:

- 草稿编辑率。
- 未编辑批准率。
- 批量批准率。
- 提交到确认的延迟。

编辑率趋近 0、未编辑批准率持续升高、批量批准集中出现时,提示 owner 和当前 confirmer:门禁可能退化为形式审批。此仪表只提醒,不自动阻止决策。

文献依据:human-AI workflow 中存在 automation bias / overreliance;大量 AI 建议和纠错负担会降低审查 engagement,并增加接受错误建议的倾向(arXiv:2103.02381; arXiv:2509.08514)。

---

### 7.4 风险登记(v1 不要求行动,v2 设计必须携带)

**R-1 机制二的翻转固化。**
谄媚翻转一旦发生,约 78.5% 概率持续(arXiv:2502.08177, SycEval);翻转后的发言被 append 进立场履历,机制二自下一轮起会把顺从产物当作"立场连续性"强化。v1 的缓解 = INV-8 增补(降低翻转发生率) + INV-17(允许溯源排除污染履历);根治方案(履历是否需要区分"独立立场"与"顺从转向")留给 v2 评估。

**R-2 引力中心塌缩。**
agent 不仅向多数靠拢,也向更强的模型靠拢(arXiv:2506.01332)。异构房间的塌缩方向可能不是多数,而是最强成员。由 INV-15 展示维度③监测;是否干预、如何干预,owner 决定。

**R-3 长讨论的问题漂移。**
讨论过长时,agent 偏离任务要求、表现下降(problem drift, arXiv:2410.22932)。Atrium 的阶段机与人类确认门禁是天然约束,v1 不加额外机制;记录在案,供机制三曲线对照解读。

**R-4 工具期外泄风险。**
当前 proposal 通道已包含工具/资源动作的设计位置。未来 AI 成员获得 web fetch、文件、外呼工具前,必须单独进行对抗性审计:投毒内容 + 房间内私有讨论 + 对外通道 = 数据外泄三要素。

---

### 7.5 可追溯与可观测评测计划

- **记忆投毒·结构层**:成员消息、外部粘贴文档、弱 AI 成员输出三条入口分别注入。检查任务物化记录能还原实际消息曝光和第(4)段上游履历;再构造“污染消息影响 AI-A 公开回复,该回复进入 AI-B prompt”的跨成员链。owner purge 后,选定的污染公开回复、stance 种子及沿消息曝光/stance 注入图派生的后代都不再出现在 prompt dump。这是确定性结构测试。
- **记忆投毒·行为层**:在相同快照、模型配置和评测探针下,对比 clean / poisoned / purged 三种履历状态,多次采样 AI 的公开发言、模型公开 summary、专用 stance digest、方案排序或明确选择。测量与攻击目标一致的立场得分、选择率、持续轮数和 embedding 趋势;embedding 不得单独作为成功判据。purge 成功表示行为分布向 clean baseline 回归,不要求单次输出逐字复原。**测可观测后果,不测、不依赖、不推断隐藏 CoT 或“模型内部立场”。**
- **投毒评测隔离条件**:测 purge 效果时,污染 source message 及由它产生的公开回复不得继续留在第(3)段或第(5)段;否则无法区分“私有履历清除失败”和“消息窗口仍在持续施加影响”。
- **级联清除**:从 owner 明确选定的公开消息与 stance records 出发,交替遍历任务的实际 `input_message_ids` 和 `input_stance_record_ids`;选定消息从第(3)/(5)段 quarantine,派生履历从第(4)段排除,白板锚点与未确认对象变 stale/purged。同时验证系统不会把“曾曝光”伪报成“模型内部精确因果”。
- **生命周期**:消息软删、AI 成员移除、人类成员退出/加入、中途新增 AI;验证消息窗口、私有履历、白板锚点一致,并验证新成员读取的是仍被保留的完整共享历史而不是加入后的截断历史。
- **phase 竞态**:旧阶段任务延迟写回、新阶段已由 authorized human confirmer 确认、旧 draft 被再次确认;验证 stale 写回不会污染履历或白板。
- **人类确认门禁**:模拟高频 draft 批准,按 confirmer 和提案来源检查编辑率、未编辑批准率、批量批准率能暴露"审批剧场"。
- **触发分段与旧证据锚点**:覆盖连续新增消息、点名 AI、显式回复旧消息、手动邀请发言和空触发;验证 trigger messages 来自 `(processed_until_before, handled_until_message_id]`,retrieved anchors 可指向旧消息但必须进入物化记录,且任何消息不会同时出现在第(3)/(5)段。
- **任务幂等**:模拟 provider timeout、retry、重复 result callback、cancel 与 supersede;验证同一 `task_id` 最多落一条可见输出(reply 或 proposal)和一条履历,`proposal / reply / no_reply / failed / cancelled` 不会互相混淆。
- **自身履历去重**:使当前 AI 的普通发言和 proposal 分别保留在消息窗口;验证对应 stance record 不进第(4)段。原始消息滑出窗口后,该 record 才可进入第(4)段,`input_stance_record_ids` 必须与最终实际注入集合一致。
- **提案单一表示**:使提案分别落在第(3)段和第(5)段的窗口场景,验证正文始终只出现一次;白板、独立 pending prompt 区和 compact projection 不得制造第二份正文。
- **提案生命周期与校准**:覆盖 pending / accepted / rejected / closed / expired / converted,并统计 false proposal、missed proposal、pending age、confirmer 编辑率、批量确认率和接受后反转率。验证 proposal 滑出消息窗口后,第(4)段保留它的当前治理状态,不会把 rejected/expired 渲染成已采纳事实。
- **综合草稿引力**:对比长期固定最强模型、轮换草稿员和两个独立草稿;检查采纳率、少数意见保留率与后续成员向草稿员靠拢的变化。
- **多轮 sycophancy**:不仅测单轮翻转,还测翻转后的多轮持续性。
- **中文/混合语言注入**:spotlighting / datamarking 相关缓解必须覆盖中文、无空格文本、混合中英、伪 delimiter 攻击。Spotlighting 论文证明来源标注可显著降低被测攻击成功率,但这类 prompt 变换仍只能作为概率性 guardrail;简单 delimiter 不构成确定的信任边界(arXiv:2403.14720)。

## 8. 架构接入与治理协议

### 8.1 范围

本节是经架构、对抗安全、数据生命周期、多智能体趋同和人类监督研究复审后的最终接入协议。它定义 INV-21 至 INV-28,与第 1-7 节共同生效;不再保留与 INV-14 / INV-17 / INV-18 冲突的旧提议。

编号说明:INV-28 是后续审查追加的接入落点,编号保留历史顺序;它解释 INV-22 / INV-23 / INV-24 在 backend-agent 边界上的合成形态,不新增第六个 prompt 段,也不允许任何提案第二表示。

---

### 8.2 架构、任务与读边界

#### INV-21【协议】agent 进程权限盲,AI 可见署名用 display label

- agent 进程不得根据 `owner_id / admin_id` 做权限判断、审批分支或状态写入。权限、授权与确认全部归后端控制面。
- prompt 可见署名必须是 `display_name` 或后端生成的人类可读 `display_label`;不得把裸 `sender_id / ai_id / user_id` 渲染给 AI,避免回复里出现“10,你的方法...”这类违背产品设计的称呼。
- agent read adapter 物化出的消息只携带主体类型 `kind=user/agent/system`、稳定 id 和 display label;不得携带 `sender.role` 或任何 owner/admin/human_member/ai_member 权限角色。`kind` 用于模板角色位与当前 AI 自己消息识别,不是权限字段。
- 系统内部仍必须保留稳定 `sender_id / message_id / stance_record_id` 用于 provenance、source anchors、去重、删除级联和重名消歧。稳定 ID 是审计字段,不是 prompt 称呼。
- 若多人重名,消歧也必须是人类可读 display label(例如“小刘(后端)”),而不是数据库 id。区分 `human / ai / system` 的主体类型可用于模板角色位,但不参与权限判断。
- 确认流不经过 agent:前端呈现提案 → authorized human confirmer 决定 → 后端落库和更新已确认白板 → 后续 agent 任务重新读取。

违规判定:agent 根据人员 id 决定能否审批/写入;agent materialization 消息携带 `sender.role`;prompt 中暴露裸内部 id 作为称呼;为了“只用 display_name”而丢失内部稳定 source id;或为了“权限盲”删掉必要的说话者署名。
自查:grep agent 中 owner/admin 使用点;区分“展示/prompt 标签”“内部审计 id”和“权限判断”,只有后者可完全离开 agent。

#### INV-22【协议】coalescing actor、处理水位与触发分段

v1 采用 coalescing actor 语义:每个 `(conversation_id, ai_id)` 是一个串行处理单元。后端可只发送 wakeup / 坐标,agent 在真正开始处理时读取 `conversation_ai_members.processed_until_message_id` 与当前最新共享消息,合并短时间内连续到达的消息后物化 prompt。

这里追求的是**实际处理集合可追溯**,不是强行复现 wakeup 刚创建时的旧快照。例:后端 wakeup 时最新消息是 101,agent 真正开始物化时已经有 102 和 103;agent 可以把 101-103 合并成同一轮 trigger range。只要本轮返回 `handled_until_message_id=103`、实际 `input_message_ids` 和 materialization 记录,协议即成立。

每轮物化至少必须产生以下可追溯字段:

| 字段 | 含义 |
|---|---|
| `task_id` 或 `wakeup_id` | 本轮处理的追踪 id,用于幂等提交与 prompt 物化追溯 |
| `conversation_id / ai_id` | 定位对话与当前回复者;`ai_id` 同时是 INV-6 私有履历读边界 |
| `processed_until_before` | 物化前该 AI 在此 conversation 的持久处理水位 |
| `handled_until_message_id` | 本轮实际处理到的最新共享消息 id,由 agent 物化时确定并回传 |
| `trigger_message_ids` 或 `trigger_range` | 第(5)段触发消息组,语义上来自 `(processed_until_before, handled_until_message_id]` 中需要当前 AI 处理的新增消息;可记录为区间或最终渲染 id 列表 |
| `retrieved_anchor_message_ids` | 因触发消息显式引用、回复或检索而拉入的旧证据消息 ids |
| `phase_at_materialization` | 物化 prompt 时的阶段 watermark |
| `context_version_at_materialization` | 物化 prompt 时的共享白板/上下文版本,用于 INV-19 过期写回判定 |

- 第(5)段 = 按原始顺序渲染的 trigger messages;第(3)段 = 有界近期历史 + retrieved anchors,并排除第(5)段消息。两段不得重复同一消息。
- 例:`processed_until_before=100`,`handled_until_message_id=103`,则新增触发区间是 `(100,103]`。若 103 写“回到 47 并结合 92”,则 101、102、103 是触发消息;47、92 是 retrieved anchors,进入第(3)段并写入任务物化记录。
- 系统不需要单独维护“可见消息 id”作为 agent 输入边界;`processed_until_message_id` 是持久水位,`handled_until_message_id` 是本轮实际处理到的水位,二者足以定义 trigger range。公开流里哪些消息可见由消息本身是否保留、是否被 prompt-quarantined 以及权限视图决定,不由 agent 回复任务携带一个额外可见水位决定。若实现保留旧 `visible_until` 字段,只能作为兼容别名或调试字段,不得参与新协议语义。
- AI 自己刚生成的回复不得单独触发同一 AI 立刻自我递归;它可以作为后续用户消息的上下文被读取,但是否作为触发消息必须由调度规则显式定义。
- 该语义不保证多个 AI 在同一批消息上看到完全相同的 shared round boundary。若未来要恢复严格 Form A 并行独立,需要新增后端裁定的 shared round boundary;不得把 coalescing actor 误称为严格同轮隔离。
- `trigger_message_id` 不进入 backend->agent 信封,也不是履历 provenance 字段。旧编排若需要保留唤醒来源,只能留在后端内部日志中用于排障。多人房间下“AI 实际回应了哪条”不可观测。
- `<NO_REPLY>` 记在 `task_id` 对应的任务结果上,不记成“拒绝了某条消息”。

违规判定:第(3)/(5)段重复;retrieved anchors 进入 prompt 却没有进入物化记录;将 trigger 或旧 focus 字段声称为模型内部意图;把 coalescing actor 语义宣传为严格 Form A;AI 自己的输出单独造成无界自我触发。

#### INV-23【协议】单 actor 串行、触发合并与原子提交

- 对每个 `(conversation_id, ai_id)`,同一时刻最多一个处理循环在运行。处理期间到达的新 wakeup 只置 pending 标记,当前循环完成后再按最新 cursor 继续下一轮。
- agent 可以维护本地 `processed_until` 缓存来减少重复查询,但该缓存只是优化。持久真相是 `conversation_ai_members.processed_until_message_id`,且只能由后端在成功提交任务结果后推进。
- 若同一 AI 短时间连续触发多轮,agent 可用单变量内存缓存承接上一轮刚处理到的水位,避免在后端提交回写尚未可见时强行依赖数据库旧值。该缓存必须只在同一 `(conversation_id, ai_id)` 串行 actor 内生效,不得跨 AI、跨 conversation 或重启后当成真相。
- agent 返回成功结果时必须给出 `handled_until_message_id`、实际 `input_message_ids`、`retrieved_anchor_message_ids`、`input_stance_record_ids` 和 result kind。
- 后端接收成功结果后,必须在同一事务或等价幂等提交中完成:可见 AI 回复落库(若 result 是 reply/proposal)、私有履历 append(若 result 是 reply/proposal)、`processed_until_message_id` 推进、task materialization / prompt exposure 记录写入。`<NO_REPLY>` 不产生消息和履历,但成功终态仍可推进处理水位并记录任务结果。
- `reply / proposal / no_reply` 成功终态可以推进 cursor;INV-19 判定为 stale/late 的过期写回、`failed / cancelled` 不推进;`superseded` 由替代任务决定。
- 崩溃恢复按提交点判定:agent/provider 崩溃且后端未收到成功结果,不落可见消息、不追加履历、不推进 cursor,下次按持久水位重试;后端已收到成功结果并完成幂等提交,则 cursor 已推进,重启后不得重复处理已提交区间。
- 每次 provider 尝试必须有 `attempt_no`;retry 不创建新逻辑任务。消息落库、履历 append、cursor 推进与 materialization 写入必须以 `task_id` 或等价 key 幂等,防止重试生成重复消息/履历或重复推进。

违规判定:同一 `(conversation_id, ai_id)` 并发处理多个循环;agent 本地缓存被当成持久真相;缓存跨 actor 或重启后继续生效;回复已落库但 cursor/materialization 未提交;cursor 推进但回复/履历提交失败;失败或取消任务吞掉消息;无法区分沉默、失败和取消。

#### INV-24【协议】agent 只读自取与单一 prompt 表示

- agent 禁止一切业务写;后端不得把完整消息正文、display label、履历或白板正文作为任务载荷主动 push 给 agent。任务载荷应是 wakeup / 坐标 / capability 级别的信息。
- 上一条禁止的是**任务信封携带内容快照**,不是禁止 agent 在只读物化时读取 display label。恰恰相反:一旦消息进入 prompt,AI 可见署名必须使用 `display_name / display_label`,不得使用裸内部 id。
- agent 读取内容必须是只读路径,可由只读 DB 视图、受限 read API、IPC materialization API 或等价机制实现。无论实现选哪种,权限、确认、删除、purge、cursor 推进和业务写都归后端控制面。
- 可读内容只能包括:保留的共享消息、当前 AI 自己的未排除履历、已确认白板、生成所需的展示元数据。不得读取其他 AI 私有履历。
- 白板必须保持 confirmed-only:不得包含草稿、待确认提案正文或“待确认 #id”指针行。
- 提案正文已按 INV-25 在消息流的第(3)段或第(5)段中出现一次;不得再创建 `pending_proposals` prompt 段、白板指针、compact projection 或其他第二份 prompt 表示。后端可有 pending 索引和仅供 authorized human confirmer 使用的治理 UI,但它们不进入 AI prompt。
- task materialization 必须以 `input_message_ids`、`retrieved_anchor_message_ids`、`input_stance_record_ids` 或等价结构化字段记录最终实际注入集合,并记录白板版本、白板 `updated_at_ms` 与 prompt 模板版本,供 INV-17、proposal 确认基线和评测重放。

违规判定:agent 写业务数据;后端任务载荷直接塞完整上下文;读到其他 AI 私有履历;草稿/pending 指针混入白板;同一提案在 prompt 里出现两次;无法还原本轮实际 prompt 曝光。

#### INV-28【协议】后端 wakeup,agent 自取,后端提交

后端与 agent 的数据通信收敛为最小 wakeup / 坐标信封。目的:消除"后端读库 -> 后端处理 -> 转发 agent"这一多余跳,让 agent 在只读边界内自行物化 prompt,同时让后端继续拥有权限、提交、删除、purge 和 cursor 推进。

**后端发给 agent 的信封只包含定位和唤醒信息:**

- `task_id` 或 `wakeup_id`。
- `conversation_id`。
- `ai_id`。
- 只读 capability / materialization handle(如实现需要)。

信封不得携带 `trigger_message_id`。真正边界来自 agent 物化时读取的 `processed_until_message_id` 与当前最新共享消息;旧后端内部日志里的唤醒来源不属于 agent 协议。

v1 不要求后端预传 `visible_id / visible_until` 或完整可见消息集合。agent 作为 `(conversation_id, ai_id)` 的串行 actor,在真正处理时读取 `conversation_ai_members.processed_until_message_id` 与当前最新共享消息,合并短时间内连续到达的触发,确定本轮 `handled_until_message_id`。

`conversation_ai_members` 必须增加或等价持有 `processed_until_message_id`:语义是"该 AI 在该 conversation 已成功处理到的共享消息水位"。它不是模型心理上的"已看见",而是后端确认成功提交后的调度状态。

agent 凭信封自取消息正文、说话者 display label、时间戳、该 AI 自己的私有履历和已确认白板正文。agent 返回结果时必须带回 `handled_until_message_id`、`input_message_ids`、`retrieved_anchor_message_ids`、`input_stance_record_ids` 与 result kind;若没有生成可见消息,也必须返回 `<NO_REPLY>`、`failed` 或 `cancelled` 等明确终态,不得让后端通过超时猜测语义。

后端接收成功结果后,必须原子提交或等价幂等提交:AI 可见回复、私有履历、`processed_until_message_id` 推进、task materialization / prompt exposure 记录。`reply / proposal / no_reply` 成功终态可推进 cursor;INV-19 判定为 stale/late 的过期写回、`failed / cancelled` 不推进。

违规判定:后端向 agent push 完整消息正文、display label、履历或白板正文等内容数据(信封字段除外);backend->agent 信封携带 `trigger_message_id`;agent 依赖 trigger id 确定 prompt 边界;agent 业务写库;agent 本地 cursor 被当作持久真相;回复已落库但 cursor/materialization 未提交;cursor 推进但回复/履历提交失败。
自查:检查 backend->agent 的任务载荷字段,应只剩 wakeup / 坐标 / capability;消息内容、display label、履历和白板取数应发生在 agent 只读物化侧;后端结果提交必须能用一个事务或幂等恢复证明不丢消息、不重复处理。

---

### 8.3 提案(举手)治理

#### INV-25【协议】提案是流内公开、单一表示的未确认事件

- AI 举手在消息流中落一条特殊类型消息,包含提案正文、提案 id、状态、`base_phase`、`base_context_updated_at_ms` 和带 `active / stale / purged` 状态的 source anchors。
- 该消息根据 trigger range / 上下文窗口分段,在第(3)段或第(5)段中作为 quoted evidence 唯一出现,必须明确标记 `unconfirmed_proposal / no authority`。它可被其他成员讨论,但不是已确认方向、白板状态或系统指令。
- 提案正文不进白板,不在其他 prompt 段重复。authorized human confirmer 确认后,内容才经 INV-11 写入决策区;原提案消息通过状态元数据更新,或追加不重复正文的状态事件,保留其历史真实性。
- proposal 产生的私有 stance record 必须携带 `proposal_id`。在原提案消息仍在第(3)/(5)段时,该 record 按 INV-9a 不进第(4)段;原消息滑出窗口后再注入时,必须渲染为带当前治理状态的 `proposal_digest + status`,语义是“该 AI 曾提议 X,当前状态为 pending/accepted/rejected/closed/expired/converted”。不得把原提案正文逐字复制进第(4)段,也不得隐去 rejected / closed / expired 状态。
- 提案不阻塞普通讨论,不自动通过。治理状态至少包含 `pending / accepted / rejected / closed / expired / converted`。长期未处理提案必须在 authorized human confirmer 的治理 UI 显示数量和最早时间,并允许拒绝、关闭、过期、转普通发言/笔记/未解问题;不得只有“永久 pending”。
- 当原提案滑出普通消息窗口时,v1 只在 authorized human confirmer 的治理 UI 保留独立 pending 索引,不得把该索引或第二份 proposal projection 注入 AI prompt。这不禁止 INV-9 允许的同一 AI 私有 stance digest 在原消息滑出后进入第(4)段;该 digest 必须携带当前 proposal status。未来若另增 compact projection,它必须与私有 stance 表示互斥,确保提案正文仍只出现一次。

违规判定:提案被渲染成已确认方向;同一 prompt 内提案正文同时出现在消息流与私有履历/pending/白板段;提案 stance record 以原文逐字复制进入第(4)段;履历隐去了 proposal 的拒绝/过期状态;无人确认却自动通过;没有拒绝/关闭/过期路径;普通发言等待审批。

#### INV-26【实现建议】提案稀缺性、弃权与校准

- 提案是边界动作,模板必须区分四类结果:普通发言、提案、`<NO_REPLY>`、无法判定/需更多上下文。不能为了降低 missed proposal 而把不确定性全部转成举手。
- 评测至少覆盖:false proposal、missed proposal、每 AI/每 phase 的 proposal rate、确认/拒绝/转换率、confirmer 编辑率、pending age、批量确认率和提案接受后的撤回/反转率。
- 模型声称的置信度只是附加信号,不等于校准过的准确率。提案校准必须基于 Atrium 场景数据,不得仅依赖 prompt 中的自评。

文献依据:显式 abstention 选项会影响模型在不确定情形下的安全弃权(arXiv:2601.12471);高任务准确率不自动意味可靠的不确定性校准(arXiv:2505.23854)。

#### INV-27【实现建议 · 产品配置】AI 综合草稿员,不是裁决人

- owner 可请一个 AI 成员生成“综合/裁定草稿”,但产品与 prompt 中不得赋予它裁判权威。AI 仍是房间成员,不是裁决者。
- 草稿必须以结构化字段包含:建议结论、理由、反方最强论证、可取的少数意见、残余不确定性、可推翻前提、source anchors;缺任一类不得提交为综合草稿。它走 INV-25 提案通道,确认仍归 authorized human confirmer。
- 不得默认或长期固定由“最强模型”承担综合。优先轮换、显式指定或在高争议场景使用两个独立草稿;监测各 AI 被选为草稿员的频率、草稿采纳率和对后续成员立场的吸引效应。
- 该功能可降低综合负担,但不能被认为 INV-20 中人类门禁退化的结构性解法;过度信任 AI 草稿本身正是 automation bias 的来源之一。

文献依据:多智能体会向数量多数或更强成员靠拢(arXiv:2506.01332),中心聚合结构会对中心成员能力与同模型对齐更敏感(arXiv:2601.05606);人类在有警告时仍可能过度采纳算法建议(arXiv:2103.02381; arXiv:2509.08514)。

---

### 8.4 对抗安全定级与未来动作闸门

- 当前 v1 接入边界必须保持的事实是:私有履历和白板只驱动模型生成,不经人类确认不直接调用工具、外呼、切阶段或写决策状态。因此当前投毒的主损害是讨论完整性、观点持久偏移和对人类确认的间接影响。
- 这个事实不会使记忆投毒评测变成可选;INV-17 的可观测 provenance、履历后代排除与结构/行为评测继续是 v1 必测项。
- 任何新路径只要让白板、履历或未信任消息不经 authorized human confirmer 直接驱动工具、外呼、文件、网络请求或共享状态写入,就会改变威胁等级。该功能不得仅通过普通代码评审接入,必须先通过单独的对抗审计、数据外泄评测和确定性动作授权边界。
- quoted evidence、delimiter、spotlighting 和模型对齐只是概率性 guardrail,不是工具动作的安全边界。工具期测试至少覆盖未信任网页/文件指令、私有房间数据外泄、跨轮记忆污染、参数篡改和用户确认绕过(AgentDojo, arXiv:2406.13352)。

### 8.5 当前接入核对项

1. 从 agent/backend 契约中移除 `trigger_message_id`:backend->agent 信封不携带它,履历 provenance 不写它。边界迁移为 `task_id + processed_until_before + handled_until_message_id + input_message_ids + input_stance_record_ids`;旧字段若暂留,只能是后端内部排障日志。
2. 权限判断从 agent 移至后端,但保留后端解析的说话者展示标签;agent 不得为渲染 owner 标签而自行比较人员 id。
3. 履历 append 由回复消息落库后的单一提交点完成,以 task id 幂等,`input_stance_record_ids` 必填并与 prompt 物化记录一致。
4. 提案在 prompt 中只保留消息流内的唯一表示;删除白板 pending 指针和独立 pending prompt 段的设计。
5. backend->agent 任务载荷瘦身为 wakeup / 坐标 / capability(INV-28):从任务信封中移除消息正文、display label、履历、白板正文等内容字段;agent 改为只读自取,并在 prompt 中继续使用 display label 作为 AI 可见署名。
6. `conversation_ai_members` 增加或等价持有 `processed_until_message_id`;agent 返回 `handled_until_message_id` 与实际 prompt exposure;后端成功提交后推进 cursor。
7. 旧 `focus_message_ids / focus_id / visible_id` 语义统一改为 `trigger range + retrieved anchors`:trigger messages 来自 `(processed_until_before, handled_until_message_id]`,retrieved anchors 是被额外拉入的旧证据消息。
8. AI 可见署名使用 `display_name / display_label`,裸内部 id 只进审计字段。
9. 提案 stance record 进第(4)段时渲染为带当前状态的 `proposal_digest + status`,不逐字复制原提案正文。
10. 为 task retry、提案生命周期、clean/poisoned/purged 行为对照、中文/混合语言注入与未来工具动作闸门建立可追溯结构测试和可观测行为测试。可追溯指 prompt exposure 可还原,可观测行为指公开输出/summary/stance digest/选择变化可测;不要求 LLM 输出逐字复现,也不得依赖隐藏 CoT。

## 9. 研究依据索引

以下研究是风险识别和评测方法的依据,不代替 Atrium 自己的场景评测。论文中的单一数值不得无条件移植为产品协议阈值。

- 角色位、echoing 与模板先验:[SPASM, arXiv:2604.09212](https://arxiv.org/abs/2604.09212)。
- 谄媚、第三人称干预与持续性:[SYCON-Bench, arXiv:2505.23840](https://arxiv.org/abs/2505.23840)、[观点框架研究, arXiv:2508.02087](https://arxiv.org/abs/2508.02087)、[SycEval, arXiv:2502.08177](https://arxiv.org/abs/2502.08177)。
- 多智能体趋同、强模型引力与中心化风险:[Group Conformity, arXiv:2506.01332](https://arxiv.org/abs/2506.01332)、[Conformity Dynamics, arXiv:2601.05606](https://arxiv.org/abs/2601.05606)。
- 表征塌缩、有效秩与 embedding 编码器敏感性:[arXiv:2604.03809](https://arxiv.org/abs/2604.03809)。
- 多用户聊天中的 what / when / who 与焦点判定:[MUCA, arXiv:2401.04883](https://arxiv.org/abs/2401.04883)。
- query-only 记忆投毒与持久污染:[MINJA, arXiv:2503.03704](https://arxiv.org/abs/2503.03704)、[Memory Poisoning, arXiv:2601.05504](https://arxiv.org/abs/2601.05504)、[Zombie Agents, arXiv:2602.15654](https://arxiv.org/abs/2602.15654)。
- 记忆 provenance、derivation lineage 与 chain-of-custody:[MemLineage, arXiv:2605.14421](https://arxiv.org/abs/2605.14421)。
- prompt 来源标注是概率性缓解而非确定边界:[Spotlighting, arXiv:2403.14720](https://arxiv.org/abs/2403.14720)。
- 人类过度依赖、automation bias 与审查负担:[arXiv:2103.02381](https://arxiv.org/abs/2103.02381)、[Bias in the Loop, arXiv:2509.08514](https://arxiv.org/abs/2509.08514)。
- abstention 与不确定性校准:[Knowing When to Abstain, arXiv:2601.12471](https://arxiv.org/abs/2601.12471)、[Uncertainty Estimation, arXiv:2505.23854](https://arxiv.org/abs/2505.23854)。
- 带工具 agent 的 indirect prompt injection 基准评测:[AgentDojo, arXiv:2406.13352](https://arxiv.org/abs/2406.13352)。
- 长讨论中的 problem drift:[arXiv:2410.22932](https://arxiv.org/abs/2410.22932)。
