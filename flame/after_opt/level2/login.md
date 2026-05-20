# Level 2: login (38 RPS)

`POST /api/login` — bcrypt 密码校验 + session 签发

## CPU 热点

```
handle_login
├── bcrypt (CRYPTO_*/EVP_*/ENGINE_*)     ← 纯计算，占 80%+
├── SHA256 session_id 哈希
├── MysqlPool::executeQuery               ← INSERT session（极低占比）
└── operator new / free                   ← OpenSSL 内部内存分配
```

## 观察

1. **38 RPS，比 ASan 版本 (11) 快了 3.5x** — bcrypt 是内存密集型，ASan 每个内存访问都检查
2. 火焰图整张被 bcrypt 栈占满 — 线程在 CPU 上跑计算，非 I/O 等待
3. CONC=100 把 bcrypt 推到极限 — 这是压测效应，生产环境不存在 100 人同时登录
4. session INSERT 占比极低 — 不是瓶颈

## 结论

**不需要优化**。bcrypt 是安全成本，生产场景不会出现此并发。如需提升压测数字：bcrypt cost 从 12 → 10（不推荐）。

---

*Release build, CONC=100*
