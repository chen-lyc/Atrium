# 后端架构

Atrium 后端的运行时实现细节。接口契约见 [API 参考](API_REFERENCE.md)，WebSocket 协议见 [实时协议](REALTIME_PROTOCOL.md)，数据库 DDL 见 [schema.sql](../database/schema.sql)。

## 进程模型

服务以守护进程模式运行。父进程只做一件事：`fork()` 后 `waitpid()`。子进程正常退出（`WIFEXITED`）→ 父进程停止。子进程被信号杀死（`WIFSIGNALED`）→ 父进程自动重启。

子进程持有两个监听 socket：8080（HTTP/WebSocket）和 9090（protobuf 旧协议）。信号通过全局 `stopfd`（eventfd）从信号处理器传入 MainReactor 的 epoll 循环。

## Reactor 线程模型

### MainReactor

单线程。epoll 监听三类 fd：
- `stopfd`：收到事件则设置 `m_running = false`，退出循环
- HTTP listen fd / Protobuf listen fd：`accept()` 循环直到 `EAGAIN`，拿到 `conn_fd` 后 **round-robin** 选择目标 SubReactor，调用 `addConnection(conn_fd, protocol_type)`

MainReactor 构造时还会初始化 AI ThreadPool（默认 8 线程，队列上限 10000）并调用 `DeepSeek::init()` / `Qwen::init()` 完成模型注册。

### SubReactor

`Reactor` 类，默认创建 5 个实例。构造时立即启动独立线程执行 `loop()`。

每个 SubReactor 持有：
- 自己的 `epollfd`
- `TimerHeap`：空闲连接超时管理
- `MemoryPool`：Connection 对象复用
- `http::Router`：API 路由表（每个 SubReactor 独立一份）
- `m_conns`：`fd → unique_ptr<Connection>` 的 unordered_map

### 三条 eventfd 通道

跨 Reactor 通信全部走 eventfd + 队列 swap 模式：

| 通道 | eventfd | 队列 | 用途 |
|---|---|---|---|
| 新连接 | `m_conn_notifyfd` | `m_conn_queue` | MainReactor 分发新 fd |
| 广播 | `m_broadcast_notifyfd` | `m_broadcast_queue` | 跨 Reactor 房间消息广播 |
| 房间成员 | `m_room_membership_notifyfd` | `m_room_membership_queue` | 加入/退出房间时同步 ConnRoute |

**通用模式**：生产者 `lock → queue.emplace() → unlock → write(eventfd, 1)`。消费者被 epoll 唤醒后 `read(eventfd)` 消耗事件，然后 `lock → queue.swap(local) → unlock`，在局部队列上批量处理。swap 在锁内完成，实际处理在锁外，竞争窗口最小化。

### epoll ET 模式

所有 fd 注册为 `EPOLLET | EPOLLIN`（边缘触发）。读循环持续 `recv()` 直到返回 `EAGAIN`/`EWOULDBLOCK`，确保一次事件通知清空内核读缓冲区。写入阻塞时动态切换到 `EPOLLET | EPOLLIN | EPOLLOUT`，写完恢复。

### 定时器与空闲断开

`TimerHeap` 是最小堆，按 `expire_time` 排序。`epoll_wait` 超时参数 = 堆顶到期时间（毫秒级）。

- HTTP / Protobuf 连接：6 秒无活动断开
- WebSocket 连接：60 秒无活动断开

每次收到数据时 `TimerHeap::update(fd, timeout)` 刷新过期时间。超时时连接被关闭，ConnRoute 索引同步清理。

### Connection 对象池

`MemoryPool` 预分配 `Connection` 结构体的内存块。使用侵入式自由链表：已释放的 Connection 内存被复用为 next 指针，不需要额外分配链表节点。通过 `unique_ptr<Connection, ConnDeleter>` RAII 归还。

初始分配 100 个，耗尽时翻倍扩容。

## HTTP 路径

### 请求解析

`checkHttpFrame()` 先找 `\r\n\r\n` 定位头结束，再找 `Content-Length` 头验证体完整性。只有完整帧才进入 `process()`。

`parseHttpRequest()` 逐行解析：请求行（Method + target + version）→ 头部（Host, Connection, Content-Type, Content-Length, Upgrade, Sec-WebSocket-*, Cookie）→ 体。

Cookie 解析支持标准 `key=value; key=value` 格式，只提取 `session_id`。

### 路由分发

`process()` 中按目标分流：

1. **WebSocket 升级**：`Upgrade: websocket` + `Connection: upgrade` + `GET /chat` + `Sec-WebSocket-Version: 13` → SHA1(key + magic GUID) 计算 Accept → session 校验 → 查询用户 room_ids 写入 ConnRoute → 返回 101 + `Sec-WebSocket-Accept`。协议切换为 `PROTO_WEBSOCKET`，超时调整为 60s。

2. **API 路由**：`/api/*` → `http::Router::find_route()`。路径按 `/` 分段匹配，`:param` 段为路径参数（如 `:room_id`）。42 个业务 handler + 17 个 HEAD 变体（与 GET 共用 handler，只返回头）。需要登录的路由先通过 Cookie `session_id` 查 Redis，失败返回 401。

3. **静态文件**：`GET` / `HEAD` 非 API 路径 → `static/<path>` 文件查找。`..` 穿越防护。SPA fallback：`/`, `/login`, `/register`, `/chat` 四个路径统一返回 `static/index.html`。

4. **echo 端点**：`GET /echo` / `HEAD /echo` 回显请求体。

### 静态文件发送

HTTP 响应头（状态行 + Content-Type + Content-Length）先写入 `outbuf` 通过 `send()` 发出。文件正文通过 `sendfile()` 从文件 fd 直接拷贝到 socket fd，不走用户态缓冲区。

`sendfile()` 阻塞时保留 `file_offset`，注册 EPOLLOUT，下次可写时从中断点继续。文件发完或出错后 `close(file_fd)`。

### MIME 类型

按文件扩展名查表：html/css/js/json/png/jpg/jpeg/svg/ico，其余为 `application/octet-stream`。

### API 鉴权

除 `/api/login` 和 `/api/register` 外，所有 API handler 标记 `need_auth = true`。Router 调度前先调 `get_session()`：从 Cookie 取 `session_id` → Redis `GET session:<token>` → 返回 `user_id` 和 `username`。失败按原因返回 401（过期）/ 400（格式错误）/ 500（Redis 不可达）。

### 路由匹配

`parse_request_line()` 将 `/api/rooms/42/members?limit=10` 解析为 `segments = ["rooms", "42", "members"]`（去掉 `api` 前缀和 query string）。`Router::match()` 逐段比对：`:` 前缀段为路径参数存入 `PathParams`，其他段等值匹配。

## WebSocket 路径

### 帧解析

`checkWebSocketFrame()` 先读 2 字节头，扩展 16/64 位 payload length，跳过 4 字节 mask key，校验完整 payload。最大帧 1MB。

`parseWebSocketFrame()` 解析 opcode（只接受 TEXT/CLOSE/PING/PONG，不支持 CONTINUATION 分片帧），掉 mask，异或解码 payload。

### 消息处理

收到 `WS_TEXT` 帧后：

1. JSON 解析信封，提取 `room_id`, `conversation_id`, `type`, `content`, `client_message_id`
2. 校验当前连接是否属于目标 room
3. 校验 conversation 是否属于该 room
4. `insert_message()` 写 MySQL，`client_message_id` 重复则静默返回（不重复广播）
5. `ConnRoute::queryByRoom(room_id)` 获取房间内所有在线连接
6. 构造 WebSocket TEXT 帧（`UserMsg` event），作为 `shared_ptr<const string>` 通过 `enqueueBroadcast()` 分发到各目标 SubReactor
7. 遍历对话 AI 阵容，对每个有 API key 的 AI 调 `ConvAiScheduler::submit()` 触发回复

`WS_CLOSE` 帧回复 Close 帧后标记 `shouldClose`。`WS_PING` 回复 PONG 帧（原样 payload）。

### 广播机制

广播帧是 `shared_ptr<const string>`，同一个字符串对象被所有目标 reactor 引用，零拷贝共享。

目标 SubReactor 的 `broadcast_notifyfd` 被唤醒后，swap 广播队列到局部变量，遍历每个 task：校验 fd 仍在且仍是 WebSocket 连接且仍在房间内 → `outbuf += frame` → `trySend()`。

### 房间成员同步

当 HTTP API 触发成员变更（接受邀请加入房间、退出房间），handler 返回 `MembershipAction::Join/Leave` 及 `affected_user_ids`。`process()` 通过 `ConnRoute::queryByUser()` 找到受影响用户的在线连接，构造 `RoomMembershipUpdata`，通过 `enqueueRoomMembership()` 分发到各 SubReactor。

目标 SubReactor 处理时：join 则将 `room_id` 写入连接的 `room_ids` 集合并向 ConnRoute 注册；leave 则从集合删除并从 ConnRoute 移除。

## AI 流式回复

### 调度器：ConvAiScheduler

Singleton，per-(conversation_id, ai_id) 串行化。同一对话+AI 组合同时只允许一个任务运行。

`submit()` 逻辑：
- AI 空闲 → 立即执行
- AI 运行中 → pending（用户消息可覆盖已有 pending，AI 触发的 relay 不覆盖）
- AI 已标记失败 → 跳过

`finish()` 逻辑：有 pending 则执行，无则标记 idle。通过 `ConvAiTaskGuard` RAII 保证 `finish()` 一定被调用（即使异常）。

### 任务触发

SubReactor 处理 WebSocket 用户消息后，遍历对话 AI 阵容。AI scheduler callback 中：

1. `insert_hidden_message()` 写入一条 `send_id=ai_id` 的 hidden message，获得 `ai_message_id`
2. 构造 `AiReplyTask`，入队 `ThreadPool<AiReplyTask>`

### AiReplyTask::process()

在 AI ThreadPool 线程中执行：

1. 检查 API key 环境变量
2. `AiClient::chat()` 发起 SSE 请求
3. 通过 `onChunk` 回调接收增量数据 → `broadcastAiReply()` 推送到房间
4. 返回状态处理：
   - **NoReply**：静默返回，不发送任何帧，不写数据库
   - **Error**：广播 `AiStreamError`，标记 scheduler failed。NetworkError 允许重试一次（仅首轮）
   - **Success**：`complete_message_content()` 写完整回复到 hidden message，广播 `AiStreamEnd`，调用 `dispatchToOtherAis()`

### NO_REPLY 检测

SSE 流的前 30 个字符被缓冲（`pending`），在缓冲区内查找 `<NO_REPLY>` token。找到则静默跳过——不发送 `AiStreamStart`/`Delta`/`End`，前端无感知。缓冲超过 30 字符未匹配，将缓冲内容作为首个 delta 发出，后续正常流式输出。

30 字符的窗口覆盖了 Qwen 等模型可能吐出的 `<tool_call>\n<NO_REPLY>`（22 字符）。

### AiClient::chat()

通用实现（`ai_client.cpp`）：
1. 模型名 → ai_id 查表，不存在返回 `ModelNotRegistered`
2. `checkAndIncrementUsage()` 检查每日配额（默认 20 次/天）
3. `getRecentMessages()` 拉取最近 30 条消息历史。AI 的消息 role=`assistant`，用户消息包装为 `[display_name] content`
4. `getSystemPrompt()` 读 AI 的 system_prompt（common.md + adapter.md 拼接）
5. `get_thinking_adapter_for_ai_in_conversation()` 读对话级 thinking adapter
6. 拼接 JSON body，通过 `httplib::SSLClient` POST，Bearer token 鉴权，60s 读超时
7. 流式回调中解析 SSE 事件（`data:...\n\n` 分隔），调虚函数 `parseSseLine()` 由 provider 子类实现

### Provider 差异

**DeepSeek**：
- 端点：`api.deepseek.com/chat/completions`
- Usage 在 `finish_reason=stop` 的最后 chunk 中
- Token 统计：prompt_tokens, completion_tokens, cached_tokens, prompt_cache_hit/miss

**Qwen**：
- 端点：`dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- 配置 `stream_include_usage = true`，usage 出现在 `choices` 为空的独立 chunk 中
- Token 统计：prompt/completion/total，prompt_cache_miss = prompt_tokens（不区分缓存命中）

### 接力回复

`dispatchToOtherAis()`：AI 完成后最多触发 2 轮接力。遍历对话中其他 AI，为每个创建新的 `AiReplyTask` 并入队。每轮 `m_round` 递增，`m_round >= 2` 时停止。

### 用量统计

`checkAndIncrementUsage()` 通过 `ai_usage` 表的 `count` vs `daily_quota` 做每日配额。先查今日记录，不存在则 insert（初始 count=1, quota=20），存在且未超则 `UPDATE count = count + 1 WHERE count < daily_quota`，通过 `affected_rows` 判断是否配额已尽。

Token 明细通过 `accumulate_user_ai_tokens()` 写入 `user_ai_tokens` 表（按 user+model+date 聚合）。

### AI 流事件

AI ThreadPool 线程不直接操作 WebSocket 连接——它们通过 `broadcastAiReply()` 构造 WebSocket 帧，同样走 `ConnRoute::queryByRoom()` + `enqueueBroadcast()` 路径，与用户消息广播共用通道。

事件类型：
- `AiStreamStart`（type=1）：首个非空 SSE 内容到达时发送，含 message_id/avatar/model
- `AiStreamDelta`（type=2）：每片 SSE 内容，前端累加渲染
- `AiStreamEnd`（type=3）：回复写入数据库后发送，含完整内容和 metadata
- `AiStreamError`（type=4）：失败时发送，含 error 状态名

## 连接管理

### ConnRoute（在线索引）

全局 Singleton，维护两组映射：
- `room_id → [(reactor_id, fd)]`：按房间查在线连接，用于广播
- `user_id → [(reactor_id, fd)]`：按用户查在线连接，用于成员变更同步

增删操作在连接建立/断开时调用。移除用 swap-and-pop（O(1)）。两组映射各自独立 mutex。

### 连接关闭

`closeNow(fd)` 执行完整清理：
1. 遍历连接的 `room_ids`，从 ConnRoute 移除每个房间的索引
2. 从 ConnRoute 移除用户索引
3. `epoll_ctl DEL` 从 epoll 移除
4. `TimerHeap::remove()` 取消定时器
5. 从 `m_conns` map 中 erase（触发 `unique_ptr` 析构，归还 MemoryPool）

### trySend()

先发 `outbuf` 中的缓冲数据（`send()`）。`outbuf` 清空后如果 `file_offset < file_size`，继续 `sendfile()` 发送文件正文。

发送阻塞（EAGAIN）时注册 EPOLLOUT，保留发送进度。全部发完后检查关闭条件：`readClosed`（客户端关闭了写端）、`shouldClose`（WebSocket close 帧已发）、`!keepAlive`（HTTP/1.0 或 `Connection: close`）。

## 存储

### MySQL 连接池

min=2, max=8 连接。初始化时建立 min 个连接，失败超过 `3*min` 次则 `m_init_all_fail = true`。

维护线程（`maintainConnections`）：等待 `m_need_refill_cond` 条件变量——低于 min 或有等待者且低于 max 时补充连接。连接风暴失败达到阈值后进入不可达状态 5 秒，通知所有等待者。

连接获取（`MysqlConnGuard` RAII）：队列为空则等待 `m_conn_available_cond`，拿到连接后检查 `isClosed()/isValid()`。归还时检查过期（30 分钟），过期则 `notifyConnectionLost()` 触发补充。

坏连接检测：error code 2006（server gone）/ 2013（lost connection）/ SQLState 08S01 → 丢弃连接。

参数绑定支持：`string`, `uint64_t`, `int`, `Blob`（istringstream 包装）, `nullptr`。`Blob` 用于写入 system_prompt 等大文本。

事务支持：`executeTransaction(callback)` — `setAutoCommit(false)` → 执行 callback（传入 `MysqlTxnContext`） → 成功 commit / 失败 rollback → 恢复 AutoCommit。

批量操作：`executeQuery(sqls, params, results)` — 多条 SQL 在同一连接上顺序执行，任一失败 rollback。

### Redis 连接池

min=4, max=16。hiredis C API，`redisCommandArgv()` 执行。命令失败返回 null 时最多 3 次 `reacquire()`（释放旧连接 + 等待新连接）。Reply 类型：`REDIS_REPLY_STRING`/`ARRAY`/`INTEGER`/`NIL`/`ERROR`。

## 源码索引

| 文件 | 职责 |
|---|---|
| `src/server.cpp` | 守护进程、fork/waitpid、MainReactor 启动 |
| `src/main_reactor.cpp` | accept 循环、SubReactor 分发、AI 初始化 |
| `src/sub_reactor.cpp` | SubReactor 事件循环、协议分发、WebSocket 处理、AI 回调、sendfile |
| `src/http_route.cpp` | `/api/*` Router 注册（59 条路由）、42 个业务 handler 实现 |
| `src/http_codec.cpp` | HTTP 请求解析、帧完整性检查 |
| `src/websocket_codec.cpp` | WebSocket 帧解析、mask 处理 |
| `src/protobuf_codec.cpp` | 旧 protobuf 协议解析（对照路径） |
| `src/ai_client.cpp` | AI 通用逻辑：消息历史、system prompt、SSE 请求、quota、NO_REPLY 检测 |
| `src/deepseek_client.cpp` | DeepSeek provider：模型注册、SSE 解析、usage 提取 |
| `src/qwen_client.cpp` | Qwen provider：模型注册、SSE 解析、usage 提取 |
| `src/connection_route.cpp` | ConnRoute 在线索引、ConvAiScheduler 任务串行化 |
| `src/mysql_pool.cpp` | MySQL 连接池、事务、参数绑定、维护线程 |
| `src/redis_pool.cpp` | Redis 连接池、命令执行、重连 |
| `src/memory_pool.cpp` | Connection 内存池、侵入式自由链表 |
| `src/timerheap.cpp` | 最小堆定时器、空闲连接超时断开 |
| `src/logger.cpp` | 双缓冲异步日志、fork 安全 |

## 编译与启动

```bash
# 前端资源
npm --prefix static install
npm --prefix static run build

# 数据库
mysql -u root -p < database/schema.sql

# 后端
make
./build/server.out 127.0.0.1 8080 9090
```

`9090` 是 protobuf 二进制协议端口；Atrium 浏览器路径使用 `8080` 上的 HTTP API、静态资源与 WebSocket。
