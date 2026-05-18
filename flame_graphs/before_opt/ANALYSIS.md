# 火焰图性能分析报告（CONC=100，种子数据就位）

> 生成时间: 2026-05-17
> 压测配置: `oha -z 30s -c 100`, HTTP/1.1 over loopback
> 方法: **独占时间（self time）**——父/子函数不重复计算，各类别百分比加总 = 100%
> 限定: on-CPU 火焰图只显示 CPU 上的代码，不显示 I/O 等待。独占时间低 ≠ 等 I/O。

---

## 一、总体排名

| 等级 | API | RPS | p50 | p99 | 成功率 |
|------|-----|-----|-----|-----|--------|
| ⭐⭐⭐ | me | 10,571 | 10ms | 17ms | 100% |
| ⭐⭐ | thinking-adapters | 8,937 | 11ms | 18ms | 100% |
| ⭐⭐ | friends-delete | 3,694 | 27ms | 38ms | 100% |
| ⭐⭐ | invitations-list | 3,249 | 31ms | 41ms | 100% |
| ⭐⭐ | me-ai-usage | 3,127 | 33ms | 44ms | 100% |
| ⭐ | conv-delete | 2,975 | 23ms | 132ms | 100% |
| ⭐ | friend-requests-list | 2,974 | 34ms | 49ms | 100% |
| ⭐ | msg-delete | 2,962 | 21ms | 122ms | 100% |
| ⭐ | friend-requests-respond | 2,946 | 25ms | 120ms | 100% |
| ⭐ | invitations-cancel | 2,933 | 25ms | 125ms | 100% |
| ⭐ | friend-requests-cancel | 2,925 | 21ms | 147ms | 100% |
| ⭐ | room-members-kick | 2,902 | 25ms | 138ms | 100% |
| ⭐ | rooms-delete | 2,859 | 27ms | 112ms | 100% |
| ⭐ | invitations-respond | 2,852 | 22ms | 139ms | 100% |
| ⭐ | me-ai-usage-today | 2,838 | 35ms | 47ms | 100% |
| ⭐ | room-members-role | 2,806 | 25ms | 130ms | 100% |
| ⭐ | ais-list | 2,750 | 37ms | 56ms | 100% |
| ⭐ | search-users | 2,654 | 38ms | 48ms | 100% |
| ⭐ | room-ai-delete | 2,252 | 44ms | 56ms | 100% |
| ⭐ | rooms-list | 2,159 | 46ms | 62ms | 100% |
| ⭐ | rooms-update | 2,058 | 48ms | 63ms | 100% |
| ⭐ | room-ai-update | 2,048 | 49ms | 64ms | 100% |
| ⭐ | room-invitations | 2,016 | 49ms | 65ms | 100% |
| ⭐ | me-update | 2,013 | 49ms | 67ms | 100% |
| ⭐ | room-ai-list | 2,001 | 50ms | 66ms | 100% |
| ⭐ | friends-list | 1,919 | 53ms | 72ms | 100% |
| ⭐ | room-members | 1,875 | 53ms | 66ms | 100% |
| ⭐ | room-ai-create | 1,807 | 46ms | 192ms | 100% |
| ⭐ | friend-requests-create | 1,763 | 53ms | 154ms | 100% |
| ⭐ | conv-model | 1,542 | 65ms | 89ms | 100% |
| ⭐ | conv-ai-list | 1,539 | 65ms | 82ms | 100% |
| ❌ | room-convs | 1,426 | 70ms | 86ms | 100% |
| ❌ | conv-ai-update | 1,169 | 89ms | 177ms | 100% |
| ❌ | conv-ai-create | 1,137 | 88ms | 160ms | 100% |
| ❌ | conv-ai-delete | 1,132 | 88ms | 177ms | 100% |
| ❌ | room-invitations-create | 809 | 129ms | 211ms | 100% |
| ❌ | room-convs-create | 664 | 151ms | 178ms | 100% |
| ❌ | rooms-create | 655 | 153ms | 182ms | 100% |
| ❌ | **conv-messages** | **257** | **394ms** | **458ms** | 100% |
| ❌ | login | 39 | — | — | 100% |
| ❌ | register | 38 | — | — | 100% |
| ❌ | conv-rename | 15 | — | — | **0%** |

> login/register 低 RPS 是 CONC=100 下 bcrypt 占满 CPU 所致（独占时间 Crypto 76%），属于压测设置效应，不代表接口本身性能差。
> conv-rename 0% 需排查权限逻辑。

---

## 二、做得好的地方

### 2.1 Redis 缓存路径依然最快（me: 10,571 RPS）

`me` 走 `Session → Redis 读取用户信息 → 返回`，完全跳过 MySQL。独占时间：String 23.5%、Net 9.0%、JSON 8.2%、Redis 3.9%、Mem 4.5%、**MySQL 0%**。

### 2.2 thinking-adapters 纯内存接口稳定（8,937 RPS）

独占时间 JSON 11.4%、String 23.5%、Net 7.6%。无 DB 依赖。

### 2.3 种子数据使关系类 API 有真实路径覆盖

本次压测通过脚本注册辅助用户、建立好友关系、创建邀请、插入 50 条消息。效果：
- `friend-requests-list`（2,974 RPS）→ 真实查询，非空列表
- `friends-list`（1,919 RPS）→ 有好友数据，独占时间 MySQL 7.5% + JSON 21.5%
- `conv-messages`（257 RPS）→ 返回 50 条消息，暴露了 JSON 序列化瓶颈

---

## 三、需要优化的地方

### 3.1 conv-messages: JSON 序列化 50 条消息（优先度 🔴 高）

**现象**: RPS 257，p50 394ms，p99 458ms。

**火焰图独占时间**:
- JSON: **37.7%** — nlohmann/json 的 `to_json_fn`、`serializer`、`dump()` 构成最深热点。火焰图中能清晰看到 `nlohmann_json_abi`、`std::map`、`Rb_tree` 等 DOM 操作栈。
- String: **27.7%** — JSON 序列化和 MySQL 结果集拷贝中的 string 构造/拷贝
- MySQL: 3.8% — 查询本身 CPU 不高
- 合计 **JSON + String = 65.4%** 花在"把 50 条消息转成 JSON 字符串"

**根因**: 当前路径 `MySQL 结果 → std::vector<std::variant<...>> → 逐条 nlohmann::json → dump() → HTTP buffer`，每一步产生中间对象和内存拷贝。

**优化方向**:
1. 流式写入 HTTP buffer：边遍历结果集边写 JSON，跳过中间 DOM。
2. 换 rapidjson SAX Writer：逐 token 输出，比 nlohmann DOM 快 2-5 倍。
3. 预分配 buffer：已知消息条数，`reserve()` 减少 realloc。

**预期收益**: 理论上限为消除 65% 的 JSON+String 开销 → RPS 约 750（3x）。但 MySQL 查询和网络 I/O 是硬成本，实际预期 **RPS 提升 2-3x（500-750）**。

### 3.2 列表类 API 的 JSON 序列化普遍高（优先度 🟡 中）

| API | RPS | JSON% | String% | 合计 |
|-----|-----|-------|---------|------|
| conv-messages | 257 | 37.7% | 27.7% | 65.4% |
| friends-list | 1,919 | 21.5% | 18.5% | 40.0% |
| rooms-list | 2,159 | 15.9% | 17.4% | 33.3% |
| ais-list | 2,750 | 12.4% | 18.7% | 31.1% |
| thinking-adapters | 8,937 | 11.4% | 23.5% | 34.9% |

rapidjson 替换可将 JSON 开销减半（非完全消除），预期 **列表接口 RPS 提升 15-30%**。改造规模大，可等产品下一阶段统一做。

### 3.3 conv-rename 0% 成功率（优先度 🔴 — 需排查 Bug）

15 RPS，0% 成功率。目标 conversation 11 是 test 用户的个人讨论室主对话。火焰图仅 20 个 sample，无法做有意义的分析。

排查方向：服务端日志中 `handle_rename_conversation` 的错误输出；手动 curl 测试权限。

---

## 四、一个观察：me 接口的时间去哪了

me 是全场最快的接口（10,571 RPS），火焰图独占时间分解：

| 类别 | 占比 | 说明 |
|------|------|------|
| String | 23.5% | JSON dump 的字符串分配/拷贝 |
| KernelLock | **9.0%** | `__lock_text_start` — 内核自旋锁争用 |
| Net | **9.0%** | 内核网络栈（tcp/ip 协议处理） |
| JSON | 8.2% | nlohmann 序列化 |
| Libc | 6.8% | `sdscatfmt`、`_IO_default_xsputn` 等 libc 函数 |
| Mem | 4.5% | malloc/free |
| KernelSched | 4.2% | 内核调度器（`finish_task_switch`） |
| Redis | 3.9% | Redis 客户端调用 |
| HTTP | 1.6% | HTTP 解析和路由 |
| Other | 27.9% | 大量 <1% 的小函数（syscalls、pthread、timer 等） |

> **不是"std::function 调度和 HTTP 路由"占 43%**——实际是内核锁争用（9%）、libc 开销（7%）、内核调度（4%）和大量零散小函数。框架本身的 HTTP 路由只有 1.6%。

---

## 五、优化优先级

| 优先级 | 项目 | 预期收益 | 复杂度 | 依据 |
|--------|------|---------|--------|------|
| 🔴 P1 | conv-messages JSON 序列化优化 | RPS 提升 2-3x | 中 | JSON 37.7% + String 27.7% = 65% 独占时间 |
| 🟡 P2 | 全局 JSON 换 rapidjson | 列表接口 RPS +15-30% | 中 | 5 个列表 API 的 JSON+String 合计 31-65% |
| 🔴 — | conv-rename 0% 排查 | Bug fix | 低 | 看日志 |

---

## 六、附录：独占时间分类数据

| API | MySQL | JSON | String | Crypto | Net | Mem | Reactor | Other |
|-----|-------|------|--------|--------|-----|-----|---------|-------|
| me | — | 8.2% | 23.5% | 0.4% | 9.0% | 4.5% | 0.6% | 49.9% |
| thinking-adapters | — | 11.4% | 23.5% | 0.3% | 7.6% | 5.0% | 2.8% | 44.2% |
| **conv-messages** | 3.8% | **37.7%** | **27.7%** | 2.4% | 1.8% | 3.3% | 0.2% | 22.4% |
| friends-list | 7.5% | 21.5% | 18.5% | 7.5% | 6.1% | 5.0% | 1.2% | 30.8% |
| rooms-list | 6.9% | 15.9% | 17.4% | 9.6% | 8.0% | 4.5% | 1.3% | 34.2% |
| rooms-create | 13.6% | 3.6% | 8.2% | 16.2% | 16.0% | 4.7% | 1.7% | 34.4% |
| login | — | — | 0.1% | **76.1%** | 0.1% | 13.1% | — | 10.5% |
| register | 0.2% | — | — | **76.6%** | 0.2% | 12.3% | — | 10.7% |

> - **独占时间（self time）** = 函数总采样 - 子函数采样之和。父/子不重复。
> - `—` = < 0.05%。
> - **me 的 Other 49.9%** 含 KernelLock 9.0%、Libc 6.8%、KernelSched 4.2%、大量 <1% 的零散函数。非单一瓶颈。
