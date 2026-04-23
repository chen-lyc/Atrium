#include "main_reactor.h"
#include "logger.h"
#include "server_utils.h"
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/epoll.h>
using namespace std;

MainReactor::MainReactor(int stopfd, const string &ip, int http_port, int protobuf_port, int n, int max_events) : m_num_reactors(n), m_max_events(max_events), m_stopfd(stopfd) {
    m_epollfd = epoll_create1(0);
    addfd(m_epollfd, stopfd);
    m_http_listenfd = socket_bind_listen(ip, http_port);
    m_protobuf_listenfd = socket_bind_listen(ip, protobuf_port);

    for (int i = 0; i < n; i++) {
        m_sub_reactors.emplace_back(make_unique<Reactor>(i, m_sub_reactors));
    }
}

MainReactor::~MainReactor() {
    for (int i = 0; i < m_num_reactors; i++) {
        m_sub_reactors[i]->shutDown();
    }

    close(m_http_listenfd);
    close(m_protobuf_listenfd);
    close(m_epollfd);
}

void MainReactor::loop() {
    int next_reactor_idx = 0;
    epoll_event events[m_max_events];

    while (m_running) {
        int number = epoll_wait(m_epollfd, events, m_max_events, -1);
        LOG_DEBUG("happened events number = %d", number);
        if (number <= 0) {
            if (errno == EINTR && m_running == false) {
                LOG_INFO("server stopped by signal SIGINT or SIGTERM");
            } else {
                LOG_ERROR("epoll_wait failed");
            }
            continue;
        }

        for (int i = 0; i < number; i++) {
            int fd = events[i].data.fd;
            LOG_DEBUG("event fd = %d", fd);
            if (fd == m_stopfd) {
                uint64_t val;
                read(m_stopfd, &val, sizeof(val));
                m_running = false;
                return;
            } else if (fd == m_http_listenfd || fd == m_protobuf_listenfd) {
                ProtocolType protocol_type;
                if (fd == m_http_listenfd) protocol_type = PROTO_HTTP;
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
                    LOG_DEBUG("new connection, fd = %d ip = %s:%d", conn_fd, client_ip, client_port);

                    m_sub_reactors[next_reactor_idx]->addConnection(conn_fd, protocol_type);
                    next_reactor_idx = (next_reactor_idx + 1) % m_num_reactors;
                }
            } else {
                LOG_WARN("something else happened");
            }
        }
    }
}

int MainReactor::socket_bind_listen(const string &ip, int port) {
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, ip.data(), &addr.sin_addr);

    int listenfd = socket(PF_INET, SOCK_STREAM, 0);
    int opt = 1;
    setsockopt(listenfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    bind(listenfd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr));
    listen(listenfd, 1024);
    addfd(m_epollfd, listenfd);

    LOG_DEBUG("server listening on %s:%d", ip.c_str(), port);
    return listenfd;
}
