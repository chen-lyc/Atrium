# API 参考

本文按 `src/http_route.cpp` 的 Router 注册表整理当前业务 API。所有路径都以 `/api` 为前缀。

当前注册表共有 42 个业务 API：`GET` 17 个、`POST` 8 个、`PATCH` 8 个、`DELETE` 9 个。另有 17 个 `HEAD` 变体与对应 `GET` 复用同一 handler，只返回响应头，不返回 JSON body。

除 `POST /api/login` 和 `POST /api/register` 外，其余业务接口都需要 Cookie `session_id`。认证失败返回 `401 Unauthorized`。

## 通用约定

- 登录注册使用 `application/x-www-form-urlencoded`：`username=<name>&password=<password>`。
- 其他写接口使用 `application/json`。
- 成功响应为 `200 OK`，Content-Type 为 `application/json; charset=utf-8`。
- 成功写入但无需返回数据时，响应体为空（`Content-Length: 0`）。
- `RoomRole`：`0=owner`，`1=admin`，`2=member`。
- `RoomType`：`0=Atrium 大厅`，`1=个人讨论室`，`2=普通房间`。

### 错误响应

除登录注册外，多数业务校验失败统一返回 `400 Bad Request`；未登录返回 `401 Unauthorized`；API 不存在返回 `404 api route not found`（body 为 `"api route not found"`）；服务端/数据库错误返回 `500 Internal Server Error`。

## 身份与当前用户

| 方法 | 路径 | Body / Query | 说明 |
|---|---|---|---|
| `POST` | `/api/login` | form: `username`, `password` | 登录，成功后写 `Set-Cookie: session_id=...; PATH=/` |
| `POST` | `/api/register` | form: `username`, `password` | 注册，自动加入 Atrium 大厅并创建个人讨论室，成功后写 session cookie |

登录注册的错误响应（`Content-Type: text/plain; charset=utf-8`）：

| 状态码 | body | 触发条件 |
|---|---|---|
| `400 Bad Request` | `missing username or password` | 缺少 username 或 password 参数 |
| `400 Bad Request` | `invalid_username` | 用户名格式不合法 |
| `400 Bad Request` | `invalid_password` | 密码格式不合法 |
| `401 Unauthorized` | `user not found` | 用户名不存在（登录） |
| `401 Unauthorized` | `wrong password` | 密码错误（登录） |
| `409 Conflict` | `username already exists` | 用户名已占用（注册） |
| `500 Internal Server Error` | （空） | 数据库或 Redis 错误 |

| 方法 | 路径 | Body / Query | 说明 |
|---|---|---|---|
| `GET` | `/api/me` | - | 返回 `{user_id, username}` |
| `PATCH` | `/api/me` | `{username?, nickname?, avatar_url?}` | 更新当前用户资料；用户名、昵称、头像 URL 有长度校验 |
| `GET` | `/api/users/search?q=...` | query: `q` | 搜索用户；纯数字按 user id 精确匹配，否则按 nickname / username 模糊匹配，最多 20 条 |

## 房间与对话

| 方法 | 路径 | Body / Query | 说明 |
|---|---|---|---|
| `GET` | `/api/rooms` | - | 返回当前用户可见房间；若缺少初始化房间，会补加入大厅并创建个人讨论室 |
| `POST` | `/api/rooms` | `{room_name}` | 创建普通房间，返回 `{room_id, main_conversation_id}` |
| `PATCH` | `/api/rooms/:room_id` | `{name}` | 房主修改房间名 |
| `DELETE` | `/api/rooms/:room_id` | - | 房主删除普通房间；大厅和个人讨论室不可删 |
| `GET` | `/api/rooms/:room_id/conversations` | - | 列出房间内对话，包含 `main_conversation_id` |
| `POST` | `/api/rooms/:room_id/conversations` | `{title, ai_members?}` | 房间成员创建对话；普通房间可创建，大厅不可创建 |
| `PATCH` | `/api/conversations/:conv_id/title` | `{title}` | 房间成员重命名对话 |
| `DELETE` | `/api/conversations/:conversation_id` | - | 创建者、房主或 admin 删除非主对话 |
| `GET` | `/api/conversations/:conversation_id/messages?before_time=...&before_id=...&limit=...` | query | 分页读取消息；首次读取传 `limit`，翻页同时传 `before_time` 与 `before_id` |
| `DELETE` | `/api/messages/:message_id` | - | 发送者可在 2 分钟内软删除自己的消息 |
| `GET` | `/api/conversations/:conversation_id/model` | - | 返回当前对话默认展示模型 `{provider, model}`；没有则为空字符串 |

## 房间成员与邀请

| 方法 | 路径 | Body / Query | 说明 |
|---|---|---|---|
| `GET` | `/api/rooms/:room_id/members` | - | 房间成员列表 |
| `PATCH` | `/api/rooms/:room_id/members/:user_id` | `{role}` | 房主设置成员为 admin/member；不能改自己 |
| `DELETE` | `/api/rooms/:room_id/members/:user_id` | - | 删除自己为退出普通房间；owner/admin 可移除他人，不能移除 owner |
| `POST` | `/api/rooms/:room_id/invitations` | `{invitee_id}` | 房间成员邀请好友加入；个人讨论室不可邀请 |
| `GET` | `/api/rooms/:room_id/invitations` | - | 房间内待处理邀请列表 |
| `GET` | `/api/invitations?direction=received\|sent` | query | 当前用户收到或发出的房间邀请 |
| `PATCH` | `/api/invitations/:invitation_id` | `{status: "accepted" \| "rejected"}` | 被邀请人接受或拒绝；接受后加入房间并通知在线连接 |
| `DELETE` | `/api/invitations/:invitation_id` | - | 邀请人撤回邀请 |

## 好友关系

| 方法 | 路径 | Body / Query | 说明 |
|---|---|---|---|
| `GET` | `/api/friends` | - | 好友列表 |
| `DELETE` | `/api/friends/:user_id` | - | 删除好友关系 |
| `POST` | `/api/friend-requests` | `{to_user_id}` | 发送好友申请；若对方已反向申请，则直接成交好友关系 |
| `GET` | `/api/friend-requests?direction=received\|sent` | query | 收到或发出的好友申请 |
| `PATCH` | `/api/friend-requests/:request_id` | `{status: "accepted" \| "rejected"}` | 接受或拒绝好友申请 |
| `DELETE` | `/api/friend-requests/:request_id` | - | 申请发起人撤回好友申请 |

## AI 阵容与用量

| 方法 | 路径 | Body / Query | 说明 |
|---|---|---|---|
| `GET` | `/api/ais` | - | 列出系统注册的 AI：`id/provider/model/display_name/avatar_url` |
| `GET` | `/api/thinking-adapters` | - | 列出可选 thinking adapter 名称 |
| `GET` | `/api/rooms/:room_id/ai-members` | - | 读取房间默认 AI 阵容 |
| `POST` | `/api/rooms/:room_id/ai-members` | `{ai_id, adapter_url?, custom_adapter_text?}` | owner/admin 添加房间默认 AI |
| `PATCH` | `/api/rooms/:room_id/ai-members/:ai_id` | `{adapter_url?, custom_adapter_text?}` | owner/admin 更新房间 AI 的 adapter |
| `DELETE` | `/api/rooms/:room_id/ai-members/:ai_id` | - | owner/admin 移除房间默认 AI |
| `GET` | `/api/conversations/:conv_id/ai-members` | - | 读取对话级 AI 阵容 |
| `POST` | `/api/conversations/:conv_id/ai-members` | `{ai_id, adapter_url?, custom_adapter_text?}` | 对话创建者、owner 或 admin 添加对话 AI；大厅和主对话不可直接改 |
| `PATCH` | `/api/conversations/:conv_id/ai-members/:ai_id` | `{adapter_url?, custom_adapter_text?}` | 更新对话 AI adapter；权限同上 |
| `DELETE` | `/api/conversations/:conv_id/ai-members/:ai_id` | - | 移除对话 AI；权限同上 |
| `GET` | `/api/me/ai-usage` | - | 返回当前用户按模型/日期聚合的 token 用量 |
| `GET` | `/api/me/ai-usage/today` | - | 返回当前用户今日 token 用量 |

## HEAD 变体

以下 `GET` 路由也注册了 `HEAD`。handler 会计算与 `GET` 相同的响应头和 `Content-Length`，但不写 body。

| HEAD 路径 |
|---|
| `/api/me` |
| `/api/me/ai-usage` |
| `/api/me/ai-usage/today` |
| `/api/users/search?q=...` |
| `/api/rooms` |
| `/api/rooms/:room_id/conversations` |
| `/api/conversations/:conversation_id/messages?before_time=...&before_id=...&limit=...` |
| `/api/conversations/:conversation_id/model` |
| `/api/rooms/:room_id/members` |
| `/api/rooms/:room_id/invitations` |
| `/api/invitations?direction=received\|sent` |
| `/api/friend-requests?direction=received\|sent` |
| `/api/friends` |
| `/api/ais` |
| `/api/thinking-adapters` |
| `/api/rooms/:room_id/ai-members` |
| `/api/conversations/:conv_id/ai-members` |

## WebSocket 不在本表

实时聊天不是 `/api` 路由，而是 `GET /chat` WebSocket Upgrade。消息格式、AI 流事件和广播语义见 [实时协议](REALTIME_PROTOCOL.md)。
