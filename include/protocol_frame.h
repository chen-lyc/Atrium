#pragma once

#include <cstddef>

enum class FrameStatus {
    Incomplete,
    Complete,
    ProtocolError
};

struct FrameResult {
    FrameStatus status;
    std::size_t end_pos = 0;
};