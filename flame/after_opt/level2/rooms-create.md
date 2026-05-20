# Level 2: rooms-create (642 RPS)

`POST /api/rooms` — 创建房间，三表 INSERT 事务

## CPU 热点

```
handle_create_room
├── MysqlPool::executeRaw ×3              ← INSERT rooms / conversations / room_members
├── nlohmann::json::parse                 ← 请求 body 解析 {"room_name":"bench-tmp"}
├── SHA256 / session 校验                 ← 鉴权
└── nlohmann::json::dump                  ← 响应 {"room_id":xxx}
```

## 观察

1. **642 RPS，p50=155ms** — 多表 INSERT + LAST_INSERT_ID() 的三次 round-trip
2. 比 me (11044 RPS) 慢了 **17x**，说明每次请求的大部分时间在等 MySQL 的事务完成
3. p50=155ms，p99=199ms — 尾延迟可控（不像 conv-ai-create 的 p99 到 546ms）

## 优化方向

| 方向 | 方案 | 预期 |
|------|------|------|
| 存储过程 | 三表 INSERT 在 MySQL 侧一次完成，1 round-trip | 155ms → ~60ms，RPS → ~1000 |
| UUID 预生成 | 用 UUID 做房间 ID，避免 SELECT LAST_INSERT_ID() | 减少一次 round-trip |

---

*Release build, CONC=100*
