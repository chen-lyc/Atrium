#pragma once

#include <cstdint>
#include <vector>

struct Connection;

constexpr int MAXSIZE = 1024;
constexpr int BUFSIZE = 4096;

extern int epollfd;

extern volatile bool running;

void setnonblocking(int fd);
void addfd(int epollfd, int fd);
void modfd(int epollfd, int fd, uint32_t events);
void trySend(Connection &conn);
void tryEnqueueTask(Connection &conn);
void closeNow(int fd);
void closeOrDefer(int fd);
void handleSignal(int sig);