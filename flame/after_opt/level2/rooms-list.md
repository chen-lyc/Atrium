# Level 2: rooms-list (2,488 RPS)

`GET /api/rooms` — 用户房间列表 JSON

## CPU 热点

```
handle_list_rooms → get_rooms_with_data
├── nlohmann::json_value::destroy       ← 最高 (111M)，JSON DOM 析构
├── nlohmann::serializer::dump_escaped  ← JSON 字符串转义
├── nlohmann::serializer::decode        ← 结果集 → JSON 字段映射
├── _Rb_tree::_M_get_insert_unique_pos  ← nlohmann std::map 红黑树插入
├── libmysqlclient                      ← MySQL C API
└── get_rooms_with_data                 ← 多表 JOIN 查询
```

## 观察

1. **JSON 相关栈包揽前三**：`json_value::destroy` + `dump_escaped` + `decode` — nlohmann 序列化是明确瓶颈
2. `_Rb_tree` 插入 — `json["field"]=value` 走 `std::map` 红黑树，每个字段一次查找+插入
3. `json_value::destroy` 最高 — DOM 对象析构（临时 json 对象）开销超过构造
4. 2488 RPS，和 me (11044) 差距 **4.4x**，JSON 序列化占了大头

## 优化方向

| 方向 | 方案 | 预期 |
|------|------|------|
| 流式序列化 | MySQL 结果集直接格式化到 HTTP buffer，跳过 DOM | 消除 json_value::destroy |
| 预分配 | `reserve()` JSON 数组大小 | 减少 realloc |

---

*Release build, CONC=100*
