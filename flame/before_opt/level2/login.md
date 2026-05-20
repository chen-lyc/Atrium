# Level 2: login (11 RPS)

`POST /api/login` — 用户名密码验证 + 签发 session

## CPU 热点

```
handle_login
├── bcrypt password verification (60%+)      ← 纯计算
│   ├── CRYPTO_clear_free / CRYPTO_free
│   ├── EVP_MD_CTX_set_flags
│   ├── ENGINE_finish
│   └── OPENSSL_cleanse
├── SHA256 session_id hash (15%)
├── ASan interceptor overhead (50%)          ← ASan 版本特有
└── operator new / free (5%)                 ← OpenSSL 内部分配
```

## 火焰图形状

整张图宽而矮 — bcrypt 栈从 `CRYPTO_` 到 `EVP_` 到 `ENGINE_` 均匀展开。线程一直在 CPU 上跑 OpenSSL 计算，不是等 I/O。

## 关键观察

1. **Crypto 独占 20.5%**（ASan 版本下被稀释，实际更高）— 全部是 bcrypt 计算
2. **CONC=100 放大了效应** — 100 个并发登录同时做 bcrypt，线程池满→RPS=11
3. **不是代码缺陷** — bcrypt 慢是安全设计，不是性能 bug
4. **生产环境不会同时 100 人登录** — 压测设置导致的现象

## 优化方向（可选）

| 方向 | 方案 | 说明 |
|------|------|------|
| 异步 bcrypt | 线程池执行 bcrypt，reactor 线程继续处理其他请求 | 只提升 login 期间的全局吞吐 |
| bcrypt cost 调低 | 从 12 降到 10 | **不推荐**，降低安全性 |

> 优化优先级低。正常登录场景不存在 100 并发的 bcrypt 争用。

---

*数据: agent_data/stacks_login.txt*
