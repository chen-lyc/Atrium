import type { AgentId, ConversationId, MessageId } from "../core/agentTypes.ts";
import { ZERO_ID, isZeroId } from "../core/agentTypes.ts";
import {
  contextWriteFailure,
  contextWriteSuccess,
  type ConversationContextWriteResult,
  type ConversationPhase,
} from "./conversationContext.ts";

export interface AgentStanceHistoryRecord {
  id: string;
  conversationId: ConversationId;
  agentId: AgentId;
  triggerMessageId: MessageId;
  responseMessageId: MessageId;
  phaseAtGeneration?: ConversationPhase;
  contextUntilMessageId: MessageId;
  inputStanceRecordIds: string[];
  content: string;
  createdAtMs: number;
  excludedAtMs?: number;
  exclusionReason?: string;
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
  phaseAtGeneration?: ConversationPhase;
  contextUntilMessageId?: MessageId;
  inputStanceRecordIds?: string[];
  content: string;
  createdAtMs: number;
}

export interface PurgeAgentStanceHistoryBySourceMessageRequest {
  conversationId: ConversationId;
  rootMessageId: MessageId;
  reason: string;
  excludedAtMs: number;
}

export interface AgentStanceHistoryPurgeResult extends ConversationContextWriteResult {
  affectedRecordIds: string[];
}

export interface AgentStanceHistoryStore {
  load(conversationId: ConversationId, agentId: AgentId): AgentStanceHistory | undefined | Promise<AgentStanceHistory | undefined>;
  append(record: AppendAgentStanceHistoryRecord): ConversationContextWriteResult | Promise<ConversationContextWriteResult>;
  purgeBySourceMessage(
    request: PurgeAgentStanceHistoryBySourceMessageRequest,
  ): AgentStanceHistoryPurgeResult | Promise<AgentStanceHistoryPurgeResult>;
}

export class NullAgentStanceHistoryStore implements AgentStanceHistoryStore {
  load(_conversationId: ConversationId, _agentId: AgentId): undefined {
    return undefined;
  }

  append(_record: AppendAgentStanceHistoryRecord): ConversationContextWriteResult {
    return contextWriteFailure("null stance history store is read-only");
  }

  purgeBySourceMessage(_request: PurgeAgentStanceHistoryBySourceMessageRequest): AgentStanceHistoryPurgeResult {
    return { ...contextWriteFailure("null stance history store is read-only"), affectedRecordIds: [] };
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
      ...(record.phaseAtGeneration ? { phaseAtGeneration: record.phaseAtGeneration } : {}),
      contextUntilMessageId: record.contextUntilMessageId ?? ZERO_ID,
      inputStanceRecordIds: [...(record.inputStanceRecordIds ?? [])],
      content: record.content,
      createdAtMs: record.createdAtMs,
    });
    next.updatedAtMs = record.createdAtMs;
    this.#histories.set(key, next);
    return contextWriteSuccess();
  }

  purgeBySourceMessage(request: PurgeAgentStanceHistoryBySourceMessageRequest): AgentStanceHistoryPurgeResult {
    if (isZeroId(request.conversationId)) {
      return { ...contextWriteFailure("stance history purge missing conversation_id"), affectedRecordIds: [] };
    }
    if (isZeroId(request.rootMessageId)) {
      return { ...contextWriteFailure("stance history purge missing root message id"), affectedRecordIds: [] };
    }
    if (request.reason.length === 0) {
      return { ...contextWriteFailure("stance history purge missing reason"), affectedRecordIds: [] };
    }

    const affectedRecordIds = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [key, history] of this.#histories.entries()) {
        if (history.conversationId !== request.conversationId) {
          continue;
        }

        const next = structuredClone(history);
        for (const record of next.records) {
          if (record.excludedAtMs !== undefined) {
            continue;
          }

          const directlyAffected =
            record.triggerMessageId === request.rootMessageId || record.responseMessageId === request.rootMessageId;
          const derivedFromAffected = record.inputStanceRecordIds.some((recordId) => affectedRecordIds.has(recordId));
          if (!directlyAffected && !derivedFromAffected) {
            continue;
          }

          record.excludedAtMs = request.excludedAtMs;
          record.exclusionReason = request.reason;
          affectedRecordIds.add(record.id);
          next.updatedAtMs = request.excludedAtMs;
          changed = true;
        }

        if (changed) {
          this.#histories.set(key, next);
        }
      }
    }

    return { ...contextWriteSuccess(), affectedRecordIds: [...affectedRecordIds] };
  }

  clear(): void {
    this.#histories.clear();
  }

  size(): number {
    return this.#histories.size;
  }
}

export function activeAgentStanceHistoryRecords(history: AgentStanceHistory | undefined): AgentStanceHistoryRecord[] {
  return (history?.records ?? []).filter((record) => record.excludedAtMs === undefined);
}

function historyKey(conversationId: ConversationId, agentId: AgentId): string {
  return `${conversationId}:${agentId}`;
}

function nextRecordId(history: AgentStanceHistory): string {
  return `stance_${history.conversationId}_${history.agentId}_${history.records.length + 1}`;
}
