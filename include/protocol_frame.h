#pragma once

#include <cstdint>

enum class FrameStatus {
    Incomplete,
    Complete,
    ProtocolError
};

struct FrameResult {
    FrameStatus status;
    uint64_t end_pos = 0;
};