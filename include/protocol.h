#pragma once

#include "connection.h"
#include <string>

bool isRequestComplete(int fd);
std::string getCompleteRequestSnapshot(Connection &conn);