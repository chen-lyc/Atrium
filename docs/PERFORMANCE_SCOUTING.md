# 性能侦察

这份文档记录 Atrium 后端的压测方法、火焰图侦察过程和据此做出的优化判断——包括一次判断错误又纠正的过程。它不是全量数据报告。42 接口的完整 RPS 表、火焰图 SVG 和 Level 2 分析见 [`../flame/after_opt/report.md`](../flame/after_opt/report.md)。

---

## 一、压测方法

**工具**：HTTP 压测用 oha（统一 `-z 30s` 按时长压），CPU 火焰图用 perf 采样 + Brendan Gregg 的 FlameGraph 生成脚本。固定一套工具，不同时间点、不同接口的数据才能比。

**三种环境**，数字不同质：

- **本机回环**：客户端和服务端同一台机器，无网络往返。测的是服务端处理能力上限。
- **腾讯云 2 vCPU / 2 GB**：Atrium 实际部署配置。
- **公网**：中国大陆访问香港服务器。混入跨境 RTT、丢包和带宽限制，不是纯后端能力。

同一个接口在三种环境下的数字可能差一个数量级——看任何 QPS 数字前，先问是哪种环境。

**口径**：

- 同一张对比表只比较同一条件下的一项变量。并发数、数据状态、版本功能差异不混在一起。
- 没有同条件基线的结果只作为单点记录，不强行写成"提升多少倍"。
- 需要区分 Release、ASan、火焰图采样中、干净数据库、已有历史数据、回环/公网等条件。
- 旧数据来自项目迭代记录。若用于正式简历或评审，应补齐机器规格、内核版本、数据库状态和命令原文。

**火焰图怎么读**：横轴是 CPU 占用比例（越宽吃 CPU 越多），纵轴是调用栈深度。看的是"高原"——某个函数占用很宽的一条——而不是孤立的高峰。还要结合延迟分布：窄峰说明请求在某处排队，长尾说明偶发抖动。

一个前提，它直接关系到第二节的那次误判：**火焰图给出的是相对占比，这个占比强依赖于压测环境是否干净**。如果数据库有脏数据、或编译用了带插桩开销的 build（如 ASan），函数相对占比会被扭曲。火焰图上的百分比不能脱离 baseline 条件解读。

## 二、一次判断错了：messages 接口的 "JSON 主瓶颈" 误判

这一节单独拎出来，因为它是后面所有优化判断的前提——如果连这次踩坑都没意识到，后面的火焰图分析全都不可信。

**当时的判断**：压测 `/api/conversations/:id/messages` 时 QPS 很低，火焰图上 JSON 序列化相关的栈占了约 70%。据此写下了结论——messages 接口的主瓶颈是 nlohmann JSON 序列化，决定暂不单独优化、等后续统一重构 JSON 库。这个判断当时还进了 git commit 记录。

**它错在哪**：这次压测的环境不干净，两个污染源叠在一起。一是数据库——测试脚本反复造数据没有清理，messages 表累积了几十万条脏数据，一次查询要从一个被撑大的表里捞数据。二是编译用的是 ASan build——AddressSanitizer 带 2 到 3 倍的插桩开销，把所有函数的绝对时间都拉长了。

两个污染源一起作用的结果：绝对 QPS 被严重压低，而 JSON 序列化在被拉长的总时间里，相对占比被抬高到了 70% 这个唬人的数字。

**纠正**：清理数据库脏数据、改用正常 build（关掉 ASan）之后重新压测，messages 接口干净环境下测得 **3,002 RPS，p50=22ms，p99=131ms**。接口本身完全健康，JSON 序列化根本不构成瓶颈。ASan 下同接口仅 2,253 RPS——bcrypt 类 API 受 ASan 影响最大（4.2x），普通 API 约 1.3-1.6x 差距。

那条"等统一重构 JSON 库"的优化计划，前提不成立，作废。

**这次踩坑的教训**：火焰图的相对占比必须在干净的 baseline 下解读。一个"70%"看起来像铁证，但如果总时间本身被脏数据和插桩开销污染了，这个百分比就是失真的。后来所有的火焰图分析，都先确认环境干净（干净数据库、正常 build）再做。

## 三、火焰图侦察案例

下面几个是在干净环境下做了火焰图侦察后真正做了优化的案例。每个都讲：火焰图上看到什么，据此判断什么，做了什么，优化后怎么验证。

### 3.1 rooms 列表接口：双重查询合并为 JOIN

**侦察**：`/api/rooms` 在同类 GET 接口里 QPS 偏低。火焰图上数据库查询相关栈占用明显——而且不是一次查询，是两次。

优化前火焰图：[`../flame/before_opt/flame_graphs/svg/flame_rooms-list.svg`](../flame/before_opt/flame_graphs/svg/flame_rooms-list.svg)

**判断**：查代码，`/api/rooms` 处理逻辑里先查一次 rooms 表拿房间列表，再查一次 room_members 表拿成员相关信息——两次独立的数据库往返。对一个本可以一次查完的接口，这是多余的一次 round-trip。

**优化**：把两次独立查询改写为一次 JOIN 查询，一次数据库往返拿全所需数据。

**验证**：优化前后在同一环境下对比压测——QPS 从 1,391 提升到 2,467（+77%）。火焰图上数据库查询那条高原相应变窄。

优化后火焰图：[`../flame/after_opt/flame_graphs/svg/flame_rooms-list.svg`](../flame/after_opt/flame_graphs/svg/flame_rooms-list.svg)

当前 rooms-list 的 Level 2 火焰图分析（Release build, CONC=100, 干净 DB）显示，2,488 RPS 下 JSON 序列化（nlohmann `dump_escaped`、`json_value::destroy`、`decode`）是最热路径——查询优化已经做完，剩下的瓶颈在 JSON DOM 构造和析构上。流式序列化（结果集直接格式化到 HTTP buffer，跳过 DOM）是可选方向，不在此次范围。

### 3.2 WebSocket 广播链路：process 路径双查询合并

**测量基础设施（独立建造）**：为压测 WebSocket 广播链路，用 Go（gorilla/websocket）写了一个专用压测客户端。它做三段延迟测量——客户端发出（Segment 1）、服务端落库（Segment 2）、客户端收到（Segment 3）——并带 oracle 校验消息完整性。本机回环下 100 个客户端、共 30 万条消息广播，实现 0 丢失、0 重复。这不是 `ab` 能做的事。

**侦察**：看广播处理路径（process）的火焰图，一次广播处理中 `get_room_from_conv` 和 `get_conv_ai_members` 是两次独立的数据库查询。

优化前火焰图：[`../flame/before_opt/flame_graphs/svg/flame_conv-messages.svg`](../flame/before_opt/flame_graphs/svg/flame_conv-messages.svg)

**判断与优化**：两次查询合并为一次 LEFT JOIN。用 LEFT JOIN 而非 INNER JOIN——对话可能没有 AI 成员，INNER JOIN 会在此情况下漏掉房间信息。

**验证**：三段延迟测量里的 Segment 1（客户端发出到服务端落库）p50 从 419µs 降到 361µs（-14%）。按 30 万条消息计，累积节省约 17 秒。

优化后火焰图：[`../flame/after_opt/flame_graphs/svg/flame_conv-messages.svg`](../flame/after_opt/flame_graphs/svg/flame_conv-messages.svg)

## 四、判断不优化的瓶颈

不是所有"慢"都该优化。有些慢是设计本身的代价，动它反而是错的。

### login / register：PBKDF2 的计算代价

这两个接口的 QPS 只有约 38。火焰图上几乎全部 CPU 都在 PBKDF2 上：[`../flame/after_opt/flame_graphs/svg/flame_login.svg`](../flame/after_opt/flame_graphs/svg/flame_login.svg)

这不是 bug，是设计。PBKDF2 是密码哈希算法，它**故意**设计成计算缓慢——慢是它的安全属性，目的是让暴力破解的成本高到不可行。Atrium 用的是 PBKDF2-HMAC-SHA256，100,000 次迭代。如果把它"优化"快了，等于削弱了密码存储的安全性。

38 QPS 不是一个需要修的性能问题，是一个需要被正确理解的设计代价。它和系统并发设计也不冲突——登录是低频操作，Reactor 的并发模型能让 PBKDF2 的计算阻塞被其他连接的处理吸收。

这一条写进文档，是因为"知道什么不该优化"和"知道怎么优化"同样重要。一个把 login QPS 当性能缺陷去硬提的做法，反而说明没理解 PBKDF2 的意义。

### rooms-create / room-convs-create：多表 INSERT 事务

这两个接口 642 RPS，p50=155ms，慢在三表顺序 INSERT（CREATE room → INSERT conversation → INSERT room_member）的三次 MySQL round-trip。这是当前最大的单接口优化空间——预估存储过程合并后可达约 1,000 RPS。此处记录为已知可优化项，未实施。

## 五、现状数据快照

Release build，干净数据库，腾讯云 2 vCPU / 2 GB，oha CONC=100 回环压测。完整 42 接口 RPS/p50/p99 表见 [`../flame/after_opt/report.md`](../flame/after_opt/report.md)。

### 代表性接口

| API | RPS | p50 | p99 | 瓶颈类型 |
|---|---|---|---|---|
| `/api/me` | 11,044 | 9ms | 17ms | Redis 缓存，性能基线 |
| `/api/thinking-adapters` | 8,990 | 11ms | 18ms | 纯内存，无 DB |
| `/api/friends-delete` | 3,757 | 27ms | 38ms | 单行 DELETE |
| `/api/invitations-list` | 3,282 | 31ms | 42ms | 轻量查询 |
| `/api/conv-messages` | 3,002 | 22ms | 131ms | MySQL 50 行查询 |
| `/api/rooms-list` | 2,488 | 40ms | 56ms | JSON 序列化 |
| `/api/rooms-create` | 642 | 155ms | 199ms | 多表 INSERT 事务 |
| `/api/login` | 38 | — | — | bcrypt 纯计算 |

### RPS 分级

| 等级 | RPS 范围 | 数量 | 代表接口 |
|---|---|---|---|
| ⭐⭐⭐ 极快 | >8,000 | 2 | me, thinking-adapters |
| ⭐⭐ 快 | 2,800–3,800 | 14 | friends-delete, invitations-list, conv-messages 等 |
| ⭐ 中等 | 1,800–2,800 | 18 | rooms-list, friends-list, room-members 等 |
| ❌ 慢 | 500–700 | 2 | rooms-create, room-convs-create |
| ❌❌ bcrypt | <50 | 2 | login, register |

### ASan vs Release

| API | ASan RPS | Release RPS | 倍数 |
|---|---|---|---|
| register | 9 | 38 | 4.2x |
| login | 11 | 38 | 3.5x |
| me | 5,342 | 11,044 | 2.1x |
| thinking-adapters | 5,532 | 8,990 | 1.6x |
| conv-messages | 2,253 | 3,002 | 1.3x |
| rooms-list | 1,724 | 2,488 | 1.4x |

bcrypt 受 ASan 影响最大（内存密集计算），普通 API 约 1.3–1.6x。这也是第二节 messages 误判的一个量化旁证。

### 其他接口

登入、获取消息等接口也做过火焰图侦察，优化前后的火焰图 SVG 已保留在 [`../flame/before_opt/flame_graphs/svg/`](../flame/before_opt/flame_graphs/svg/) 和 [`../flame/after_opt/flame_graphs/svg/`](../flame/after_opt/flame_graphs/svg/)。但优化前的 RPS/p50 当时没有记录，无法给出优化前后吞吐对比。这里如实说明，不补造数字。

## 六、版本演进历史

以下历史数据来自项目迭代记录，测试条件（并发数、数据量、机器、构建方式）未完全统一。只能看出同口径下的趋势，不能跨版本做精确对比。空白单元格表示该版本未测该项。

| 测试场景 | QPS | 平均响应时间 | 失败数 |
|---|---:|---:|---:|
| **v1.2 连接池优化** | | | |
| `POST /api/login` 无连接池 | 259 | 771ms | 0 |
| `POST /api/login` MySQL 连接池 + 大锁 | 4,018 | 49.8ms | 0 |
| `POST /api/login` MySQL 连接池 + 锁优化 | 14,932 | 13.4ms | 0 |
| **v1.3 代码重构 + 防御性加强** | | | |
| `GET /index.html` 无 Redis | 9,148 | 11ms | 0 |
| `GET /index.html` + Redis 缓存 | 10,921 | 9ms | 0 |
| `POST /api/login` 无 Redis | 7,257 | 14ms | 0 |
| `POST /api/login` + Redis 缓存 | 10,049 | 10ms | 0 |
| **v1.4 性能优化** | | | |
| `GET /index.html` (`-n 1000 -c 200`) | 21,600 | 9.3ms | 0 |
| `POST /api/login` + Redis (`-n 1000 -c 200`) | 18,900 | 10.6ms | 0 |
| **v2.0 多 Reactor 架构** | | | |
| `POST /api/login` + Redis (`-n 10000 -c 500`) | 19,917 | 23.1ms | 0 |
| v1.4 同条件对比 (`-n 10000 -c 500`) | 10,095 | 44.0ms | 0 |
| **v2.3 sendfile 零拷贝** | | | |
| `GET /index.html` (`-n 10000 -c 500`) | 26,600 | 18.8ms | 0 |

关键跳跃点：连接池从无到有（259→4,018，15.5x）是最大单次提升；多 Reactor 将高并发吞吐翻倍（10,095→19,917，+97%）；sendfile 零拷贝将静态文件推到 26,600 QPS。

## 七、快速复现

### 火焰图采集

42 接口火焰图一键采集：[`../scripts/flame/api_flame_bench.sh`](../scripts/flame/api_flame_bench.sh)

```bash
cd scripts/flame
bash api_flame_bench.sh          # 仅火焰图
bash api_flame_bench.sh full     # 先干净压测（简历用），再火焰图
```

结果输出到 `~/WebServer/flame_graphs/`，包含 SVG 火焰图、clean bench 日志和 `index.html` 汇总页。

### 手动压测

```bash
# 静态文件
ab -n 10000 -c 500 http://localhost:8080/index.html

# 登录接口
ab -n 10000 -c 500 \
  -p post.txt \
  -T application/x-www-form-urlencoded \
  http://localhost:8080/api/login
```

`post.txt`：`username=test&password=123`

## 小结

这次性能侦察里真正做的事情可以归成三类：

一是建立一套可比的压测方法——固定工具、区分三种环境、火焰图配合延迟分布，且所有数字必须注明 baseline 条件（构建类型、数据库状态、并发数）。

二是基于火焰图做了几处优化——rooms JOIN（+77%）、WebSocket process JOIN（p50 -14%）——并在优化前后同环境对比验证。

三是对"慢"做出"不优化"的判断——PBKDF2 的 38 QPS 是安全设计代价，不是缺陷。rooms-create 的 642 RPS 是已知可优化项，记录为待实施。

中间踩过一次坑——脏数据加 ASan build 导致 JSON 瓶颈的误判。这次踩坑留下的方法是：火焰图的相对占比必须在干净的 baseline 下解读，否则一个看起来很硬的百分比可能完全失真。
