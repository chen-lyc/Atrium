#pragma once

#include <cstdint>

constexpr int BUFSIZE = 4096;

extern int stopfd;

void setnonblocking(int fd);
void addfd(int epollfd, int fd);
void modfd(int epollfd, int fd, uint32_t events);
void handleSignal(int sig);