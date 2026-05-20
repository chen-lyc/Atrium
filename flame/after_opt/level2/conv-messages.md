# Level 2: conv-messages (3,002 RPS)

`GET /api/conversations/11/messages?limit=50` — 50 条消息的 JSON 数组

## CPU 热点

```
handle_conversation_messages → get_recent_messages
├── libmysqlclient C API              ← 最高 (70M)，mysql_fetch_field/row
├── PreparedStatement::do_query       ← SQL 执行
├── MysqlPool::executeRaw             ← 参数绑定 + 结果集封装
├── MysqlConnGuard::MysqlConnGuard    ← 连接池取连接
├── MySQL_Connection::isValid         ← 连接健康检查
└── [[vdso]]                          ← 内核 vDSO 调用
```

## 观察

1. **全是 MySQL 栈** — nlohmann 函数不在 top 8，JSON 序列化不是瓶颈
2. `MysqlConnGuard` 构造占明显比例 → 连接池争用 (8 连接 / 100 并发)
3. p50=22ms 但 p99=131ms — 尾延迟来自连接池等锁
4. 3002 RPS，对比 me (11044) 差距在 MySQL 查询的固定开销

## 优化方向

| 方向 | 方案 |
|------|------|
| 连接池扩容 | max_connections 8 → 16，减少等锁 |
| SELECT 精简 | 只取需要的列，减少 mysql_fetch_field 调用 |
| 消息缓存 | 热门对话的消息 Redis 缓存 |

---

*Release build, CONC=100*
