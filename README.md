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
                          │  (ET mode)   │
                          └──┬───┬───┬───┘
                             │   │   │
                ┌────────────┘   │   └────────────┐
                ▼                ▼                 ▼
          ┌──────────┐   ┌────────────┐   ┌──────────────┐
          │ Timer    │   │ Thread Pool│   │  eventfd     │
          │ MinHeap  │   │ HTTP Parse │   │  notify back │
          │ tick()   │   │ + Protobuf │   │  + trySend() │
          └──────────┘   │ + Business │   └──────────────┘
                         └─────┬──────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
           ┌─────────────────┐   ┌──────────────┐
           │  MySQL Pool     │   │  Redis Pool  │
           │  ConnGuard RAII │   │  ConnGuard   │
           └─────────────────┘   └──────────────┘

          ┌─────────────────────────────────────┐
          │  Async Logger (queue swap + flush)  │
          │  ← all modules write log here       │
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
epoll ET 模式：减少了 epoll_wait 对同一个 fd 的重复返回，降低事件处理的冗余。

线程池：避免每次处理业务构造工作线程的开销。

eventfd 通知：工作线程处理完后简洁高效地通知主线程。

小根堆定时器：每次 epoll_wait 超时都能关闭不活跃连接，避免主线程空转。

MySQL 连接池 + ConnGuard：避免每次请求建连接的开销；ConnGuard 用 RAII 防止连接泄漏。

Redis 连接池 + ConnGuard：登录时先查 Redis 缓存，未命中再查 MySQL 并回写缓存，减少数据库压力。

自定义二进制协议：4 字节消息类型 + 4 字节消息长度 + protobuf 序列化数据，支持粘包处理。

聊天室广播：PROTO_BINARY 客户端发送聊天消息，服务端广播给所有其他 PROTO_BINARY 连接。

心跳保活：客户端定时发送心跳包，主线程识别后直接清除，不进入工作线程，刷新连接超时时间。

异步日志 queue swap：避免降低主线程和工作线程速率，后台处理日志写入。

锁粒度优化：将 readyQueue 的锁从整个 process 缩小到只保护 emplace 操作，QPS 提升约 4 倍。

## 压测数据
| 测试场景 | QPS | 平均响应时间 | 失败数 |
|---------|-----|------------|-------|
| **v1.2版本对比测试** | | | |
| POST /login 无连接池 | 259 | 771ms | 0 |
| POST /login MySQL连接池 + 大锁 | 4018 | 49.8ms | 0 |
| POST /login MySQL连接池 + 锁优化 | 14932 | 13.4ms | 0 |
| **v1.3版本（代码重构 + 防御性加强）** | | | |
| GET /index.html 无Redis | 9148 | 11ms | 0 |
| GET /index.html + Redis缓存 | 10921 | 9ms | 0 |
| POST /login 无Redis | 7257 | 14ms | 0 |
| POST /login + Redis缓存 | 10049 | 10ms | 0 |
| **v1.4版本（性能优化）** | | | |
| GET /index.html | 21600 | 9.3ms | 0 |
| POST /login + Redis缓存 | 18900 | 10.6ms | 0 |

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
g++ ./demos/protobuf_client_a.cpp src/message.pb.cc -o demos/protobuf_client_a.out -lprotobuf
g++ ./demos/protobuf_client_b.cpp src/message.pb.cc -o demos/protobuf_client_b.out -lprotobuf
```

## 测试
```bash
# HTTP 注册/登录
curl -d "username=test&password=123" http://localhost:8080/register
curl -d "username=test&password=123" http://localhost:8080/login

# HTTP 静态文件
curl http://localhost:8080/index.html

# 压测
ab -n 1000 -c 200 http://localhost:8080/index.html
ab -n 1000 -c 200 -p post.txt -T application/x-www-form-urlencoded http://localhost:8080/login

# protobuf 客户端测试
./protobuf_client_a.out
./protobuf_client_b.out
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