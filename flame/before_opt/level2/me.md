# Level 2: me (5342 RPS)

`GET /api/me` — 最快速的接口，性能基线

## CPU 热点

```
handle_me
├── Redis 读取用户缓存 (Session → Redis GET user:{id})
│   ├── redisCommand / redisGetReply           ← 低占比
│   └── nlohmann::json 构造 (仅 5 字段)       ← 极轻量
├── nlohmann::json::dump (短 JSON ~100 字节)   ← 快速
└── Reactor::trySend → 内核网络栈              ← 占主体
    ├── tcp_sendmsg → tcp_write_xmit
    ├── tcp_v4_rcv
    └── __lock_text_start (内核自旋锁, CONC=100 放大)
```

## 火焰图形状

窄而高 — 调用链短，Reactor → handler → Redis → dump → send。大部分 CPU 在内核网络栈（send/recv 数据包处理）。

## 关键观察

1. **Redis 缓存路径有效** — 完全跳过 MySQL
2. **JSON 开销极低** — 只序列化 5 个字段，dump 占比 <10%
3. **5342 RPS 是当前架构的 soft limit** — 瓶颈在内核网络栈和 epoll 模型，不在应用代码
4. KernelLock 9% 是 CONC=100 导致同一 socket 争用放大

## 优化空间

**应用层无优化空间**。要想超过 5400 RPS：
- 连接复用（Keep-Alive 已启用）
- 内核旁路（DPDK/io_uring）— 超出项目范围
- 多 Reactor 负载均衡 — 已有

> me 是性能基线。其他接口的 RPS 天花板由 me 决定。

---

*数据: agent_data/stacks_me.txt*
