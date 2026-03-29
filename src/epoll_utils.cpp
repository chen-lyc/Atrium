#include "epoll_utils.h"
#include "connection.h"
#include "logger.h"
#include "protocol.h"
#include "task.h"
#include "timerheap.h"
#include <fcntl.h>
#include <signal.h>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/sendfile.h>
#include <sys/socket.h>
#include <unistd.h>
using namespace std;

int epollfd;
int notifyfd;

volatile bool running = true;

void setnonblocking(int fd) {
    int old_option = fcntl(fd, F_GETFL);
    int new_option = old_option | O_NONBLOCK;
    fcntl(fd, F_SETFL, new_option);
}

void addfd(int fd) {
    epoll_event event;
    event.events = EPOLLET | EPOLLIN;
    event.data.fd = fd;
    epoll_ctl(epollfd, EPOLL_CTL_ADD, fd, &event);
    setnonblocking(fd);
}

void modfd(int fd, uint32_t events) {
    epoll_event event;
    event.events = events;
    event.data.fd = fd;
    epoll_ctl(epollfd, EPOLL_CTL_MOD, fd, &event);
}

void trySend(Connection &conn) {
    if (conn.outbuf.empty()) {
        return;
    }

    ssize_t sent = 0;
    while (sent < conn.outbuf.size()) {
        ssize_t n = send(conn.fd, conn.outbuf.data() + sent, conn.outbuf.size() - sent, 0);
        if (n > 0) {
            sent += n;
        } else if (n == -1 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            LOG_DEBUG("write would block, enable EPOLLOUT and send later");
            modfd(conn.fd, EPOLLET | EPOLLIN | EPOLLOUT);
            conn.outbuf.erase(0, sent);
            return;
        } else {
            LOG_ERROR("write failed");
            conn.outbuf.erase(0, sent);
            return;
        }
    }
    conn.outbuf.erase(0, sent);

    // if (conn.file_fd) {
    //     off_t offset = 0;
    //     sendfile(conn.fd, conn.file_fd, &offset, conn.file_size);
    //     conn.file_fd = 0;
    //     conn.file_size = 0;
    //     close(conn.file_fd);
    // }

    if (conn.readClosed) {
        LOG_INFO("send complete, close fd = " + to_string(conn.fd));
        TimerHeap::getInstance().remove(conn.fd);
        close(conn.fd);
        conns.erase(conn.fd);
        return;
    } else if (!conn.keepAlive) {
        LOG_INFO("client not keep alive, send complete, close fd = " + to_string(conn.fd));
        closeNow(conn.fd);
        return;
    } else {
        {
            string msg;
            msg.reserve(32);
            msg += "fd = ";
            msg += to_string(conn.fd);
            msg += ", send complete";
            LOG_INFO(msg);
        }

        if (conn.pendingClose) {
            closeNow(conn.fd);
            return;
        }
    }
}

void tryEnqueueTask(Connection &conn) {
    if (isRequestComplete(conn.fd) && !conn.processing && conn.keepAlive) {
        LOG_DEBUG("enqueue task for fd = " + to_string(conn.fd));
        conn.processing = true;
        unique_ptr<Task> ptr_task = make_unique<Task>(conn);
        thread_pool.enqueue(move(ptr_task));
    }
}

void closeNow(int fd) {
    TimerHeap::getInstance().remove(fd);
    close(fd);
    conns.erase(fd);
}

void closeOrDefer(int fd) {
    if (!conns.contains(fd)) return;

    if (conns[fd]->processing) {
        conns[fd]->pendingClose = true;
    } else {
        closeNow(fd);
    }
}

void handleSignal(int sig) {
    if (sig == SIGINT || sig == SIGTERM) {
        running = false;
    }
}