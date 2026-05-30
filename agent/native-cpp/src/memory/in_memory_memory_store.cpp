#include "agent/memory/in_memory_memory_store.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <string_view>
#include <utility>

namespace atrium::agent {

namespace {

std::string lowerAscii(std::string_view value) {
    std::string out;
    out.reserve(value.size());
    for (unsigned char ch : value) {
        out.push_back(static_cast<char>(std::tolower(ch)));
    }
    return out;
}

std::vector<std::string> tokenize(std::string_view value) {
    std::vector<std::string> tokens;
    std::string current;

    for (unsigned char ch : value) {
        if (std::isalnum(ch) || ch >= 128) {
            current.push_back(static_cast<char>(std::tolower(ch)));
            continue;
        }

        if (!current.empty()) {
            tokens.emplace_back(std::move(current));
            current.clear();
        }
    }

    if (!current.empty()) {
        tokens.emplace_back(std::move(current));
    }

    return tokens;
}

bool hasTag(const MemoryRecord &record, const std::string &tag) {
    return std::find(record.tags.begin(), record.tags.end(), tag) != record.tags.end();
}

std::string searchableText(const MemoryRecord &record) {
    std::string text = record.key;
    text.push_back(' ');
    text += record.content;
    for (const auto &tag : record.tags) {
        text.push_back(' ');
        text += tag;
    }
    return lowerAscii(text);
}

double substringOverlapScore(const std::string &haystack, std::string_view raw_needle) {
    const std::string needle = lowerAscii(raw_needle);
    if (needle.empty()) {
        return 0.0;
    }
    if (haystack.find(needle) != std::string::npos) {
        return 3.0;
    }
    if (needle.size() < 6) {
        return 0.0;
    }

    std::size_t hits = 0;
    static constexpr std::size_t kWindow = 6;
    for (std::size_t i = 0; i + kWindow <= needle.size(); ++i) {
        if (haystack.find(needle.substr(i, kWindow)) != std::string::npos) {
            ++hits;
        }
    }

    return std::min(3.0, static_cast<double>(hits) * 0.15);
}

} // namespace

std::vector<MemoryRecord> InMemoryMemoryStore::search(const MemoryQuery &query) {
    std::vector<MemoryRecord> matches;

    {
        std::lock_guard<std::mutex> lock(m_mutex);
        for (const auto &record : m_records) {
            if (!matchesScope(record, query)) {
                continue;
            }

            MemoryRecord scored = record;
            scored.relevance = score(record, query);
            if (scored.relevance <= 0.0 && !record.pinned) {
                continue;
            }
            matches.emplace_back(std::move(scored));
        }
    }

    std::sort(matches.begin(), matches.end(), [](const MemoryRecord &lhs, const MemoryRecord &rhs) {
        if (lhs.pinned != rhs.pinned) {
            return lhs.pinned;
        }
        if (lhs.relevance != rhs.relevance) {
            return lhs.relevance > rhs.relevance;
        }
        return lhs.updated_at_ms > rhs.updated_at_ms;
    });

    if (query.limit > 0 && matches.size() > query.limit) {
        matches.resize(query.limit);
    }

    return matches;
}

MemoryWriteResult InMemoryMemoryStore::upsert(MemoryRecord record) {
    if (record.content.empty()) {
        return MemoryWriteResult::failure("memory content is empty");
    }
    if (record.key.empty()) {
        record.key = record.content.substr(0, std::min<std::size_t>(record.content.size(), 48));
    }
    if (record.updated_at_ms == 0) {
        record.updated_at_ms = record.created_at_ms;
    }

    std::lock_guard<std::mutex> lock(m_mutex);

    if (record.id.empty()) {
        record.id = nextId();
    }

    for (auto &existing : m_records) {
        if (existing.id == record.id) {
            if (record.created_at_ms == 0) {
                record.created_at_ms = existing.created_at_ms;
            }
            existing = std::move(record);
            return MemoryWriteResult::success(existing.id);
        }
    }

    if (auto same = findSameMemory(record)) {
        auto &existing = m_records[*same];
        if (record.created_at_ms == 0) {
            record.created_at_ms = existing.created_at_ms;
        }
        record.id = existing.id;
        existing = std::move(record);
        return MemoryWriteResult::success(existing.id);
    }

    if (record.created_at_ms == 0) {
        record.created_at_ms = record.updated_at_ms;
    }

    const std::string id = record.id;
    m_records.emplace_back(std::move(record));
    return MemoryWriteResult::success(id);
}

MemoryWriteResult InMemoryMemoryStore::forget(const std::string &id) {
    std::lock_guard<std::mutex> lock(m_mutex);
    auto it = std::find_if(m_records.begin(), m_records.end(), [&id](const MemoryRecord &record) {
        return record.id == id;
    });
    if (it == m_records.end()) {
        return MemoryWriteResult::failure("memory not found: " + id);
    }
    m_records.erase(it);
    return MemoryWriteResult::success(id);
}

std::vector<MemoryRecord> InMemoryMemoryStore::listAll() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_records;
}

void InMemoryMemoryStore::clear() {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_records.clear();
    m_next_id = 1;
}

bool InMemoryMemoryStore::matchesScope(const MemoryRecord &record, const MemoryQuery &query) const {
    switch (record.scope) {
        case MemoryScope::Global: return query.include_global;
        case MemoryScope::Agent: return record.agent_id == query.agent_id;
        case MemoryScope::User: return record.user_id == query.user_id;
        case MemoryScope::Room: return record.room_id == query.room_id;
        case MemoryScope::Conversation: return record.conversation_id == query.conversation_id;
    }
    return false;
}

double InMemoryMemoryStore::score(const MemoryRecord &record, const MemoryQuery &query) const {
    double value = record.weight;

    if (record.pinned) {
        value += 100.0;
    }

    for (const auto &tag : query.tags) {
        if (hasTag(record, tag)) {
            value += 4.0;
        }
    }

    if (query.text.empty()) {
        return value;
    }

    const std::string haystack = searchableText(record);
    const auto tokens = tokenize(query.text);
    if (tokens.empty()) {
        return value;
    }

    double token_score = 0.0;
    for (const auto &token : tokens) {
        if (token.size() == 1) {
            continue;
        }
        if (haystack.find(token) != std::string::npos) {
            token_score += 1.0;
        }
    }

    if (token_score == 0.0) {
        token_score = substringOverlapScore(haystack, query.text);
    }

    if (token_score == 0.0 && !record.pinned) {
        return 0.0;
    }

    return value + token_score;
}

std::string InMemoryMemoryStore::nextId() {
    std::ostringstream out;
    out << "mem_" << m_next_id++;
    return out.str();
}

std::optional<std::size_t> InMemoryMemoryStore::findSameMemory(const MemoryRecord &record) const {
    for (std::size_t i = 0; i < m_records.size(); ++i) {
        const auto &existing = m_records[i];
        if (existing.scope == record.scope && existing.key == record.key && existing.agent_id == record.agent_id && existing.user_id == record.user_id &&
            existing.room_id == record.room_id && existing.conversation_id == record.conversation_id) {
            return i;
        }
    }
    return std::nullopt;
}

} // namespace atrium::agent
