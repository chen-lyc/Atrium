#pragma once

#include <cstdint>

struct Connection;

constexpr int MAXSIZE = 1024;
constexpr int BUFSIZE = 4096;

extern int epollfd;
extern int notifyfd;

extern volatile bool running;

void setnonblocking(int fd);
void addfd(int fd);
void modfd(int fd, uint32_t events);
void trySend(Connection &conn);
void tryEnqueueTask(Connection &conn);
void closeNow(int fd);
void closeOrDefer(int fd);
void handleSignal(int sig);