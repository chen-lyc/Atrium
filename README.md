# WebServer

## 架构
```
                        ┌──────────────┐
                        │   Client     │
                        └──────┬───────┘
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
        │ tick()   │   │ + Business │   │  + trySend() │
        └──────────┘   └─────┬──────┘   └──────────────┘
                             │
                    ┌────────▼────────┐
                    │  MySQL Pool     │
                    │  ConnGuard RAII │
                    └─────────────────┘

        ┌─────────────────────────────────────┐
        │  Async Logger (queue swap + flush)  │
        │  ← all modules write log here       │
        └─────────────────────────────────────┘
```

## 设计说明
epoll ET 模式：减少了 epoll_wait 对同一个 fd 的重复返回，降低了事件处理的冗余，提高效率。

线程池：避免每次处理业务构造工作线程的开销。

eventfd 通知：工作线程处理完后简洁高效的通知主线程。

小根堆定时器：每次epoll_wait超时都能关闭连接，避免主线程空转消耗cpu性能。

MySQL 连接池 + ConnGuard：避免每次请求建连接的开销；ConnGuard 用 RAII 防止连接泄漏。

异步日志 queue swap：避免降低主线程和工作线程速率，后台处理日志。

## 压测数据
| 测试场景 | QPS | 平均响应时间 | 失败数 |
|---------|-----|------------|-------|
| GET /index.html (ab -n 1000 -c 200) | 14250 | 14ms | 0 |
| POST /login 有连接池 (ab -n 1000 -c 200) | 4018 | 49.8ms | 0 |
| POST /login 无连接池 (ab -n 1000 -c 200) | 259 | 771ms | 0 |

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
g++ server.cpp -o server.out -lmysqlclient
./server.out 127.0.0.1 8080

curl -v -d "username=test&password=123" http://localhost:8080/register
curl -v -d "username=test&password=123" http://localhost:8080/login

ab -n 1000 -c 200 http://localhost:8080/index.html

## 环境
Ubuntu 22.04
g++ 11.4.0
mysql  Ver 8.0.45-0ubuntu0.22.04.1 for Linux on x86_64 ((Ubuntu))

## 依赖安装
sudo apt install g++ libmysqlclient-dev mysql-server