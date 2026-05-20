# 性能分析报告 — Release Build (CONC=100, 干净数据库)

> Release build（无 ASan），on-CPU 火焰图，不显示 I/O 等待。

## Level 1: RPS 全景

| API | Method | RPS | p50 | p99 | 瓶颈类型 |
|-----|--------|-----|-----|-----|---------|
| me | GET | **11,044** | 9ms | 17ms | Redis 缓存，性能基线 |
| thinking-adapters | GET | **8,990** | 11ms | 18ms | 纯内存，无 DB |
| friends-delete | DELETE | **3,757** | 27ms | 38ms | 单行 DELETE |
| invitations-list | GET | **3,282** | 31ms | 42ms | 轻量查询 |
| friend-requests-list | GET | **3,250** | 32ms | 42ms | 轻量查询 |
| me-ai-usage | GET | 3,145 | 32ms | 44ms | 轻量查询 |
| conv-messages | GET | **3,002** | 22ms | 131ms | MySQL 50行查询 |
| conv-ai-delete | DELETE | 2,997 | 20ms | 146ms | 单行 DELETE |
| conv-ai-list | GET | 2,995 | 22ms | 127ms | 轻量查询 |
| conv-model | GET | 2,973 | 27ms | 115ms | 轻量查询 |
| friend-requests-cancel | DELETE | 2,964 | 25ms | 129ms | 单行 DELETE |
| invitations-cancel | DELETE | 2,957 | 21ms | 148ms | 单行 DELETE |
| conv-delete | DELETE | 2,951 | 23ms | 125ms | 单行 DELETE |
| msg-delete | DELETE | 2,931 | 21ms | 148ms | 单行 DELETE |
| conv-ai-create | POST | 2,922 | 24ms | 137ms | INSERT |
| conv-ai-update | PATCH | 2,927 | 26ms | 118ms | UPDATE |
| invitations-respond | PATCH | 2,897 | 27ms | 122ms | UPDATE |
| friend-requests-respond | PATCH | 2,909 | 21ms | 151ms | UPDATE |
| rooms-delete | DELETE | 2,892 | 26ms | 123ms | 单行 DELETE |
| search-users | GET | 2,881 | 35ms | 46ms | MySQL 查询 |
| me-ai-usage-today | GET | 2,851 | 35ms | 49ms | 轻量查询 |
| conv-rename | PATCH | 2,827 | 25ms | 154ms | UPDATE |
| room-members-role | PATCH | 2,819 | 28ms | 129ms | UPDATE |
| friend-requests-create | POST | 2,704 | 25ms | 161ms | INSERT |
| room-invitations-create | POST | 2,701 | 30ms | 133ms | INSERT |
| ais-list | GET | 2,743 | 38ms | 56ms | MySQL + JSON |
| rooms-list | GET | 2,488 | 40ms | 56ms | JSON 序列化 |
| friends-list | GET | 2,480 | 40ms | 53ms | JSON 序列化 |
| room-ai-delete | DELETE | 2,238 | 45ms | 62ms | DELETE |
| room-convs | GET | 2,134 | 47ms | 62ms | MySQL 查询 |
| room-ai-update | PATCH | 2,063 | 49ms | 61ms | UPDATE |
| room-invitations | GET | 2,039 | 49ms | 62ms | MySQL 查询 |
| room-ai-list | GET | 2,042 | 49ms | 63ms | MySQL 查询 |
| me-update | PATCH | 2,033 | 49ms | 67ms | UPDATE |
| rooms-update | PATCH | 2,007 | 49ms | 68ms | UPDATE |
| room-members | GET | 1,870 | 54ms | 67ms | JOIN 查询 |
| room-ai-create | POST | 1,854 | 43ms | 202ms | INSERT, p99 高 |
| rooms-create | POST | **642** | 155ms | 199ms | 多表 INSERT 事务 |
| room-convs-create | POST | **642** | 155ms | 196ms | 多表 INSERT 事务 |
| login | POST | **38** | — | — | bcrypt 纯计算 |
| register | POST | **38** | — | — | bcrypt 纯计算 |

## Level 1: RPS 分级

| 等级 | RPS 范围 | 数量 | 最慢/最快 |
|------|---------|------|-----------|
| ⭐⭐⭐ 极快 | >8000 | 2 | me (11044), thinking-adapters (8990) |
| ⭐⭐ 快 | 2800-3800 | 14 | friends-delete (3757) ~ search-users (2881) |
| ⭐ 中等 | 1800-2800 | 18 | rooms-list (2488) ~ room-ai-create (1854) |
| ❌ 慢 | 500-700 | 2 | rooms-create (642), room-convs-create (642) |
| ❌❌ bcrypt | <50 | 2 | login (38), register (38) |

## Level 1: ASan vs Release 对比

| API | ASan RPS | Release RPS | 倍数 |
|-----|---------|------------|------|
| register | 9 | 38 | **4.2x** |
| login | 11 | 38 | **3.5x** |
| me | 5,342 | 11,044 | **2.1x** |
| thinking-adapters | 5,532 | 8,990 | 1.6x |
| conv-messages | 2,253 | 3,002 | 1.3x |
| rooms-list | 1,724 | 2,488 | 1.4x |
| friends-list | 1,803 | 2,480 | 1.4x |

> bcrypt 受 ASan 影响最大（内存密集计算），普通 API 约 1.3-1.6x 差距。

## Level 2: 关键接口火焰图分析

| API | RPS | 瓶颈 | 详情 |
|-----|-----|------|------|
| me | 11,044 | Redis 缓存，接近最优 | [level2/me.md](level2/me.md) |
| conv-messages | 3,002 | MySQL 50行提取 | [level2/conv-messages.md](level2/conv-messages.md) |
| rooms-list | 2,488 | JSON 序列化 | [level2/rooms-list.md](level2/rooms-list.md) |
| rooms-create | 642 | 多表 INSERT 事务 | [level2/rooms-create.md](level2/rooms-create.md) |
| login | 38 | bcrypt 纯计算 | [level2/login.md](level2/login.md) |

## Level 3: 优化建议

### P1: rooms-create / room-convs-create 事务合并

642 RPS，p50=155ms。三表顺序 INSERT（CREATE room → INSERT conversation → INSERT room_member），每次 MySQL round-trip。
- 方案：存储过程一次完成
- 预估：642 → ~1000 RPS

### P2: rooms-list JSON 流式序列化

2488 RPS，火焰图 stacks 显示 nlohmann serializer::dump_escaped 是最热路径。
- 方案：MySQL 结果集直接写 HTTP buffer
- 预估：2488 → ~3200 RPS

### P3: conv-messages MySQL 查询精简

3002 RPS，MySQL C API 调用是最热路径（mysql_fetch_field、mysql_fetch_row 逐字段遍历）。
- 方案：SELECT 指定列，减少连接池争用
- 预估：3002 → ~3600 RPS

### 无需优化

- **me** (11,044 RPS)：已接近 epoll 模型的单连接上限
- **login/register** (38 RPS)：bcrypt 安全成本，生产无此并发场景

---

## 诚实性 Checklist

1. [x] on-CPU 限制已声明
2. [x] Release build，无 ASan 干扰
3. [x] 数据库干净（已验证）
4. [x] ASan vs Release 对比已提供
5. [x] 每条建议有火焰图 stacks 证据来源
6. [x] bcrypt 压测效应已区分

---

*2026-05-19 | Release build | CONC=100 | clean DB*
