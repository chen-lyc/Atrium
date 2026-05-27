# 实时协议

本文是 Atrium 当前 `/chat` WebSocket 协议的主文档，依据 `src/sub_reactor.cpp`、`src/ai_client.cpp`、`src/deepseek_client.cpp`、`src/qwen_client.cpp` 和 `include/utils.h` 整理。

## 连接建立

客户端先通过 HTTP API 登录或注册，拿到 Cookie：

```http
POST /api/login
Content-Type: application/x-www-form-urlencoded

username=<username>&password=<password>
```

成功时服务端返回：

```http
HTTP/1.1 200 OK
Set-Cookie: session_id=<token>; PATH=/
```

随后用同一个 Cookie 发起 WebSocket Upgrade：

```http
GET /chat HTTP/1.1
Host: <host>
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <base64 nonce>
Sec-WebSocket-Version: 13
Cookie: session_id=<token>
```

成功时返回 `101 Switching Protocols`。认证失败返回 `401 Unauthorized`；握手字段不合法返回 `400 Bad Request`。

握手成功后，服务端会读取该用户加入的所有 room id，并把连接注册到 `ConnRoute` 的 user/room 索引中。

## 消息信封

业务消息使用 WebSocket text frame，payload 为 JSON：

```json
{
  "type": 0,
  "data": {}
}
```

`type` 对应 `chatdb::EventType`：

| 值 | 名称 | 方向 |
|---:|---|---|
| 0 | `UserMsg` | Client -> Server / Server -> Client |
| 1 | `AiStreamStart` | Server -> Client |
| 2 | `AiStreamDelta` | Server -> Client |
| 3 | `AiStreamEnd` | Server -> Client |
| 4 | `AiStreamError` | Server -> Client |
| 5 | `SystemMsg` | 预留枚举，当前 WebSocket 主路径未发送 |

内容类型 `MessageType`：

| 值 | 名称 | 说明 |
|---:|---|---|
| 1 | `TEXT` | 文本 |
| 2 | `IMAGE` | 图片 |
| 3 | `FILE` | 文件 |
| 4 | `SYSTEM` | 系统消息，客户端不可发送 |

## Client -> Server

### type=0 UserMsg

客户端发送用户消息：

```json
{
  "type": 0,
  "data": {
    "room_id": 1,
    "conversation_id": 1,
    "type": 1,
    "content": "hello",
    "client_message_id": "uuid-or-local-id"
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `room_id` | uint64 | 目标房间 ID；当前连接必须已加入该房间 |
| `conversation_id` | uint64 | 目标对话 ID；必须属于 `room_id` |
| `type` | int | `1=TEXT`、`2=IMAGE`、`3=FILE`；不允许发送 `SYSTEM` |
| `content` | string | 消息内容 |
| `client_message_id` | string | 客户端生成的去重 ID |

服务端校验通过后写入 `messages`。如果 `client_message_id` 已存在，后端视作重复提交并静默返回，不再次广播。

## Server -> Client

### type=0 UserMsg

用户消息入库后，服务端向房间内在线连接广播：

```json
{
  "type": 0,
  "data": {
    "room_id": 1,
    "conversation_id": 1,
    "message_id": 101,
    "user_id": 7,
    "username": "alice",
    "type": 1,
    "content": "hello",
    "send_time_ms": 1710000000000,
    "client_message_id": "uuid-or-local-id"
  }
}
```

发送者本人也会收到该广播，前端可用 `client_message_id` 把本地 pending 消息合并为服务端消息。

### type=1 AiStreamStart

AI 第一次产生非空 SSE 内容时，服务端广播流开始事件：

```json
{
  "type": 1,
  "data": {
    "room_id": 1,
    "conversation_id": 1,
    "message_id": 102,
    "avatar_url": "/avatars/deepseek-logo.svg",
    "model": "deepseek-v4-flash",
    "send_time_ms": 1710000000000
  }
}
```

`message_id` 来自预先插入的 hidden AI message，后续 `AiStreamEnd` 会使用同一个 ID。

### type=2 AiStreamDelta

AI SSE 增量内容会被转为 delta：

```json
{
  "type": 2,
  "data": {
    "model": "deepseek-v4-flash",
    "content": "partial text"
  }
}
```

客户端按当前流上下文累加 `content`。

### type=3 AiStreamEnd

AI 完整回复写回数据库后，服务端广播结束事件：

```json
{
  "type": 3,
  "data": {
    "room_id": 1,
    "conversation_id": 1,
    "message_id": 102,
    "user_id": 30,
    "sender_type": "ai",
    "display_name": "deepseek",
    "avatar_url": "/avatars/deepseek-logo.svg",
    "type": 1,
    "content": "full answer",
    "send_time_ms": 1710000001000,
    "provider": "deepseek",
    "model": "deepseek-v4-flash"
  }
}
```

### type=4 AiStreamError

AI 请求失败或 quota 超限时，服务端广播错误事件：

```json
{
  "type": 4,
  "data": {
    "room_id": 1,
    "conversation_id": 1,
    "user_id": 30,
    "sender_type": "ai",
    "display_name": "deepseek",
    "avatar_url": "/avatars/deepseek-logo.svg",
    "provider": "deepseek",
    "model": "deepseek-v4-flash",
    "error": "QuotaExceeded"
  }
}
```

`error` 当前来自后端内部状态名，例如 `NetworkError`、`Unauthorized`、`ServerError`、`QuotaExceeded`。

## `<NO_REPLY>` 语义

旧文档曾写过服务端会向客户端推送原始文本 `"<NO_REPLY>"`。这已经不是当前后端契约。

当前实现中，`AiClient` 会在 SSE 开始阶段短暂缓冲内容，用于识别模型输出的 `<NO_REPLY>` token。如果最终状态是 `AiClientStatus::NoReply`，`AiReplyTask::process()` 直接返回：

- 不发送 `AiStreamStart`
- 不发送 `AiStreamDelta`
- 不发送 `AiStreamEnd`
- 不发送普通消息
- 不发送原始 `"<NO_REPLY>"` 文本帧

因此客户端应把无回复理解为“没有流事件发生”，而不是等待一个特殊普通消息。

## 心跳

客户端可发送 WebSocket PING 帧（opcode `0x9`），服务端回复 PONG 帧（opcode `0xA`），payload 原样返回。PING/PONG 不经过 JSON 信封，是标准 WebSocket 控制帧。

## 连接关闭

客户端可发送 WebSocket CLOSE 帧（opcode `0x8`）主动关闭。服务端收到后回复 CLOSE 帧（payload 前 2 字节为 status code `0x03E8` = 1000 Normal Closure），随后关闭 TCP 连接。

服务端也可能主动发送 CLOSE 帧后关闭连接，触发场景包括协议错误（status code `0x03EA` = 1002 Protocol Error）或服务端内部错误（status code `0x03F3` = 1011 Server Error）。

连接关闭后，服务端自动清理 ConnRoute 中的用户/房间索引，并从房间广播目标中移除该连接。

## 广播语义

用户消息和 AI 流事件都按房间广播：

1. 服务端通过 `ConnRoute::queryByRoom(room_id)` 找到房间内所有在线连接。
2. WebSocket frame 被封装为 `shared_ptr<const string>`。
3. 每个目标 SubReactor 收到 broadcast queue 通知后，把同一只读 frame 写入对应连接的 outbuf。

房间成员变化也会通过 SubReactor 的 room-membership 队列同步连接索引，例如接受邀请加入房间、退出房间、房间删除。

## AI 调度语义

用户消息触发当前对话绑定的 AI 阵容。每个 AI 的任务由 `ConvAiScheduler` 串行化，避免同一 conversation + AI 并发生成互相覆盖。AI 成功完成后，后端最多继续调度其他 AI 进行两轮接力式回应。

如果对应 provider 的环境变量不存在，例如 `DEEPSEEK_API_KEY` 或 `QWEN_API_KEY` 为空，该 AI 不会被调度。
