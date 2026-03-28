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
#include <netinet/in.h>
#include <sstream>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/sendfile.h>
using namespace std;

int main(int argc, char *argv[]) {
    LOG_INFO("\nserver starting");

    if (argc <= 3) {
        LOG_WARN("usage: ./threadpool_epoll_demo.out ip port");
        return -1;
    }

    if (argc > 4) {
        logger.setLevel(argv[4]);
    }

    epollfd = epoll_create(1);
    notifyfd = eventfd(0, EFD_NONBLOCK);
    addfd(notifyfd);

    string ip(argv[1]);
    int http_port = stoi(argv[2]);
    int protobuf_port = stoi(argv[3]);

    auto socket_bind_listen = [](const string &ip, int port) {
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(port);
        inet_pton(AF_INET, ip.data(), &addr.sin_addr);

        int listenfd = socket(PF_INET, SOCK_STREAM, 0);
        int opt = 1;
        setsockopt(listenfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
        bind(listenfd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr));
        listen(listenfd, 1024);
        addfd(listenfd);
        {
            string msg;
            msg.reserve(32);
            msg += "server listening on ";
            msg += ip;
            msg += ':';
            msg += to_string(port);
            LOG_INFO(msg);
        }
        return listenfd;
    };

    int http_listenfd = socket_bind_listen(ip, http_port);
    int protobuf_listenfd = socket_bind_listen(ip, protobuf_port);

    epoll_event events[MAXSIZE];

    while (true) {
        int numbers = epoll_wait(epollfd, events, MAXSIZE, timer_heap.getNextTimeout());
        LOG_DEBUG("happened events number = " + to_string(numbers));
        if (numbers < 0) {
            LOG_ERROR("epoll_wait failed");
            break;
        } else if (numbers == 0) {
            LOG_INFO("epoll_wait running timeout, run timer tick");
            timer_heap.tick();
            for (int fd : timer_heap.getExpired()) {
                LOG_INFO("close inactive connection, fd = " + to_string(fd));
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
            LOG_DEBUG("event fd = " + to_string(fd));
            if (fd == http_listenfd || fd == protobuf_listenfd) {
                ProtocolType protocol_type;
                if (fd == http_listenfd) protocol_type = PROTO_HTTP;
                else protocol_type = PROTO_BINARY;

                while (true) {
                    sockaddr_in client_addr{};
                    socklen_t client_len = sizeof(client_addr);
                    int connfd = accept(fd, reinterpret_cast<sockaddr *>(&client_addr), &client_len);
                    if (connfd < 0) {
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            break;
                        }
                        LOG_ERROR("accept failed");
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
                    {
                        string msg;
                        msg.reserve(32);
                        msg += "new connection, fd = ";
                        msg += to_string(connfd);
                        msg += " ip = ";
                        msg += client_ip;
                        msg += ':';
                        msg += to_string(client_port);
                        LOG_INFO(msg);
                    }
                }
            } else if (fd == notifyfd) {
                uint64_t val;
                read(notifyfd, &val, sizeof(val));

                queue<TaskResult> localQueue;
                {
                    lock_guard<mutex> lock(ready_mutex);
                    localQueue.swap(ready_queue);
                }

                LOG_DEBUG("start processing queue, queue len = " + to_string(localQueue.size()));
                while (!localQueue.empty()) {
                    auto &result = localQueue.front();
                    if (conns.contains(result.fd)) {
                        conns[result.fd]->outbuf = result.response;
                        conns[result.fd]->processing = false;

                        if (result.should_broadcast) {
                            for (auto it = conns.begin(); it != conns.end(); it++) {
                                trySend(*it->second);
                            }
                        } else if (result.file_fd) {
                            // conns[result.fd]->file_fd = result.file_fd;
                            // conns[result.fd]->file_size = result.file_size;
                            trySend(*conns[result.fd]);
                        } else {
                            trySend(*conns[result.fd]);
                        }
                    }
                    localQueue.pop();
                }
            } else if (events[i].events & EPOLLIN) {
                timer_heap.update(fd, 6000);

                char buf[BUFSIZE];
                while (true) {
                    int n = recv(fd, buf, BUFSIZE, 0);
                    if (n > 0) {
                        {
                            lock_guard<mutex> lock(conns[fd]->inbuf_mutex);
                            conns[fd]->inbuf.append(buf, n);
                        }
                    } else if (n == 0) {
                        LOG_INFO("client closed writing, fd = " + to_string(fd));
                        conns[fd]->readClosed = true;
                        tryEnqueueTask(*conns[fd]);
                        break;
                    } else {
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            tryEnqueueTask(*conns[fd]);
                            break;
                        } else {
                            LOG_ERROR("read failed");
                            closeOrDefer(fd);
                            break;
                        }
                    }
                }
            } else if (events[i].events & EPOLLOUT) {
                if (conns.contains(fd)) {
                    trySend(*conns[fd]);
                }
            } else {
                LOG_WARN("something else happened");
            }
        }
    }

    close(http_listenfd);
    close(protobuf_listenfd);
    close(epollfd);
    close(notifyfd);

    return 0;
}