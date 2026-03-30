# WebServer

C++ Linux 高性能服务器，支持 HTTP 协议和自定义二进制协议（protobuf），包含多人聊天室功能。

## 架构
```
                          ┌──────────────┐
                          │   Client     │
                          └──────┬───────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
             HTTP (8080)              Binary (9090)
                    │                         │
                    └────────────┬────────────┘
                                 │
                          ┌──────▼───────┐
                          │  Main Thread │
                          │  epoll_wait  │
                          │  accept only │
                          └──┬───┬───┬───┘
                             │   │   │
                    round-robin 分发 (eventfd + queue)
                             │   │   │
                ┌────────────┘   │   └────────────┐
                ▼                ▼                 ▼
          ┌──────────┐   ┌──────────┐      ┌──────────┐
          │SubReactor│   │SubReactor│ ...  │SubReactor│
          │epoll_wait│   │epoll_wait│      │epoll_wait│
          │ I/O+业务 │   │ I/O+业务 │      │ I/O+业务 │
          │TimerHeap │   │TimerHeap │      │TimerHeap │
          └──────────┘   └──────────┘      └──────────┘
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
├── demos/        # protobuf客户端demo
├── static/       # 静态文件
├── logs/         # 运行日志
├── Makefile
├── message.proto
└── README.md
```

## 设计说明
多 Reactor 架构：主线程只负责 accept，通过 round-robin 将新连接分发给子 Reactor，每个子 Reactor 独立持有 epollfd、连接表、时间堆，在自己的线程中完成 I/O 和业务处理，避免跨线程共享连接数据。

epoll ET 模式：减少了 epoll_wait 对同一个 fd 的重复返回，降低事件处理的冗余。

eventfd 通知：主线程通过 eventfd + 队列将新连接 fd 传递给子 Reactor，避免跨线程共享连接数据。

小根堆定时器：每个子 Reactor 持有独立的时间堆，epoll_wait 超时时关闭不活跃连接，无需跨线程同步。

MySQL 连接池 + ConnGuard：避免每次请求建连接的开销；ConnGuard 用 RAII 防止连接泄漏。

Redis 连接池 + ConnGuard：登录时先查 Redis 缓存，未命中再查 MySQL 并回写缓存，减少数据库压力。

单例模式：AsyncLogger、MySQL 连接池、Redis 连接池使用 static local variable 实现线程安全的懒加载单例。

自定义二进制协议：4 字节消息类型 + 4 字节消息长度 + protobuf 序列化数据，支持粘包处理。

聊天室广播：PROTO_BINARY 客户端发送聊天消息，服务端广播给同 Reactor 内所有其他 PROTO_BINARY 连接。

心跳保活：客户端定时发送心跳包，子 Reactor 识别后直接处理，刷新连接超时时间。

异步日志 queue swap：避免降低主线程和工作线程速率，后台处理日志写入。

优雅关闭：SIGINT/SIGTERM 信号触发主线程退出，逐个 shutdown 子 Reactor，等待线程 join 后清理资源。

## 压测数据
| 测试场景 | QPS | 平均响应时间 | 失败数 |
|---------|-----|------------|-------|
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

## 数据库初始化
```bash
mysql -u root -p
```
```sql
CREATE DATABASE webserver;
USE webserver;
CREATE TABLE users (
  id INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE,
  password_hash VARCHAR(255),
  salt VARCHAR(255),
  PRIMARY KEY (id)
);
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
sudo apt install g++ libmysqlclient-dev mysql-server redis-server libhiredis-dev protobuf-compiler libprotobuf-dev
```