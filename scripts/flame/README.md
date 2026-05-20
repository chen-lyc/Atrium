# API 火焰图压测

每个 API 单独压测，生成火焰图 SVG。

## 使用

### 1. 传到云服务器

```bash
scp -r scripts/flame ubuntu@你的服务器IP:~/WebServer/scripts/
```

### 2. 运行

```bash
sudo mysql webserver < ~/WebServer/scripts/flame/cleanup_db.sql

cd ~/WebServer/scripts/flame

# 仅火焰图（默认）
bash api_flame_bench.sh

# 先干净压测（简历用），再生成火焰图
bash api_flame_bench.sh full
```

- **默认 `flame`**：perf + oha 同时跑，生成火焰图 SVG + 带采样开销的 RPS
- **`full`**：先单独 oha 跑一轮收集干净 RPS/p50/p90/p99，重新播种后再 perf+oha 生成火焰图

### 3. 结果

```
~/WebServer/flame_graphs/
├── svg/                    # 火焰图 SVG
│   ├── flame_me.svg
│   ├── flame_rooms.svg
│   └── ...
├── logs/                   # 火焰图轮次 oha 日志
│   ├── oha_me.log
│   └── ...
├── bench/                  # [full 模式] 干净压测日志
│   ├── bench_me.log
│   └── ...
├── agent_data/             # Level 2 调用链数据
│   ├── stacks_me.txt
│   └── ...
├── index.html              # 火焰图汇总页
└── bench.html              # [full 模式] 干净压测汇总页（简历用）
```

`.svg` 下载到本机用浏览器打开。

### 4. 环境要求

```bash
command -v oha && command -v perf && command -v jq
ls ~/FlameGraph/flamegraph.pl ~/FlameGraph/stackcollapse-perf.pl
sudo mysql webserver -e "SELECT 1"
sudo fuser 8080/tcp
```

> 脚本会自动将 `kernel.perf_event_paranoid` 临时降到 1（退出时恢复），云服务器默认的 4 会禁用 perf 采样。
