# Level 2: rooms-create (555 RPS)

`POST /api/rooms` — 创建房间（涉及 rooms + conversations + room_members 三表）

## CPU 热点

```
handle_create_room
├── MysqlPool::executeRaw (INSERT rooms → LAST_INSERT_ID → INSERT conversations → INSERT room_members)
├── CRYPTO / OpenSSL (session 哈希校验)
├── nlohmann::json::parse (请求 body 解析)
├── std::string 构造（房间名、对话标题）
└── nlohmann::json::dump (响应 {"room_id":...})
```

## 关键观察

1. **MySQL 10.1%** — 三次 INSERT 在一个事务中，但每次 INSERT 是独立的 MySQL round-trip
2. **Crypto 8.9%** — session 校验走 bcrypt/SHA，创建房间前需鉴权
3. **p50=178ms 较高** — 三次顺序 INSERT 的累计延迟
4. CONC=100 时连接池争用放大延迟

## 优化方向

| 方向 | 方案 |
|------|------|
| 存储过程 | 三表 INSERT 在 MySQL 侧一次完成，减为 1 次 round-trip |
| 不用 LAST_INSERT_ID | 用 UUID 预先生成房间 ID，避免 SELECT LAST_INSERT_ID() 往返 |

> rooms-create 是最慢的非 bcrypt 接口。优化方向是减少 MySQL round-trip。

---

*数据: agent_data/stacks_rooms-create.txt*
