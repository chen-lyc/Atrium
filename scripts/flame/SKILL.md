---
name: flame-bench-script
description: 维护和扩展 scripts/flame/api_flame_bench.sh 压测脚本。当需要新增 API、修改种子数据、调整压测参数、或排查脚本问题时触发。Triggers on "加一个API压测", "改压测脚本", "flame bench", "bench 脚本", or when modifying api_flame_bench.sh.
---

# Flame Bench Script 维护指南

> 脚本位置: `scripts/flame/api_flame_bench.sh`
> 依赖: `oha`, `perf`, `FlameGraph`, `sudo mysql`, `curl`, `jq`

## 1. 脚本结构（五阶段）

```
1. 登录 & 参数获取 → COOKIE, USER_ID, ROOM_ID, CONV_ID
2. 种子数据       → FRIEND_ID, FR_ID, INV_ID, 消息, AI usage
3. Warmup         → 预热 10s
4. 压测循环       → 43 个 API 逐一 perf + oha
5. Cleanup (trap) → 删除所有 bench 数据
```

## 2. API 格式

```
"name|METHOD|path|qs|body|ct"
```

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 唯一标识，用于文件名 | `me` |
| `METHOD` | HTTP 方法 | `GET`, `POST`, `PATCH`, `DELETE` |
| `path` | URL 路径，可用 `${VAR}` | `/api/me` |
| `qs` | query string（含 `?`），无则空 | `?limit=50` |
| `body` | 请求体，无 body 填 `-` | `{"nickname":"test"}` |
| `ct` | Content-Type: `json` / `form` / `-` | `json` |

### 添加新 API

在 `APIS=(...)` 数组中按分类插入：

```bash
"new-get|GET|/api/endpoint||-|-"                      # 无参数 GET
"new-post|POST|/api/things||{\"key\":\"val\"}|json"    # JSON POST
"new-form|POST|/api/auth||user=foo&pass=bar|form"      # 表单 POST
```

需要鉴权的 API 已在循环中自动带 `${COOKIE}`。依赖动态 ID 时用变量引用（如 `${FRIEND_ID}`）。

## 3. 种子数据

种子阶段（Warmup 之前）为「需要真实数据才有意义」的 API 准备数据：

| 数据 | 创建方式 | 用途 |
|------|---------|------|
| `FRIEND_ID` | API: register + login | 好友相关 API 的目标用户 |
| `FR_ID` | API: POST /friend-requests | friend-requests-respond/cancel 的 ID |
| 好友关系 | API: PATCH accept | friends-list/delete 有数据 |
| `INV_ID` | API: POST /rooms/:id/invitations | invitations-respond/cancel 的 ID |
| 消息 | SQL: INSERT INTO messages | conv-messages 返回 50 条 |
| AI usage | SQL: INSERT INTO ai_usage | me-ai-usage 有数据 |

### 添加新种子

在种子阶段追加（约第 137 行附近）：

```bash
# 示例：为 room-members API 准备多个成员
if [ "$ROOM_ID" != "0" ] && [ "$FRIEND_ID" != "0" ]; then
  $MYSQL -e "INSERT IGNORE INTO room_members (room_id, user_id, role, join_at_ms)
    VALUES (${ROOM_ID}, ${FRIEND_ID}, 2, $(date +%s)000)" 2>/dev/null || true
fi
```

## 4. 清理逻辑

`cleanup_seed()` 在 `trap EXIT` 时执行。分四层，FK 约束先子后父：

1. AI 成员 — `room_ai_members`, `conversation_ai_members` WHERE ai_id=99999
2. bench-tmp 房间级联 — conversations → messages → room_members → invitations → rooms
3. 种子用户关联 — friendships, friend_requests, room_members, invitations, ai_usage, users, participants
4. 种子消息 — messages WHERE client_message_id LIKE 'bench_%'

### 扩展清理

```bash
$MYSQL -e "DELETE FROM new_child WHERE ..." 2>/dev/null || true
$MYSQL -e "DELETE FROM new_parent WHERE ..." 2>/dev/null || true
```

## 5. 关键变量

| 变量 | 来源 | 默认值 | 说明 |
|------|------|--------|------|
| `CONC` | 脚本顶部 | `20` | oha 并发，原 8 太低、100 太高会 bcrypt 挤占火焰图 |
| `PID` | `fuser 8080/tcp` | — | 只取 worker，跳过守护进程 |
| `TEST_USER/PASS` | 脚本顶部 | `test/123` | 需数据库中存在且有房间 |
| `MYSQL` | 脚本顶部 | `sudo mysql webserver` | 云服务器用 socket 认证 |

## 6. 清理机制

> **血的教训**: `|| true` 会静默吞掉所有 FK 删除失败，数据库在几轮压测后就膨胀到 10 万+ 行。

### 6.1 清理原则

1. **一处维护**: 所有清理走 `cleanup_db.sql`，不在脚本里散落 SQL
2. **FK 顺序**: 先删子表再删父表（messages → conversations → rooms）
3. **第二轮孤儿清理**: 父表删完后检查残留的子表行（room_members.room_id 不存在于 rooms 等）
4. **禁止 `|| true`**: 删除失败必须暴露

### 6.2 清理时机

| 时机 | 调用的函数 | 说明 |
|------|-----------|------|
| 脚本启动 | `pre_cleanup()` | 清理上次异常退出残留 |
| 每个创建类 API 后 | `case rooms-create/room-convs-create/room-ai-create/conv-ai-create` | 防止数据库在单次运行中膨胀 |
| 脚本退出 | `cleanup_seed()` → `cleanup_seed_data()` | trap EXIT，确保退出时清干净 |

### 6.3 涉及的 14 张表

participants, users, ai, rooms, room_members, conversations, conversation_ai_members, room_ai_members, messages, friendships, invitations, friend_requests, ai_usage, user_ai_tokens

## 7. 踩坑记录

| 症状 | 根因 | 修复 |
|------|------|------|
| 火焰图空白（0.013MB） | 缺 `-e cpu-clock`，默认硬件事件采不到 I/O 等待进程 | perf 固定加 `-e cpu-clock` |
| 云服务器 perf 空白 | `perf_event_paranoid=4` 禁用采样 | 脚本启动时 `sudo sysctl kernel.perf_event_paranoid=1`，退出恢复 |
| login 火焰图全是 crypto | CONC 太高，bcrypt 挤占比 | CONC 降到 20（火焰图用）；简历压测单独跑 clean pass |
| 脚本只跑 1 个 API | `set -e` + perf 后台非零退出码 | 改为 `set -uo pipefail` |
| register 后数据库脏 | 脚本被 Ctrl+C 在 cleanup 前 | 启动时执行 `pre_cleanup()` |
| 邀请 400 | invitee 已在房间中 | 种子单独创建 Normal 房间 |
| MySQL Access denied | `-u lyc -p -h 127.0.0.1` 不走 socket | 改用 `sudo mysql` |
| login/register Content-Type 错误 | 表单 body 配 `application/json` 头 | 新增 `ct` 字段区分 json/form |
| 火焰图部分 API "SKIP: no perf data" | 服务 SIGSEGV 重启，`$PID` 指向旧进程 | 每次循环重新检测 PID |
| 数据库膨胀 RPS 越来越低 | `|| true` 吞掉 FK 删除失败，`rooms-create` 每次跑建上千条房间 | 统一走 `cleanup_db.sql`，循环内即时清理，去掉 `|| true` |
| pidof 返回两个 server.out | 守护进程 + worker | `fuser 8080/tcp | grep -o '[0-9]\+' | head -1` 只取监听端口的 worker
| room=0 | `/api/me` 不返回 rooms | 改用 `/api/rooms` |
| MySQL Access denied | `-u lyc -p -h 127.0.0.1` 不走 socket | 改用 `sudo mysql` |
| login/register Content-Type 错误 | 表单 body 配 `application/json` 头 | 新增 `ct` 字段区分 json/form |

## 7. 新环境检查清单

```bash
command -v oha && command -v perf && command -v jq
ls ~/FlameGraph/flamegraph.pl ~/FlameGraph/stackcollapse-perf.pl
sudo mysql webserver -e "SELECT 1"
sudo fuser 8080/tcp
```
