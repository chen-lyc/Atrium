#include "connection.h"
#include "epoll_utils.h"
#include "http.h"
#include "http_codec.h"
#include "logger.h"
#include "message.pb.h"
#include "mysql_pool.h"
#include "protobuf_codec.h"
#include "protocol.h"
#include "redis_pool.h"
#include "task.h"
#include "thread_pool.h"
#include "timerheap.h"
#include "utils.h"
#include <arpa/inet.h>
#include <cstring>
#include <fcntl.h>
#include <functional>
#include <hiredis/hiredis.h>
#include <mysql/mysql.h>
#include <netinet/in.h>
#include <sstream>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/stat.h>
using namespace std;

int main(int argc, char *argv[]) {
    logger.log(AsyncLogger::INFO, "\nserver starting");

    if (argc <= 3) {
        logger.log(AsyncLogger::WARN, "usage: ./threadpool_epoll_demo.out ip port");
        return -1;
    }
    epollfd = epoll_create(1);
    notifyfd = eventfd(0, EFD_NONBLOCK);
    addfd(notifyfd);

    string ip(argv[1]);
    int http_port = stoi(argv[2]);
    int protobuf_port = stoi(argv[3]);

    auto socket_bind_listen = [](string ip, int port) {
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(port);
        inet_pton(AF_INET, ip.c_str(), &addr.sin_addr);

        int listenfd = socket(PF_INET, SOCK_STREAM, 0);
        int opt = 1;
        setsockopt(listenfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
        bind(listenfd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr));
        listen(listenfd, 1024);
        addfd(listenfd);
        logger.log(AsyncLogger::INFO, "server listening on " + ip + ":" + to_string(port));
        return listenfd;
    };

    int http_listenfd = socket_bind_listen(ip, http_port);
    int protobuf_listenfd = socket_bind_listen(ip, protobuf_port);

    epoll_event events[MAXSIZE];

    while (1) {
        int numbers = epoll_wait(epollfd, events, MAXSIZE, timer_heap.getNextTimeout());
        logger.log(AsyncLogger::DEBUG, "happened events number = " + to_string(numbers));
        if (numbers < 0) {
            logger.log(AsyncLogger::ERROR, "epoll_wait failed");
            break;
        } else if (numbers == 0) {
            logger.log(AsyncLogger::INFO, "epoll_wait running timeout, run timer tick");
            timer_heap.tick();
            for (int fd : timer_heap.getExpired()) {
                logger.log(AsyncLogger::INFO, "close inactive connection, fd = " + to_string(fd));
                if (conns[fd]->processing) {
                    conns[fd]->pendingClose = true;
                } else {
                    close(fd);
                    conns.erase(fd);
                }
            }
            continue;
        }

        for (int i = 0; i < numbers; i++) {
            int fd = events[i].data.fd;
            logger.log(AsyncLogger::DEBUG, "event fd = " + to_string(fd));
            if (fd == http_listenfd || fd == protobuf_listenfd) {
                ProtocolType protocol_type;
                if (fd == http_listenfd) protocol_type = PROTO_HTTP;
                else protocol_type = PROTO_BINARY;

                while (1) {
                    sockaddr_in client_addr{};
                    socklen_t client_len = sizeof(client_addr);
                    int connfd = accept(fd, reinterpret_cast<sockaddr *>(&client_addr), &client_len);
                    if (connfd < 0) {
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            break;
                        }
                        logger.log(AsyncLogger::ERROR, "accept failed");
                        break;
                    }

                    addfd(connfd);
                    auto conn_ptr = make_unique<Connection>();
                    conn_ptr->fd = connfd;
                    conn_ptr->protocol = protocol_type;
                    conns.emplace(connfd, move(conn_ptr));
                    timer_heap.add(connfd, 6000);

                    char client_ip[INET_ADDRSTRLEN];
                    int client_port = ntohs(client_addr.sin_port);
                    inet_ntop(AF_INET, &client_addr.sin_addr, client_ip, INET_ADDRSTRLEN);
                    logger.log(AsyncLogger::INFO, "new connection, fd = " + to_string(connfd) + " ip = " + client_ip + ":" + to_string(client_port));
                }
            } else if (fd == notifyfd) {
                uint64_t val;
                read(notifyfd, &val, sizeof(val));

                queue<TaskResult> localQueue;
                {
                    lock_guard<mutex> lock(ready_mutex);
                    localQueue.swap(ready_queue);
                }

                logger.log(AsyncLogger::DEBUG, "start processing queue, queue len = " + to_string(localQueue.size()));
                while (!localQueue.empty()) {
                    auto &result = localQueue.front();
                    if (conns.find(result.fd) != conns.end()) {
                        conns[result.fd]->outbuf = result.response;
                        conns[result.fd]->processing = false;

                        if (!result.shoule_broadcast) {
                            trySend(*conns[result.fd]);
                        } else {
                            for (auto it = conns.begin(); it != conns.end(); it++) {
                                trySend(*it->second);
                            }
                        }
                    }
                    localQueue.pop();
                }
            } else if (events[i].events & EPOLLIN) {
                timer_heap.update(fd, 6000);

                char buf[BUFSIZE];
                while (1) {
                    int n = recv(fd, buf, BUFSIZE, 0);
                    if (n > 0) {
                        {
                            lock_guard<mutex> lock(conns[fd]->inbuf_mutex);
                            conns[fd]->inbuf.append(buf, n);
                        }
                    } else if (n == 0) {
                        logger.log(AsyncLogger::INFO, "client closed writing, fd = " + to_string(fd));
                        conns[fd]->readClosed = true;
                        tryEnqueueTask(*conns[fd]);
                        break;
                    } else {
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            tryEnqueueTask(*conns[fd]);
                            break;
                        } else {
                            logger.log(AsyncLogger::ERROR, "read failed");
                            closeOrDefer(fd);
                            break;
                        }
                    }
                }
            } else if (events[i].events & EPOLLOUT) {
                if (conns.find(fd) != conns.end()) {
                    trySend(*conns[fd]);
                }
            } else {
                logger.log(AsyncLogger::WARN, "something else happened");
            }
        }
    }

    close(http_listenfd);
    close(protobuf_listenfd);
    close(epollfd);
    close(notifyfd);

    return 0;
}