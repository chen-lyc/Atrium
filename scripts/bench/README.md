# Atrium WebSocket Benchmark

WebSocket 广播压测客户端，模拟 100 个用户在同一房间内并发收发，测量服务端广播链路延迟与完整性。

## 前置条件

1. 进入本目录：`cd scripts/bench`

## 编译

```bash
# 下载依赖（只需执行一次）
go mod tidy

# Linux
CGO_ENABLED=0 go build -o bench .

# Windows 交叉编译
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o bench.exe .
```

## 数据准备

```bash
# 1. 生成 100 个测试用户 + 加入目标房间
python3 gen_seed.py --room-id <ROOM_ID> --start-id 1000 > seed_users.sql

# 2. 导入数据库
mysql -u lyc -p webserver < seed_users.sql
```

## 清理

```bash
# 压测完成后，删除所有测试用户
python3 gen_cleanup.py --room-id <ROOM_ID> --start-id 1000 > cleanup.sql
mysql -u lyc -p webserver < cleanup.sql
```

`gen_seed.py` 参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--room-id` | 必填 | 目标房间 ID |
| `--start-id` | 1000 | 用户 ID 起始值，生成 user_0 到 user_99 |
| `--count` | 100 | 用户数量 |
| `--password` | bench123 | 统一密码 |

## 运行

```bash
./bench -url http://localhost:8080 -room <ROOM_ID> -conv <CONVERSATION_ID>
```

完整参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-url` | `http://localhost:8080` | 服务端地址 |
| `-room` | 必填 | 房间 ID |
| `-conv` | 必填 | 会话 ID |
| `-clients` | 100 | 并发客户端数 |
| `-duration` | 30s | 每客户端发送时长 |
| `-drain` | 3s | 停止发送后等待在途消息的时间 |
| `-start-id` | 0 | 客户端起始序号，对应 seed 中的 user_<id> |
| `-password` | bench123 | 测试用户密码 |

## 测试流程

1. **Phase 1** — 100 个客户端并发登录，获取 session cookie
2. **Phase 2** — 并发建立 WebSocket 连接，记录连接耗时
3. **Phase 3** — 同步启动：每客户端随机错开 0-1s 相位后，每秒 1 条消息持续 30s，共 3000 条发送
4. **Phase 4** — Oracle 校验：统计丢失/重复，计算三段延迟

## 延迟定义

| 段 | 公式 | 含义 |
|----|------|------|
| Segment 1 | `send_time_ms - send_ts` | 上行 + 服务端处理到落库（仅自收消息） |
| Segment 2 | `recv_ts - send_time_ms` | 落库 → 广播 → 客户端收到 |
| Total | `recv_ts - send_ts` | 端到端总延迟 |

## 消息格式

- 发送内容：`client_<id>_seq_<n>_<random 20-200 bytes>`
- `client_message_id`：`client_<id>_seq_<n>`（用于服务端去重）
- Oracle 从接收内容中解析 `(sender_id, seq)` 做完整性校验

## 预期结果

- 每 (sender_id, seq) 应被 100 个客户端各收到 1 次 = 300,000 条接收
- 发送方自己也会收到广播，算有效接收
