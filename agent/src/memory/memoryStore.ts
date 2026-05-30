import type { AgentId, AgentProfile, ConversationId, MessageId, RoomId, TurnContext, UserId } from "../core/agentTypes.ts";

export const MemoryScope = {
  Global: "global",
  Agent: "agent",
  User: "user",
  Room: "room",
  Conversation: "conversation",
} as const;

export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

export const MemoryKind = {
  Fact: "fact",
  Preference: "preference",
  Summary: "summary",
  Instruction: "instruction",
  Observation: "observation",
} as const;

export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export interface MemoryRecord {
  id: string;
  key: string;
  content: string;
  scope: MemoryScope;
  kind: MemoryKind;
  agentId: AgentId;
  userId: UserId;
  roomId: RoomId;
  conversationId: ConversationId;
  sourceMessageId: MessageId;
  createdAtMs: number;
  updatedAtMs: number;
  tags: string[];
  weight: number;
  relevance: number;
  pinned: boolean;
}

export interface MemoryQuery {
  agentId: AgentId;
  userId: UserId;
  roomId: RoomId;
  conversationId: ConversationId;
  text: string;
  tags: string[];
  limit: number;
  includeGlobal: boolean;
}

export interface MemoryWriteResult {
  ok: boolean;
  id: string;
  error: string;
}

export interface MemoryStore {
  search(query: MemoryQuery): MemoryRecord[] | Promise<MemoryRecord[]>;
  upsert(record: MemoryRecord): MemoryWriteResult | Promise<MemoryWriteResult>;
  forget(id: string): MemoryWriteResult | Promise<MemoryWriteResult>;
  loadForTurn?(agent: AgentProfile, turn: TurnContext): MemoryRecord[] | Promise<MemoryRecord[]>;
}

export class NullMemoryStore implements MemoryStore {
  search(_query: MemoryQuery): MemoryRecord[] {
    return [];
  }

  upsert(_record: MemoryRecord): MemoryWriteResult {
    return memoryWriteFailure("null memory store is read-only");
  }

  forget(_id: string): MemoryWriteResult {
    return memoryWriteFailure("null memory store is read-only");
  }
}

export function memoryWriteSuccess(id: string): MemoryWriteResult {
  return { ok: true, id, error: "" };
}

export function memoryWriteFailure(error: string): MemoryWriteResult {
  return { ok: false, id: "", error };
}

export function buildMemoryQueryForTurn(agent: AgentProfile, turn: TurnContext): MemoryQuery {
  return {
    agentId: agent.id,
    userId: turn.userId,
    roomId: turn.roomId,
    conversationId: turn.conversationId,
    text: turn.messages.at(-1)?.content ?? "",
    tags: [],
    limit: 8,
    includeGlobal: true,
  };
}

export async function loadMemoryForTurn(store: MemoryStore, agent: AgentProfile, turn: TurnContext): Promise<MemoryRecord[]> {
  if (store.loadForTurn) {
    return store.loadForTurn(agent, turn);
  }
  return store.search(buildMemoryQueryForTurn(agent, turn));
}

