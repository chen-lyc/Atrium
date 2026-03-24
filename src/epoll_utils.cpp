#include "epoll_utils.h"
#include "connection.h"
#include "logger.h"
#include "protocol.h"
#include "task.h"
#include "timerheap.h"
#include <fcntl.h>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/socket.h>
#include <unistd.h>
using namespace std;

int epollfd;
int notifyfd;

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
    while (!conn.outbuf.empty()) {
        int n = send(conn.fd, conn.outbuf.c_str(), conn.outbuf.size(), 0);
        if (n > 0) {
            conn.outbuf.erase(0, n);
        } else if (n == -1 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            logger.log(AsyncLogger::DEBUG, "write would block, enable EPOLLOUT and send later");
            modfd(conn.fd, EPOLLET | EPOLLIN | EPOLLOUT);
            return;
        } else {
            logger.log(AsyncLogger::ERROR, "write failed");
            return;
        }
    }
    if (conn.readClosed) {
        logger.log(AsyncLogger::INFO, "send complete, close fd = " + to_string(conn.fd));
        timer_heap.remove(conn.fd);
        close(conn.fd);
        conns.erase(conn.fd);
        return;
    } else if (!conn.keepAlive) {
        logger.log(AsyncLogger::INFO, "client not keep alive, send complete, close fd = " + to_string(conn.fd));
        closeNow(conn.fd);
        return;
    } else {
        logger.log(AsyncLogger::INFO, "fd = " + to_string(conn.fd) + ", send complete");

        if (conn.pendingClose) {
            closeNow(conn.fd);
            return;
        }
    }
}

void tryEnqueueTask(Connection &conn) {
    if (isRequestComplete(conn.fd) && !conn.processing && conn.keepAlive) {
        logger.log(AsyncLogger::DEBUG, "enqueue task for fd = " + to_string(conn.fd));
        conn.processing = true;
        unique_ptr<Task> ptr_task(new Task(conn));
        pool.enqueue(move(ptr_task));
    }
}

void closeNow(int fd) {
    timer_heap.remove(fd);
    close(fd);
    conns.erase(fd);
}

void closeOrDefer(int fd) {
    if (conns.find(fd) == conns.end()) return;

    if (conns[fd]->processing) {
        conns[fd]->pendingClose = true;
    } else {
        closeNow(fd);
    }
}