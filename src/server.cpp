#include "logger.h"
#include "reactor.h"
#include "server_utils.h"
#include <arpa/inet.h>
#include <cstring>
#include <fcntl.h>
#include <functional>
#include <netinet/in.h>
#include <signal.h>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/sendfile.h>
#include <sys/wait.h>
using namespace std;

int main(int argc, char *argv[]) {
    signal(SIGINT, SIG_IGN);
    signal(SIGTERM, SIG_IGN);

    AsyncLogger::getInstance().setFilePath("logs/daemon.log");

    while (true) {
        pid_t pid = fork();
        if (pid > 0) {
            LOG_INFO("process start, pid is " + to_string(pid));
            int status;
            waitpid(pid, &status, 0);

            if (WIFEXITED(status)) {
                LOG_INFO("\nserver stop");
                break;
            } else if (WIFSIGNALED(status)) {
                int sig = WTERMSIG(status);
                {
                    string msg;
                    msg.reserve(32);
                    msg += "pid = ";
                    msg += to_string(pid);
                    msg += ", process terminated by signal ";
                    msg += to_string(sig);
                    msg += ", restarting...";
                    LOG_INFO(msg);
                }
                continue;
            }
        } else if (pid < 0) {
            LOG_ERROR("fork failed");
            sleep(1);
            continue;
        } else if (pid == 0) {
            LOG_INFO("\nserver starting");

            string ip = "127.0.0.1";
            int http_port = 8080;
            int protobuf_port = 9090;
            if (argc > 3) {
                LOG_WARN("usage: ./threadpool_epoll_demo.out ip port");
                ip = argv[1];
                http_port = stoi(argv[2]);
                protobuf_port = stoi(argv[3]);
            }
            cout << "ip = " << ip << ':' << http_port << endl;

            if (argc > 4) {
                AsyncLogger::getInstance().setLevel(argv[4]);
            }

            int num_reactors = 5;
            int next_reactor_idx = 0;
            vector<unique_ptr<Reactor>> sub_reactors;
            for (int i = 0; i < num_reactors; i++) {
                sub_reactors.emplace_back(make_unique<Reactor>(i, sub_reactors));
            }

            signal(SIGINT, handleSignal);
            signal(SIGTERM, handleSignal);

            int epollfd = epoll_create(1);

            auto socket_bind_listen = [epollfd](const string &ip, int port) {
                sockaddr_in addr{};
                addr.sin_family = AF_INET;
                addr.sin_port = htons(port);
                inet_pton(AF_INET, ip.data(), &addr.sin_addr);

                int listenfd = socket(PF_INET, SOCK_STREAM, 0);
                int opt = 1;
                setsockopt(listenfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
                bind(listenfd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr));
                listen(listenfd, 1024);
                addfd(epollfd, listenfd);

                LOG_DEBUG("server listening on " + ip + ':' + to_string(port));
                return listenfd;
            };

            int http_listenfd = socket_bind_listen(ip, http_port);
            int protobuf_listenfd = socket_bind_listen(ip, protobuf_port);

            epoll_event events[MAXSIZE];

            while (running) {
                int number = epoll_wait(epollfd, events, MAXSIZE, -1);
                LOG_DEBUG("happened events number = " + to_string(number));
                if (number <= 0) {
                    if (errno == EINTR && running == false) {
                        LOG_INFO("server stopped by signal SIGINT or SIGTERM");
                    } else {
                        LOG_ERROR("epoll_wait failed");
                    }
                    continue;
                }

                for (int i = 0; i < number; i++) {
                    int fd = events[i].data.fd;
                    LOG_DEBUG("event fd = " + to_string(fd));
                    if (fd == http_listenfd || fd == protobuf_listenfd) {
                        ProtocolType protocol_type;
                        if (fd == http_listenfd) protocol_type = PROTO_HTTP;
                        else protocol_type = PROTO_BINARY;

                        while (true) {
                            sockaddr_in client_addr{};
                            socklen_t client_len = sizeof(client_addr);
                            int conn_fd = accept(fd, reinterpret_cast<sockaddr *>(&client_addr), &client_len);
                            if (conn_fd < 0) {
                                if (errno == EAGAIN || errno == EWOULDBLOCK) {
                                    break;
                                }
                                LOG_ERROR("accept failed");
                                break;
                            }

                            char client_ip[INET_ADDRSTRLEN];
                            int client_port = ntohs(client_addr.sin_port);
                            inet_ntop(AF_INET, &client_addr.sin_addr, client_ip, INET_ADDRSTRLEN);
                            LOG_DEBUG("new connection, fd = " + to_string(conn_fd) + " ip = " + client_ip + ':' + to_string(client_port));

                            sub_reactors[next_reactor_idx]->addConnection(conn_fd, protocol_type);
                            next_reactor_idx = (next_reactor_idx + 1) % num_reactors;
                        }
                    } else {
                        LOG_WARN("something else happened");
                    }
                }
            }

            for (int i = 0; i < num_reactors; i++) {
                sub_reactors[i]->shutDown();
            }

            close(http_listenfd);
            close(protobuf_listenfd);
            close(epollfd);

            return 0;
        }
    }
}