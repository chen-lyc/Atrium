# Atrium WebSocket 协议文档

## 连接建立

### 1. 认证

先通过 HTTP 登录获取 session cookie：

```
POST /api/login
Content-Type: application/x-www-form-urlencoded

username=<username>&password=<password>

Response:
HTTP/1.1 200 OK
Set-Cookie: session_id=<token>; PATH=/
```

之后所有请求（包括 WebSocket 升级）携带 `Cookie: session_id=<token>`。

### 2. WebSocket 握手

```
GET /chat
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <24-char base64, ends with ==>
Sec-WebSocket-Version: 13
Cookie: session_id=<token>

Response:
HTTP/1.1 101 Switching Protocols    (认证成功)
HTTP/1.1 401 Unauthorized            (token 过期)
```

### 3. 心跳

- Client → Server: WebSocket PING frame (opcode 0x9)
- Server → Client: WebSocket PONG frame (opcode 0xA)

---

## 消息信封

所有 WebSocket 消息（收发均如此）使用 JSON 文本帧（opcode 0x1）：

```json
{
  "type": <int>,    // 事件类型，见下表
  "data": { ... }   // 各类型 payload
}
```

另有特殊原始文本 `"<NO_REPLY>"` 从服务端推送，表示 AI 无回复，客户端静默忽略。

---

## 一、Client → Server（发消息）

仅一种消息类型。

### type=0 用户聊天消息

```json
{
  "type": 0,
  "data": {
    "room_id":           "<uint64>",
    "conversation_id":   "<uint64>",
    "type":              1 | 2 | 3,
    "content":           "<string>",
    "client_message_id": "<string>"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `room_id` | uint64 | 目标房间 ID |
| `conversation_id` | uint64 | 目标会话 ID（必须属于该房间） |
| `type` | int | 消息内容类型：1=TEXT, 2=IMAGE, 3=FILE；不允许 4=SYSTEM |
| `content` | string | 消息内容 |
| `client_message_id` | string | 客户端生成的唯一 ID（UUID），服务端用于去重 |

---

## 二、Server → Client（收消息）

### type=0 UserMsg（用户消息广播）

当任何用户发送消息后，广播给房间内所有 WebSocket 连接。

```json
{
  "type": 0,
  "data": {
    "room_id":            "<uint64>",
    "conversation_id":    "<uint64>",
    "message_id":         "<uint64>",
    "user_id":            "<uint64>",
    "username":           "<string>",
    "type":               1 | 2 | 3,
    "content":            "<string>",
    "send_time_ms":       "<uint64>",
    "client_message_id":  "<string>"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `room_id` | uint64 | 房间 ID |
| `conversation_id` | uint64 | 会话 ID |
| `message_id` | uint64 | 服务端自增消息 ID（MySQL AUTO_INCREMENT） |
| `user_id` | uint64 | 发送者用户 ID |
| `username` | string | 发送者用户名 |
| `type` | int | 内容类型：1=TEXT, 2=IMAGE, 3=FILE |
| `content` | string | 消息内容 |
| `send_time_ms` | uint64 | 服务端写入时的时间戳（epoch 毫秒） |
| `client_message_id` | string | 发送方客户端生成的去重 ID |

### type=1 AiStreamStart（AI 开始生成）

```json
{
  "type": 1,
  "data": {
    "room_id":         "<uint64>",
    "conversation_id": "<uint64>",
    "message_id":      "<uint64>",
    "avatar_url":      "<string>",
    "model":           "<string>",
    "send_time_ms":    "<uint64>"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `room_id` | uint64 | 房间 ID |
| `conversation_id` | uint64 | 会话 ID |
| `message_id` | uint64 | AI 消息 ID（hidden message，插入时内容为空） |
| `avatar_url` | string | AI 头像 URL |
| `model` | string | 模型名称，如 `deepseek-v4-flash` |
| `send_time_ms` | uint64 | 时间戳 |

若 `data` 中包含字符串 `"<NO_REPLY>"`，表示 AI 决定不回复，客户端应丢弃此流。

### type=2 AiStreamDelta（AI 增量输出）

```json
{
  "type": 2,
  "data": {
    "model":   "<string>",
    "content": "<string>"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | string | 模型名称 |
| `content` | string | 增量文本片段，客户端累加拼接为完整回复 |

### type=3 AiStreamEnd（AI 生成完成）

```json
{
  "type": 3,
  "data": {
    "room_id":         "<uint64>",
    "conversation_id": "<uint64>",
    "message_id":      "<uint64>",
    "user_id":         "<uint64>",
    "sender_type":     "ai",
    "display_name":    "<string>",
    "avatar_url":      "<string>",
    "type":            1,
    "content":         "<string>",
    "send_time_ms":    "<uint64>",
    "provider":        "<string>",
    "model":           "<string>"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `room_id` | uint64 | 房间 ID |
| `conversation_id` | uint64 | 会话 ID |
| `message_id` | uint64 | AI 消息 ID（同 AiStreamStart） |
| `user_id` | uint64 | AI 在系统中的 user_id |
| `sender_type` | string | 固定 `"ai"` |
| `display_name` | string | AI 显示名称 |
| `avatar_url` | string | AI 头像 URL |
| `type` | int | 固定 1=TEXT |
| `content` | string | 完整回复文本 |
| `send_time_ms` | uint64 | 时间戳 |
| `provider` | string | AI 厂商，如 `deepseek` |
| `model` | string | 模型名称 |

若 `content` 为 `"<NO_REPLY>"`，客户端应移除该消息。

### type=4 AiStreamError（AI 生成失败）

```json
{
  "type": 4,
  "data": {
    "room_id":         "<uint64>",
    "conversation_id": "<uint64>",
    "model":           "<string>"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `room_id` | uint64 | 房间 ID |
| `conversation_id` | uint64 | 会话 ID |
| `model` | string | 出错的模型名称 |

---

## 三、广播机制

- 所有 Server→Client 消息均为**房间级广播**
- 服务端通过 `room_members` 表查房间所有成员，再通过 `ConnRoute` 找到每个成员当前连接的 reactor/fd，逐条发送
- 发送方本人也会收到自己的广播（客户端通过 `client_message_id` 匹配去重）

---

## 四、枚举速查

### EventType（消息信封 type）

| 值 | 名称 | 方向 |
|----|------|------|
| 0 | UserMsg | S→C |
| 1 | AiStreamStart | S→C |
| 2 | AiStreamDelta | S→C |
| 3 | AiStreamEnd | S→C |
| 4 | AiStreamError | S→C |

### MessageType（内容 type）

| 值 | 名称 | 说明 |
|----|------|------|
| 1 | TEXT | 文本 |
| 2 | IMAGE | 图片 |
| 3 | FILE | 文件 |
| 4 | SYSTEM | 系统消息（客户端不可发送） |
