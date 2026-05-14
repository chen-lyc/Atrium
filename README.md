# WebServer

基于 C++20 / Linux 的多 Reactor WebServer，支持静态文件服务、Cookie 会话鉴权、MySQL / Redis 登录注册、WebSocket 聊天与跨 Reactor 广播。

**Live Demo**: `http://lyctalk.com/`  

## 架构

```
                     ┌─────────────────────────┐
                     │     守护进程 (Daemon)     │
                     │  fork + waitpid 自动重启  │
                     └────────────┬────────────┘
                                  │
                          ┌───────▼───────┐
                          │   Client      │
                          └───────┬───────┘
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
        HTTP / WebSocket    Binary (9090)     Static files
              (8080)                          (via HTTP)
                │                 │                 │
                └────────┬────────┴────────┬────────┘
                         │                 │
                 ┌───────▼────────┐        │
                 │   MainReactor  │        │
                 │   epoll_wait   │        │
                 │   accept only  │        │
                 └──┬───┬───┬─────┘        │
                    │   │   │              │
           round-robin 分发 (eventfd + queue)
                    │   │   │              │
       ┌────────────┘   │   └────────────┐ │
       ▼                ▼                 ▼│
  ┌───────────┐  ┌───────────┐     ┌──────▼────┐
  │SubReactor │  │SubReactor │ ... │SubReactor │
  │epoll ET   │  │epoll ET   │     │epoll ET   │
  │I/O + 业务 │  │I/O + 业务 │     │I/O + 业务 │
  │TimerHeap  │  │TimerHeap  │     │TimerHeap  │
  │MemoryPool │  │MemoryPool │     │MemoryPool │
  │broadcast_ │  │broadcast_ │     │broadcast_ │
  │  evfd     │  │  evfd     │     │  evfd     │
  └─────┬─────┘  └─────┬─────┘     └─────┬─────┘
        └──────────────┼─────────────────┘
                       │
             WebSocket 跨 Reactor 广播
          (shared_ptr<const string> 共享只读帧)

                       │
            ┌──────────┴──────────┐
            ▼                     ▼
   ┌─────────────────┐   ┌──────────────┐
   │  MySQL Pool     │   │  Redis Pool  │
   │  ConnGuard RAII │   │  ConnGuard   │
   │  (全局单例)      │   │  (全局单例)   │
   └─────────────────┘   └──────────────┘

  ┌─────────────────────────────────────┐
  │  Async Logger (queue swap + flush)  │
  │  (全局单例)                          │
  └─────────────────────────────────────┘
```

## 目录结构

```
WebServer/
├── src/          # 源文件（.cpp/.cc）
├── include/      # 头文件（.h/.tpp）
├── build/        # 编译输出
├── demos/        # protobuf 客户端 demo
├── static/       # 静态文件（index.html 聊天室前端）
├── logs/         # 运行日志
├── Makefile
├── message.proto
└── README.md
```

## 协议支持

| 协议 | 端口 | 用途 |
|---|---|---|
| HTTP/1.1 | 8080 | 静态文件服务、登录/注册接口、WebSocket 升级入口 |
| WebSocket | 8080 | 实时聊天室（HTTP Upgrade 升级而来） |
| 自定义二进制（protobuf） | 9090 | Binary 客户端聊天与测试 |

Connection 结构体通过 `protocol` 字段（`PROTO_HTTP` / `PROTO_BINARY` / `PROTO_WEBSOCKET`）区分连接状态，在同一 SubReactor 中统一管理。

## 设计说明

**多 Reactor 架构**：MainReactor 只负责 accept，通过 round-robin 将新连接分发给 SubReactor，每个 SubReactor 独立持有 epollfd、连接表、时间堆、对象池，在自己的线程中完成 I/O 和业务处理，避免跨线程共享连接数据。

**epoll ET 模式**：减少 epoll_wait 对同一个 fd 的重复返回，降低事件处理的冗余。

**eventfd 通知**：MainReactor 通过 eventfd + 队列将新连接 fd 传递给 SubReactor，避免跨线程共享连接数据。

**小根堆定时器**：每个 SubReactor 持有独立的时间堆，epoll_wait 超时时关闭不活跃连接，无需跨线程同步。

**Connection 对象池**：每个 SubReactor 持有独立的 MemoryPool，预分配连续内存块（不足时倍增扩容），通过 freelist 复用对象本体内存管理空闲块，使用 `placement new` 构造、自定义 deleter 配合 `unique_ptr` 实现 RAII 回池，避免高频连接创建/销毁导致的重复堆分配与碎片化。

**MySQL 连接池 + ConnGuard**：避免每次请求建连接的开销；ConnGuard 用 RAII 防止连接泄漏。

**Redis 连接池 + ConnGuard**：登录时先查 Redis 缓存，未命中再查 MySQL 并回写缓存，减少数据库压力。

**单例模式**：AsyncLogger、MySQL 连接池、Redis 连接池使用 static local variable 实现线程安全的懒加载单例。

**自定义二进制协议**：4 字节消息类型 + 4 字节消息长度 + protobuf 序列化数据，支持粘包处理。

**WebSocket 协议**：复用 HTTP 8080 端口，识别 Upgrade: websocket 头后走握手分支，OpenSSL 算 SHA1 + Base64 生成 Sec-WebSocket-Accept，握手成功后 Connection 的 protocol 切换为 PROTO_WEBSOCKET。帧解析拆分为 checkComplete 和 parseFrame，支持 TEXT/CLOSE/PING/PONG，服务端帧不带 MASK。

**WebSocket 跨 Reactor 广播**：每个 SubReactor 持有独立的 broadcast_evfd 和 broadcast_queue（mutex 保护），队列元素为 shared_ptr<const string> 共享只读帧，const 在编译期防止跨线程写入。SubReactor 通过 Server 持有的 vector 互相 enqueue，MainReactor 不参与。handleBroadcast 用 swap 把成员队列换到局部变量，将锁临界区压缩为 O(1)。

**Binary 协议聊天室广播**：早期实现，PROTO_BINARY 消息只广播给同 SubReactor 内其他 PROTO_BINARY 连接，未跨 Reactor。WebSocket 广播升级为跨 Reactor 方案后，Binary 路径保留原实现作为对照。

**静态文件 + MIME type**：HTTP GET 请求通过 getMimeType 根据扩展名返回 Content-Type（static const unordered_map<string_view, string_view> O(1) 查表），未知类型按 HTTP 规范返回 application/octet-stream，支持 html/css/js/json/png/jpg/svg/ico。

**聊天室前端**：`static/index.html` 是单文件 React SPA（CDN 加载依赖），通过 `ws://${window.location.host}/chat` 建连，消息 JSON 格式 {nickname, text}，服务端按 UTF-8 文本帧原样广播。

**心跳保活**：Binary 客户端定时发送心跳包，SubReactor 识别后直接处理，刷新连接超时时间。WebSocket 当前依赖较长的空闲超时（60s）被动关闭，服务端主动 PING 保活作为后续优化点。

**异步日志 queue swap**：避免降低主线程和工作线程速率，后台处理日志写入。AsyncLogger 单例改为全局指针 + `pthread_atfork` 解决 fork + mutex 死锁，`atexit` 注册 delete 确保日志 flush。

**守护进程**：fork 模式运行，父进程通过 waitpid 监控子进程，子进程异常退出（信号终止）时自动重启，正常退出时停止。

**优雅关闭**：SIGINT/SIGTERM 信号触发 MainReactor 退出，逐个 shutdown SubReactor，等待线程 join 后清理资源。

**sendfile 零拷贝**：静态文件发送使用 sendfile 系统调用，数据直接从内核文件缓冲区传输到 socket 缓冲区，避免用户态拷贝，降低 CPU 开销。

## 压测数据

| 测试场景 | QPS | 平均响应时间 | 失败数 |
|---------|-----|-----------|-------|
| **v1.2版本（连接池优化）** | | | |
| POST /login 无连接池 | 259 | 771ms | 0 |
| POST /login MySQL连接池 + 大锁 | 4018 | 49.8ms | 0 |
| POST /login MySQL连接池 + 锁优化 | 14932 | 13.4ms | 0 |
| **v1.3版本（代码重构 + 防御性加强）** | | | |
| GET /index.html 无Redis | 9148 | 11ms | 0 |
| GET /index.html + Redis缓存 | 10921 | 9ms | 0 |
| POST /login 无Redis | 7257 | 14ms | 0 |
| POST /login + Redis缓存 | 10049 | 10ms | 0 |
| **v1.4版本（性能优化）** | | | |
| GET /index.html (-n 1000 -c 200) | 21600 | 9.3ms | 0 |
| POST /login + Redis缓存 (-n 1000 -c 200) | 18900 | 10.6ms | 0 |
| **v2.0版本（多Reactor架构）** | | | |
| POST /login + Redis缓存 (-n 10000 -c 500) | 19917 | 23.1ms | 0 |
| 对比v1.4同条件 (-n 10000 -c 500) | 10095 | 44.0ms | 0 |
| **v2.3版本（sendfile零拷贝）** | | | |
| GET /index.html (-n 10000 -c 500) | 26600 | 18.8ms | 0 |

## 数据库初始化

```sql
mysql -u root -p
CREATE DATABASE webserver;
USE webserver;

CREATE TABLE participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind TINYINT UNSIGNED NOT NULL COMMENT '1=USER, 2=AI, 3=SYSTEM',
  display_name VARCHAR(32) NOT NULL,
  avatar_url VARCHAR(255) DEFAULT NULL,
  created_at_ms BIGINT UNSIGNED DEFAULT NULL,

  PRIMARY KEY (id),
  KEY idx_kind (kind)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
COMMENT = '统一消息发送者表；users/ai/system 都先在这里注册身份';


CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：users.id = participants.id，kind=1',
  username VARCHAR(32) UNIQUE NOT NULL,
  password_hash BINARY(32),
  salt BINARY(16),

  PRIMARY KEY (id)

  -- APP FK: users.id -> participants.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE ai (
  id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：ai.id = participants.id，kind=2',
  provider VARCHAR(32) NOT NULL COMMENT '例如 deepseek / chatgpt',
  model VARCHAR(64) NOT NULL COMMENT '例如 deepseek-chat / deepseek-reasoner',
  system_prompt TEXT,

  PRIMARY KEY (id),
  KEY idx_model (model)

  -- APP FK: ai.id -> participants.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(32) NOT NULL,
  main_conversation_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：rooms.main_conversation_id -> conversations.id',
  owner_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：owner_id -> users.id；0 表示系统创建',
  created_at_ms BIGINT UNSIGNED NOT NULL,
  type TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '0=大厅/系统房间, 1=个人房间, 2=普通房间',

  PRIMARY KEY (id)

  -- APP FK: rooms.main_conversation_id -> conversations.id
  -- APP FK: rooms.owner_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


INSERT INTO rooms (id, name, main_conversation_id, owner_id, created_at_ms, type)
VALUES (1, 'Atrium 大厅', 1, 0, 0, 0);


CREATE TABLE room_members (
  room_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：room_members.room_id -> rooms.id',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：room_members.user_id -> users.id',
  role TINYINT UNSIGNED NOT NULL COMMENT '例如 1=owner, 2=admin, 3=member',
  join_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (room_id, user_id),
  KEY idx_user_join (user_id, join_at_ms, room_id)

  -- APP FK: room_members.room_id -> rooms.id
  -- APP FK: room_members.user_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：conversations.room_id -> rooms.id',
  title VARCHAR(32) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：created_by -> participants.id；0 表示系统创建',
  created_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id),
  KEY idx_room_id (room_id)

  -- APP FK: conversations.room_id -> rooms.id
  -- APP FK: conversations.created_by -> participants.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


INSERT INTO conversations (id, room_id, title, created_by, created_at_ms)
VALUES (1, 1, 'Atrium 大厅', 0, 0);


CREATE TABLE conversation_ai_members (
  conversation_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：conversation_ai_members.conversation_id -> conversations.id',
  ai_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：conversation_ai_members.ai_id -> ai.id',
  adapter_url VARCHAR(255) DEFAULT NULL COMMENT '系统预设思维 adapter 文件路径',
  custom_adapter_text TEXT DEFAULT NULL COMMENT '用户自定义思维描述',

  PRIMARY KEY (conversation_id, ai_id),
  KEY idx_ai (ai_id)

  -- APP FK: conversation_ai_members.conversation_id -> conversations.id
  -- APP FK: conversation_ai_members.ai_id -> ai.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE room_ai_members (
  room_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：room_ai_members.room_id -> rooms.id',
  ai_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：room_ai_members.ai_id -> ai.id',
  adapter_url VARCHAR(255) DEFAULT NULL COMMENT '系统预设思维 adapter 文件路径',
  custom_adapter_text TEXT DEFAULT NULL COMMENT '用户自定义思维描述',

  PRIMARY KEY (room_id, ai_id),
  KEY idx_ai (ai_id)

  -- APP FK: room_ai_members.room_id -> rooms.id
  -- APP FK: room_ai_members.ai_id -> ai.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：messages.conversation_id -> conversations.id',
  send_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：messages.send_id -> participants.id，不再直接指向 users.id',
  type TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1=TEXT, 2=IMAGE, 3=FILE, 4=SYSTEM',
  content VARCHAR(4000) NOT NULL,
  send_time_ms BIGINT UNSIGNED NOT NULL,
  client_message_id VARCHAR(64) DEFAULT NULL,
  deleted_at_ms BIGINT UNSIGNED DEFAULT NULL,

  PRIMARY KEY (id),
  KEY idx_conv_time_id (conversation_id, send_time_ms, id),
  KEY idx_send_id (send_id)

  -- APP FK: messages.conversation_id -> conversations.id
  -- APP FK: messages.send_id -> participants.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE friendships (
  user_a_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：friendships.user_a_id -> users.id',
  user_b_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：friendships.user_b_id -> users.id',
  created_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (user_a_id, user_b_id),
  KEY idx_user_b_id (user_b_id),
  CONSTRAINT chk_friendship_order CHECK (user_a_id < user_b_id)

  -- APP FK: friendships.user_a_id -> users.id
  -- APP FK: friendships.user_b_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：invitations.room_id -> rooms.id',
  inviter_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：invitations.inviter_id -> users.id',
  invitee_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：invitations.invitee_id -> users.id',
  created_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_room_invitee (room_id, invitee_id),
  KEY idx_invitee (invitee_id)

  -- APP FK: invitations.room_id -> rooms.id
  -- APP FK: invitations.inviter_id -> users.id
  -- APP FK: invitations.invitee_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE friend_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：friend_requests.from_user_id -> users.id',
  to_user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：friend_requests.to_user_id -> users.id',
  created_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_from_to (from_user_id, to_user_id),
  KEY idx_to_user (to_user_id)

  -- APP FK: friend_requests.from_user_id -> users.id
  -- APP FK: friend_requests.to_user_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE ai_usage (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：ai_usage.user_id -> users.id',
  date DATE NOT NULL,
  count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  daily_quota TINYINT UNSIGNED NOT NULL DEFAULT 20,

  PRIMARY KEY (user_id, date)

  -- APP FK: ai_usage.user_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
COMMENT = '用户每日 AI 调用次数 + 每日配额';

CREATE TABLE user_ai_tokens (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：user_ai_tokens.user_id -> users.id',
  date DATE NOT NULL,
  model_id SMALLINT UNSIGNED NOT NULL COMMENT '应用层外键：ai_models.id',

  input_cached_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '输入token：命中缓存',
  input_uncached_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '输入token：未命中缓存',
  output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '输出token',

  total_tokens BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      input_cached_tokens + input_uncached_tokens + output_tokens
    ) STORED,

  request_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当天该模型请求次数',

  PRIMARY KEY (user_id, date, model_id),
  KEY idx_model_date (model_id, date)

  -- APP FK:
  -- user_ai_tokens.user_id -> users.id
  -- user_ai_tokens.model_id -> ai_models.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
COMMENT = '用户每日各模型 AI token 消耗统计';
```

## 编译与运行

```bash
# 编译服务器
make

# 清理重新编译
make clean && make

# 启动服务器（HTTP端口 8080，二进制协议端口 9090）
./build/server.out 127.0.0.1 8080 9090

# 编译 protobuf 客户端
protoc --cpp_out=. message.proto
g++ ./demos/protobuf_client_a.cpp src/message.pb.cc -o build/protobuf_client_a.out -Iinclude -lprotobuf
g++ ./demos/protobuf_client_b.cpp src/message.pb.cc -o build/protobuf_client_b.out -Iinclude -lprotobuf
```

## 测试

```bash
# HTTP 注册/登录
curl -d "username=test&password=123" http://localhost:8080/register
curl -d "username=test&password=123" http://localhost:8080/login

# HTTP 静态文件
curl http://localhost:8080/index.html

# 压测
ab -n 10000 -c 500 http://localhost:8080/index.html
ab -n 10000 -c 500 -p post.txt -T application/x-www-form-urlencoded http://localhost:8080/login

# protobuf 客户端测试
./build/protobuf_client_a.out
./build/protobuf_client_b.out
```

## 环境

- Ubuntu 22.04
- g++ 11.4.0
- MySQL 8.0.45
- Redis 6.0+
- protobuf 3.12.4

## 依赖安装

```bash
sudo apt install g++ make default-libmysqlclient-dev mysql-server redis-server libhiredis-dev protobuf-compiler libprotobuf-dev libssl-dev
```