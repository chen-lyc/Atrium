# Level 2: rooms-list (1724 RPS)

`GET /api/rooms` — 返回用户房间列表的 JSON 数组

## CPU 热点（stacks top 8）

```
handle_list_rooms → get_list_rooms_by_user_id
├── nlohmann::serializer::dump_escaped       ← 最高 (111M)，JSON 字符串转义
├── nlohmann::serializer::decode             ← 第二 (101M)，结果集 → JSON 转换
├── MysqlPool::executeRaw                    ← MySQL 查询执行
├── std::string::size                        ← 字符串长度检查（序列化中）
├── nlohmann::json_value::destroy            ← JSON DOM 析构（两个独立栈 80M + 60M）
├── nlohmann::basic_json::basic_json         ← JSON 对象构造
├── std::string::compare                     ← 字符串比较
└── _Rb_tree::_M_get_insert_unique_pos       ← nlohmann 内部 std::map 插入（红黑树）
```

## 关键观察

1. **nlohmann serializer 包揽前二** — `dump_escaped`（字符串转义）+ `decode`（字段映射）是最热路径
2. **json_value::destroy 出现两次** — 两个独立栈分别 80M 和 60M，说明 JSON DOM 在构造后又大规模析构（临时对象）
3. **_Rb_tree 插入** 出现在 top 8 — nlohmann 用 `std::map` 存储 JSON 对象字段，`json["field"]=value` 走红黑树
4. MySQL 占比远低于 JSON — 查询执行很快，慢在"把结果集变成 JSON"

## 优化方向

| 方向 | 方案 | 预期 |
|------|------|------|
| 流式序列化 | 边遍历 MySQL 结果集边写 HTTP buffer，不构建 DOM | 消除 json_value::destroy + basic_json 构造 |
| 预分配 buffer | 已知房间数，`reserve()` 避免 realloc | 减少 string::append |
| 用 string_view | 字段名用 string_view 查表，避免 string::compare | 减少字符串操作 |

> **这是 JSON 瓶颈的典型代表**。12.2% JSON + 12.7% String = 25% 花在"构造 JSON 响应"。改成流式直接写 HTTP buffer 大约能省一半。

---

*数据: agent_data/stacks_rooms-list.txt*
