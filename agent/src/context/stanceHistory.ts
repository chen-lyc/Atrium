import type { AgentId, ConversationId, MessageId } from "../core/agentTypes.ts";
import { ZERO_ID, isZeroId } from "../core/agentTypes.ts";
import { contextWriteFailure, contextWriteSuccess, type ConversationContextWriteResult } from "./conversationContext.ts";

export interface AgentStanceHistoryRecord {
  id: string;
  conversationId: ConversationId;
  agentId: AgentId;
  triggerMessageId: MessageId;
  responseMessageId: MessageId;
  content: string;
  createdAtMs: number;
}

export interface AgentStanceHistory {
  conversationId: ConversationId;
  agentId: AgentId;
  records: AgentStanceHistoryRecord[];
  updatedAtMs: number;
}

export interface AppendAgentStanceHistoryRecord {
  conversationId: ConversationId;
  agentId: AgentId;
  triggerMessageId: MessageId;
  responseMessageId?: MessageId;
  content: string;
  createdAtMs: number;
}

export interface AgentStanceHistoryStore {
  load(conversationId: ConversationId, agentId: AgentId): AgentStanceHistory | undefined | Promise<AgentStanceHistory | undefined>;
  append(record: AppendAgentStanceHistoryRecord): ConversationContextWriteResult | Promise<ConversationContextWriteResult>;
}

export class NullAgentStanceHistoryStore implements AgentStanceHistoryStore {
  load(_conversationId: ConversationId, _agentId: AgentId): undefined {
    return undefined;
  }

  append(_record: AppendAgentStanceHistoryRecord): ConversationContextWriteResult {
    return contextWriteFailure("null stance history store is read-only");
  }
}

export class InMemoryAgentStanceHistoryStore implements AgentStanceHistoryStore {
  readonly #histories = new Map<string, AgentStanceHistory>();

  load(conversationId: ConversationId, agentId: AgentId): AgentStanceHistory | undefined {
    const history = this.#histories.get(historyKey(conversationId, agentId));
    return history ? structuredClone(history) : undefined;
  }

  append(record: AppendAgentStanceHistoryRecord): ConversationContextWriteResult {
    if (isZeroId(record.conversationId)) {
      return contextWriteFailure("stance history record missing conversation_id");
    }
    if (isZeroId(record.agentId)) {
      return contextWriteFailure("stance history record missing agent_id");
    }
    if (record.content.length === 0) {
      return contextWriteFailure("stance history record missing content");
    }

    const key = historyKey(record.conversationId, record.agentId);
    const existing =
      this.#histories.get(key) ??
      ({
        conversationId: record.conversationId,
        agentId: record.agentId,
        records: [],
        updatedAtMs: 0,
      } satisfies AgentStanceHistory);

    const next: AgentStanceHistory = structuredClone(existing);
    next.records.push({
      id: nextRecordId(next),
      conversationId: record.conversationId,
      agentId: record.agentId,
      triggerMessageId: record.triggerMessageId,
      responseMessageId: record.responseMessageId ?? ZERO_ID,
      content: record.content,
      createdAtMs: record.createdAtMs,
    });
    next.updatedAtMs = record.createdAtMs;
    this.#histories.set(key, next);
    return contextWriteSuccess();
  }

  clear(): void {
    this.#histories.clear();
  }

  size(): number {
    return this.#histories.size;
  }
}

function historyKey(conversationId: ConversationId, agentId: AgentId): string {
  return `${conversationId}:${agentId}`;
}

function nextRecordId(history: AgentStanceHistory): string {
  return `stance_${history.conversationId}_${history.agentId}_${history.records.length + 1}`;
}
