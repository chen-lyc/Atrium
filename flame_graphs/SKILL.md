---
name: flame-graph
description: Analyze Brendan Gregg-style flame graph SVGs from perf recordings. Use when analyzing flame graphs, identifying CPU bottlenecks, or producing optimization reports. Triggers on "分析火焰图", "flame graph", "性能瓶颈".
---

# Flame Graph Analysis

## 1. 火焰图是什么，能做什么，不能做什么

火焰图是 Brendan Gregg 发明的 on-CPU 采样可视化工具。

**能做的**: 告诉你 CPU 时间花在哪些函数上。

**不能做的**: 告诉你线程在等什么。火焰图只显示 CPU 上的代码。如果线程被 I/O 阻塞、等锁、sleep，这些时间根本不在火焰图里。**独占时间低 ≠ 在等 I/O**。

## 2. SVG 数据格式

```xml
<g>
  <title>function_name (N samples, P.PP%)</title>
  <rect x="X" y="Y" width="W" height="15.0" fill="rgb(...)" rx="2" ry="2" />
</g>
```

| 字段 | 含义 |
|------|------|
| `samples` | 该函数的调用栈总采样数。**包含所有子函数。** |
| `y`（rect） | 栈深度。**大 y = 靠近根，小 y = 靠近叶。** |
| `x`, `width` | 水平位置和跨度。width 正比于 CPU 占比。 |

子函数判定: `B.y < A.y` 且 B 的 x 范围在 A 内部。

## 3. 独占时间（Self Time）

直接对所有函数 samples 求和 → 父/子重复 → 百分比 300-500%。必须用独占时间:

```python
def self_time(funcs):
    ys = sorted(set(f['y'] for f in funcs), reverse=True)
    for f in funcs: f['ss'] = f['samples']
    for f in funcs:
        ci = ys.index(f['y'])
        if ci >= len(ys) - 1: continue
        ny = ys[ci + 1]; fe = f['x'] + f['width']
        for g in funcs:
            if g['y'] == ny:
                ge = g['x'] + g['width']
                if g['x'] >= f['x'] - 0.01 and ge <= fe + 0.01:
                    f['ss'] -= g['samples']
    return funcs
```

验证: 所有函数 `ss` 之和 == 根函数 `samples`（100%）。

## 4. 分类策略

| 类别 | 关键字 |
|------|--------|
| MySQL | `mysql`, `MysqlPool`, `mysql_real_query`, `mysql_store_result`, `mysql_fetch`, `mysql_autocommit` |
| JSON | `nlohmann`, `json_abi`, `basic_json`, `serializer`, `adl_serializer` |
| HTTP | `http::`, `handle_`, `HttpCodec`, `sendResponse`, `RouteResult` |
| Reactor/IO | `Reactor::`, `epoll_wait`, `epoll_ctl`, `Connection` |
| String | `std::basic_string`, `std::__cxx11::basic_string`, `allocator<char>`, `string_view` |
| Net/Kernel | `tcp_`, `ip_`, `process_backlog`, `net_rx`, `napi`, `skb`, `softirq`, `tcp_v4_rcv` |
| Crypto | `sha`, `bcrypt`, `CRYPTO_`, `EVP_`, `SHA256`, `OPENSSL`, `libcrypto`, `libssl` |
| Redis | `redis`, `RedisPool`, `redisCommand` |
| Mem | `malloc`, `free`, `operator new`, `kmem_cache`, `slab_free`, `kfree`, `kmalloc` |
| KerneLock | `__lock_text_start` |
| KernelSched | `finish_task_switch`, `exit_to_user_mode_loop` |
| Libc | `[libc.so.6]`, `_IO_`, `sdscatfmt`, `tolower` |
| Unknown | `[unknown]` |
| Other | 未匹配 |

Other 占比 30-50% 是正常的。如果想搞清楚 Other 是什么，**实际查看里面的函数名**，不要凭推理猜"大概率是框架开销"。

## 5. 分析步骤

1. HTML → RPS/p50/p99，排序找异常
2. SVG → 独占时间 → 分类聚合
3. 找最热类别: 某类 >20% → 主瓶颈; JSON+String >30% → 序列化瓶颈; Crypto >50% → bcrypt 热点
4. 看火焰图形状: 某栈占满图 → 线程在 CPU 上跑（非等 I/O）; 采样极少 → 错误路径
5. 写报告


## 5.5 Agent 数据（Level 2 深度调用链分析）

脚本在生成 SVG 的同时，将 `stackcollapse-perf.pl` 的输出保存到 `agent_data/stacks_<API>.txt`。格式：

```
server.out;Reactor::loop;Reactor::process;handle_get_messages;nlohmann::json::dump 42
server.out;Reactor::loop;Reactor::process;handle_get_messages;nlohmann::json::operator[] 28
```

每行 = `func_a;func_b;func_c count`（分号分隔的调用栈路径 + 采样数）。

### Level 2 分析流程

1. **加载** `stacks_<API>.txt`
2. **解析**为 `(stack_list, count)` pairs
3. **建树**: 按分号分割栈路径，合并相同前缀的节点，累加 `cumulative = 子树所有采样之和`，计算 `self = cumulative - sum(children)`
4. **聚合到 handler**: 找到包含 `handle_` 的路径作为入口，以此为根子集
5. **找关键路径**: 满足 `cumulative > 10% 总采样 且 深度 > 3` 的路径
6. **输出**: 每个关键路径的树状文本 + self%/cumul% + 父函数标注

### Level 2 输出格式

```
### conv-messages 主路径

handle_get_messages (100% cumul, 2% self)
├── MessagesResponse::build (95% cumul, 1% self)
│   ├── MysqlPool::executeQuery (4% cumul, 0.5% self)  ← MySQL 实际 CPU 很低
│   ├── nlohmann::json::operator[] (28% cumul, 3% self)  ← DOM 字段插入
│   │   └── std::map::operator[] (24% cumul, 1% self)
│   │       └── _Rb_tree::_M_insert (18% cumul, self 12%)  ← 红黑树插入
│   └── nlohmann::json::dump (38% cumul, 2% self)  ← 序列化
│       └── serializer::dump_object (32% cumul, self 8%)
│           └── std::string::append (25% cumul, self 18%)

观察:
- 65% 时间在两个独立路径: operator[] 构造 DOM + dump 序列化（nlohmann 双倍开销）
- _Rb_tree::_M_insert 占 18% — 300 次/请求的 map 插入
- 如果换成 rapidjson SAX Writer，operator[] 那 28% 可消除
```

### 报告中的引用

Level 1 报告中 P0/P1 项应引用 Level 2 的关键路径发现，而非仅列占比数字。格式：

> **调用链证据**: 见 [Level 2 详情](#conv-messages-主路径)。65% 时间集中在 operator[](28%) + dump(38%) 两条独立路径，确认是 nlohmann DOM 双倍开销模式。


## 6. 关键陷阱

| 陷阱 | 错误做法 | 正确做法 |
|------|---------|---------|
| 独占时间低 → 推断 I/O 等待 | "MySQL 7%，RPS 低 → 等 DB" | 看火焰图中 process 栈占多宽。占满 ~80% = 在 CPU 上跑 |
| 火焰图全是 crypto → 服务慢 | 断言 bcrypt 有问题 | 检查并发数。CONC=100 把 bcrypt 推到极限是正常 |
| Other 占比大 → 乱猜 | "大概率是框架开销" | 实际查看 Other 里的函数名再下结论 |
| 收益数字凭直觉 | "5-10x"、"20-50%" | 基于 独占时间% × 理论消除上限 × 0.5-0.7 |
| JSON 热点低估 | 只看 JSON% | JSON 序列化产生大量 String 拷贝，应看 JSON% + String% |

## 7. 诚实性 Checklist

写完报告后逐条核对:

1. 报告开头是否写了"on-CPU 火焰图只显示 CPU 上的代码，不显示 I/O 等待"？
2. 任何优化建议是否有本报告的实测数据支撑？没有 → 删除或标注"需进一步验证"。
3. 每个"RPS 提升 X%"是否有"独占时间% × 消除率 × 折扣率"的计算？折扣率是否 ≤0.7？
4. 每条建议能否在火焰图上指出具体哪个函数/哪根栈？指不出的 → 标注"需进一步验证"。
5. 是否区分了"压测设置导致的现象"和"接口本身的性能问题"？
6. Other 占比大时，是否实际查看了里面是什么函数？不是凭推理猜的？
7. P0/P1 优化建议是否有 Level 2 调用链证据？是否引用了 agent_data/stacks_*.txt 的树状路径分析？
