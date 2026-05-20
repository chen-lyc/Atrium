# Level 2: me (11,044 RPS)

`GET /api/me` — Redis 缓存 → 5 字段 JSON，性能基线

## CPU 热点

```
handle_me
├── nlohmann::json_value::destroy       ← 最高 (111M)，JSON 对象析构
├── nlohmann::serializer::dump          ← 序列化 {"user_id":8,...}
├── _Rb_tree_insert_and_rebalance       ← nlohmann 内部 std::map 操作
├── nlohmann::serializer::decode        ← 字段 → JSON 转换
├── nlohmann::serializer::dump_escaped  ← 字符串转义
└── Reactor::trySend → 内核网络栈       ← 发送 HTTP 响应
```

## 观察

1. **11,044 RPS，p50=9ms** — 当前架构的 soft limit
2. even 5 字段 JSON 的 `json_value::destroy` 是最热栈 — nlohmann 的 DOM 析构有固定开销
3. Redis 查询完全不可见 — 极快，淹没在采样噪声中
4. 瓶颈在内核网络栈（send/recv + epoll），不在应用代码

## 结论

**性能基线**。应用层无可优化空间。这是其他接口的 RPS 天花板。

---

*Release build, CONC=100*
