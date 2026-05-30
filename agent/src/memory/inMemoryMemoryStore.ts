import type { MemoryQuery, MemoryRecord, MemoryStore, MemoryWriteResult } from "./memoryStore.ts";
import { MemoryScope, memoryWriteFailure, memoryWriteSuccess } from "./memoryStore.ts";

export class InMemoryMemoryStore implements MemoryStore {
  readonly #records: MemoryRecord[] = [];
  #nextId = 1;

  search(query: MemoryQuery): MemoryRecord[] {
    const matches = this.#records
      .filter((record) => this.matchesScope(record, query))
      .map((record) => ({ ...structuredClone(record), relevance: this.score(record, query) }))
      .filter((record) => record.relevance > 0 || record.pinned)
      .toSorted((lhs, rhs) => {
        if (lhs.pinned !== rhs.pinned) {
          return lhs.pinned ? -1 : 1;
        }
        if (lhs.relevance !== rhs.relevance) {
          return rhs.relevance - lhs.relevance;
        }
        return rhs.updatedAtMs - lhs.updatedAtMs;
      });

    return query.limit > 0 ? matches.slice(0, query.limit) : matches;
  }

  upsert(record: MemoryRecord): MemoryWriteResult {
    const next = structuredClone(record);
    if (next.content.length === 0) {
      return memoryWriteFailure("memory content is empty");
    }
    if (next.key.length === 0) {
      next.key = next.content.slice(0, 48);
    }
    if (next.updatedAtMs === 0) {
      next.updatedAtMs = next.createdAtMs;
    }
    if (next.id.length === 0) {
      next.id = this.nextId();
    }

    const byId = this.#records.findIndex((existing) => existing.id === next.id);
    if (byId !== -1) {
      const existing = this.#records[byId];
      if (existing && next.createdAtMs === 0) {
        next.createdAtMs = existing.createdAtMs;
      }
      this.#records[byId] = next;
      return memoryWriteSuccess(next.id);
    }

    const same = this.findSameMemory(next);
    if (same !== -1) {
      const existing = this.#records[same];
      if (existing && next.createdAtMs === 0) {
        next.createdAtMs = existing.createdAtMs;
      }
      if (existing) {
        next.id = existing.id;
      }
      this.#records[same] = next;
      return memoryWriteSuccess(next.id);
    }

    if (next.createdAtMs === 0) {
      next.createdAtMs = next.updatedAtMs;
    }
    this.#records.push(next);
    return memoryWriteSuccess(next.id);
  }

  forget(id: string): MemoryWriteResult {
    const index = this.#records.findIndex((record) => record.id === id);
    if (index === -1) {
      return memoryWriteFailure(`memory not found: ${id}`);
    }
    this.#records.splice(index, 1);
    return memoryWriteSuccess(id);
  }

  listAll(): MemoryRecord[] {
    return structuredClone(this.#records);
  }

  clear(): void {
    this.#records.length = 0;
    this.#nextId = 1;
  }

  private matchesScope(record: MemoryRecord, query: MemoryQuery): boolean {
    switch (record.scope) {
      case MemoryScope.Global:
        return query.includeGlobal;
      case MemoryScope.Agent:
        return record.agentId === query.agentId;
      case MemoryScope.User:
        return record.userId === query.userId;
      case MemoryScope.Room:
        return record.roomId === query.roomId;
      case MemoryScope.Conversation:
        return record.conversationId === query.conversationId;
    }
  }

  private score(record: MemoryRecord, query: MemoryQuery): number {
    let value = record.weight;

    if (record.pinned) {
      value += 100;
    }

    for (const tag of query.tags) {
      if (record.tags.includes(tag)) {
        value += 4;
      }
    }

    if (query.text.length === 0) {
      return value;
    }

    const haystack = searchableText(record);
    const tokens = tokenize(query.text);
    if (tokens.length === 0) {
      return value;
    }

    let tokenScore = 0;
    for (const token of tokens) {
      if (token.length === 1) {
        continue;
      }
      if (haystack.includes(token)) {
        tokenScore += 1;
      }
    }

    if (tokenScore === 0) {
      tokenScore = substringOverlapScore(haystack, query.text);
    }
    if (tokenScore === 0 && !record.pinned) {
      return 0;
    }

    return value + tokenScore;
  }

  private nextId(): string {
    return `mem_${this.#nextId++}`;
  }

  private findSameMemory(record: MemoryRecord): number {
    return this.#records.findIndex(
      (existing) =>
        existing.scope === record.scope &&
        existing.key === record.key &&
        existing.agentId === record.agentId &&
        existing.userId === record.userId &&
        existing.roomId === record.roomId &&
        existing.conversationId === record.conversationId,
    );
  }
}

function lowerAscii(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function tokenize(value: string): string[] {
  return Array.from(value.matchAll(/[\p{L}\p{N}_]+/gu), (match) => lowerAscii(match[0]));
}

function searchableText(record: MemoryRecord): string {
  return lowerAscii([record.key, record.content, ...record.tags].join(" "));
}

function substringOverlapScore(haystack: string, rawNeedle: string): number {
  const needle = lowerAscii(rawNeedle);
  if (needle.length === 0) {
    return 0;
  }
  if (haystack.includes(needle)) {
    return 3;
  }
  if (needle.length < 6) {
    return 0;
  }

  let hits = 0;
  const window = 6;
  for (let i = 0; i + window <= needle.length; i += 1) {
    if (haystack.includes(needle.slice(i, i + window))) {
      hits += 1;
    }
  }

  return Math.min(3, hits * 0.15);
}

