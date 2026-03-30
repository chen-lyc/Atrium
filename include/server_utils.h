#pragma once

#include <cstdint>

constexpr int MAXSIZE = 1024;
constexpr int BUFSIZE = 4096;

extern volatile bool running;

void setnonblocking(int fd);
void addfd(int epollfd, int fd);
void modfd(int epollfd, int fd, uint32_t events);
void handleSignal(int sig);