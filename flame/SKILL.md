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

## 5. 分析流程（指南，非硬性约束）

### Step 0: 先验证数据质量

**在分析火焰图之前，先检查环境健康度**：

- RPS 是否合理？非 bcrypt 接口低于 100 RPS → 数据库/环境有问题，火焰图数据不可信
- 数据库是否干净？`SELECT COUNT(*) FROM rooms WHERE name LIKE 'bench%'`
- 是 ASan 还是 release build？ASan 版本会改写函数名（`__interceptor_*`）、放大 sample 数、推高 Other 占比到 60-70%
- 有前次数据对比吗？同一接口 RPS 变化超过 50% → 数据可能受环境变量污染

### Step 1: RPS 分级

按 RPS 范围将 API 分档，找出异常值：
- 极快 (>5000)：性能基线，如 me, thinking-adapters
- 快 (2000-5000)
- 中等 (1000-2000)
- 慢 (500-1000)
- 极慢 (<500)：检查是 bcrypt 密集还是数据库/种子问题

### Step 2: 独占时间分类

SVG → 独占时间 → 分类聚合。**不要把分类当作瓶颈判断的唯一依据**：
- 结合 RPS 看：JSON 占比高但 RPS 已经很快 → 不是紧急瓶颈
- 结合 stacks 看：top 函数名比百分比更直接
- **阈值是指南，不是铁律**：JSON+String >30% 通常是序列化瓶颈，但 20% 也可能是（如果 API 本身简单）

### Step 3: Level 2 选择

**按瓶颈类型选代表**，不只看 CPU 采样数：
- 快+JSON 密集 → rooms-list / friends-list
- 快+MySQL 密集 → conv-messages
- 慢+多表写入 → rooms-create
- bcrypt 密集 → login
- 性能基线 → me

选 4-6 个，覆盖不同瓶颈类型。每个写独立 Level 2 文件。

### Step 4: Level 2 分析

解析 `agent_data/stacks_<API>.txt`：
1. `grep 'handle_<name>' stacks_xxx.txt | awk -F';' '{print $NF}' | sort -rn` 取 top stacks
2. 分析热点函数：是 MySQL 库函数、nlohmann serializer、还是 OpenSSL？
3. 输出：top 8 调用栈 + 观察结论 + 优化方向

不用强制建完整树——**top stacks 的原始输出比格式化的树更有信息量**。

## 6. 关键陷阱

| 陷阱 | 错误做法 | 正确做法 |
|------|---------|---------|
| **脏数据当瓶颈** | 数据库 16000 条垃圾房间，conv-messages=126 RPS，断言"JSON 序列化是主瓶颈" | 先查 `SELECT COUNT(*) FROM rooms`，RPS 异常低时排查环境 |
| **ASan 版本当 release** | Other 60-70% 硬猜"大概率框架开销" | 识别 ASan：`__asan*` `__interceptor*` 函数名，Other 偏高是正常 |
| **分类阈值当铁律** | "JSON<20%，不是瓶颈" | 结合 RPS + stacks 综合判断，简单接口 10% 也可能是瓶颈 |
| **Level 2 只看 top CPU** | 只分析采样最多的 5 个 API | 按瓶颈 TYPE 选代表，覆盖不同 RPS 档位 |
| 独占时间低 → 推断 I/O 等待 | "MySQL 7%，RPS 低 → 等 DB" | 看火焰图形状：栈宽占满 = 在 CPU 上跑 |
| 火焰图全是 crypto → 服务慢 | 断言 bcrypt 有问题 | 检查并发数。CONC=100 把 bcrypt 推到极限是正常 |
| Other 占比大 → 乱猜 | "大概率是框架开销" | 实际查看 Other 里的函数名 |
| 收益数字凭直觉 | "5-10x"、"20-50%" | 独占时间% × 消除率 × 0.5-0.7 |
| JSON 热点低估 | 只看 JSON 分类% | 看 String% + 实际 serializer 函数栈 |

## 7. 报告结构

### Level 1（主报告 `report.md`）
- RPS 全景表（含 p50/p99）
- 代表性 API 的 CPU 分类表（JSON / String / MySQL / Crypto 占比）
- RPS 分级摘要
- Level 2 索引表
- 优化建议（P1/P2/P3，含调用链证据来源）

### Level 2（独立文件 `level2/<api>.md`）
- 每个 API 的 top 8 调用栈
- 关键观察（2-3 条）
- 优化方向（如果有）
- 火焰图形状描述（宽/窄、高/矮、是否占满）

## 8. 诚实性 Checklist

1. 报告开头声明了 on-CPU 限制和 build 类型（ASan/release）
2. 数据质量已验证（数据库行数合理、RPS 无异常低值）
3. 每条优化建议有 stacks 调用链证据
4. RPS 提升估算有计算过程（独占时间% × 消除率 × ≤0.7）
5. 区分了压测设置效应和接口本身性能问题
6. Other 占比大时实际查看了函数名
7. 之前的错误结论被显式纠正（如果有）
