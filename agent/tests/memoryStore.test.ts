import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryMemoryStore } from "../src/memory/inMemoryMemoryStore.ts";
import { MemoryKind, MemoryScope, type MemoryRecord } from "../src/memory/memoryStore.ts";

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "",
    key: "",
    content: "Keep sidebar menus out of the main title",
    scope: MemoryScope.Conversation,
    kind: MemoryKind.Fact,
    agentId: "7",
    userId: "11",
    roomId: "3",
    conversationId: "5",
    sourceMessageId: "100",
    createdAtMs: 10,
    updatedAtMs: 10,
    tags: ["atrium"],
    weight: 1,
    relevance: 0,
    pinned: false,
    ...overrides,
  };
}

test("in-memory memory store upserts and searches scoped records", () => {
  const store = new InMemoryMemoryStore();
  const write = store.upsert(memory());

  assert.equal(write.ok, true);
  assert.equal(write.id, "mem_1");

  const matches = store.search({
    agentId: "7",
    userId: "11",
    roomId: "3",
    conversationId: "5",
    text: "sidebar title",
    tags: [],
    limit: 8,
    includeGlobal: true,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, "mem_1");
  assert.ok((matches[0]?.relevance ?? 0) > 0);
});

