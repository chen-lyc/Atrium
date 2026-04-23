#pragma once

#include "sub_reactor.h"
#include <atomic>
#include <memory>
#include <vector>

class MainReactor {
  public:
    MainReactor(int stopfd, const std::string &ip = "127.0.0.1", int http_port = 8080, int protobuf_port = 9090, int n = 5, int max_events = 1024);
    void loop();
    ~MainReactor();

  private:
    int socket_bind_listen(const std::string &ip, int port);

  private:
    int m_num_reactors;
    std::vector<std::unique_ptr<Reactor>> m_sub_reactors;
    int m_max_events;
    int m_epollfd;
    int m_http_listenfd;
    int m_protobuf_listenfd;
    int m_stopfd;
    std::atomic<bool> m_running = true;
};