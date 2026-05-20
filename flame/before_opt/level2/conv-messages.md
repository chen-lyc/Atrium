# Level 2: conv-messages (2253 RPS)

`GET /api/conversations/11/messages?limit=50` — 返回 50 条消息的 JSON 数组

## CPU 热点（stacks top 8）

```
handle_conversation_messages
├── libmysqlclient C API                    ← 最高，mysql_fetch_field / mysql_fetch_row
├── MysqlConnGuard::MysqlConnGuard          ← 连接池取连接（50505050）
├── MysqlPool::executeRaw                   ← SQL 执行 + 结果集绑定
├── MysqlConnGuard::~MysqlConnGuard         ← 归还连接
├── pthread_mutex_lock                      ← 连接池互斥锁
├── mysql_fetch_field                       ← 逐字段提取（50 行 × N 列）
└── nlohmann::json (低占比)                 ← JSON 序列化不在 top stacks
```

## 关键观察

1. **MySQL C API 调用是最热路径**，不是 JSON。`mysql_fetch_field` 对每行每字段都调用一次
2. `MysqlConnGuard` 构造/析构占明显比例 — 连接池争用（8 连接 / 100 并发）
3. JSON 序列化不在 top 10，说明"查询 50 条消息 + 字段转换"的开销远超"序列化为 JSON 字符串"
4. p99=217ms 偏高，是连接池等锁导致的尾延迟

## 优化方向

| 方向 | 方案 | 预期 |
|------|------|------|
| 减少字段数 | SELECT 只取必要的列，不 SELECT * | 减少 mysql_fetch_field 调用 |
| 连接池扩容 | max_connections 8 → 16 | 减少构造/析构/互斥锁 |
| 行预取 | mysql_stmt_store_result 后批量处理 | 减少 C API 往返 |

> **不是 JSON 瓶颈**: 脏数据库时期 conv-messages=126 RPS 是数据库垃圾导致，非 JSON 序列化问题。干净数据库下 RPS=2253，优化方向是 MySQL 层。

---

*数据: agent_data/stacks_conv-messages.txt*
