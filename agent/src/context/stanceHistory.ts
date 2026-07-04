import type {
  AgentId,
  ConversationId,
  ConversationPhase,
  MessageId,
  ProposalId,
  ProposalStatus,
  TaskId,
} from "../core/agentTypes.ts";
import { AgentDecision, ProposalStatus as ProposalStatusValue, isZeroId } from "../core/agentTypes.ts";

export type StanceResponseKind = "reply" | "proposal";

export interface AgentStanceHistoryRecord {
  readonly id: string;
  readonly conversationId: ConversationId;
  readonly agentId: AgentId;
  readonly taskId: TaskId;
  readonly responseMessageId: MessageId;
  readonly responseKind: StanceResponseKind;
  readonly proposalId?: ProposalId;
  /** Read-side projection of the proposal's current governance status. */
  readonly proposalStatus?: ProposalStatus;
  /** Status-aware summary used when proposal stance enters the private evidence slot. */
  readonly proposalDigest?: string;
  readonly phaseAtGeneration: ConversationPhase;
  readonly processedUntilBefore: MessageId;
  readonly handledUntilMessageId: MessageId;
  readonly inputMessageIds: readonly MessageId[];
  readonly retrievedAnchorMessageIds: readonly MessageId[];
  readonly inputStanceRecordIds: readonly string[];
  readonly content: string;
  readonly createdAtMs: number;
  readonly excludedAtMs?: number;
  readonly exclusionReason?: string;
}

export interface AgentStanceHistory {
  readonly conversationId: ConversationId;
  readonly agentId: AgentId;
  readonly records: readonly AgentStanceHistoryRecord[];
  readonly updatedAtMs: number;
}

export interface AgentStanceHistoryReader {
  load(conversationId: ConversationId, agentId: AgentId): AgentStanceHistory | undefined | Promise<AgentStanceHistory | undefined>;
}

export interface AppendAgentStanceHistoryRecord {
  readonly conversationId: ConversationId;
  readonly agentId: AgentId;
  readonly taskId: TaskId;
  readonly responseMessageId: MessageId;
  readonly responseKind: StanceResponseKind;
  readonly proposalId?: ProposalId;
  readonly proposalDigest?: string;
  readonly phaseAtGeneration: ConversationPhase;
  readonly processedUntilBefore: MessageId;
  readonly handledUntilMessageId: MessageId;
  readonly inputMessageIds: readonly MessageId[];
  readonly retrievedAnchorMessageIds: readonly MessageId[];
  readonly inputStanceRecordIds: readonly string[];
  readonly content: string;
  readonly createdAtMs: number;
}

export interface StanceAppendResult {
  readonly ok: boolean;
  readonly error: string;
  readonly recordId?: string;
}

/** Test/domain ledger. AgentRuntime only depends on AgentStanceHistoryReader and cannot append. */
export class InMemoryAgentStanceHistoryLedger implements AgentStanceHistoryReader {
  readonly #histories = new Map<string, AgentStanceHistory>();

  constructor(histories: readonly AgentStanceHistory[] = []) {
    for (const history of histories) {
      this.#histories.set(historyKey(history.conversationId, history.agentId), structuredClone(history));
    }
  }

  load(conversationId: ConversationId, agentId: AgentId): AgentStanceHistory | undefined {
    const history = this.#histories.get(historyKey(conversationId, agentId));
    return history ? structuredClone(history) : undefined;
  }

  appendCommitted(record: AppendAgentStanceHistoryRecord): StanceAppendResult {
    const error = validateAppend(record);
    if (error) {
      return { ok: false, error };
    }
    const key = historyKey(record.conversationId, record.agentId);
    const existing = this.#histories.get(key) ?? {
      conversationId: record.conversationId,
      agentId: record.agentId,
      records: [],
      updatedAtMs: 0,
    };
    if (existing.records.some((item) => item.taskId === record.taskId)) {
      return { ok: false, error: "a task may append at most one stance record" };
    }
    const recordId = `stance_${record.conversationId}_${record.agentId}_${existing.records.length + 1}`;
    const next: AgentStanceHistory = {
      ...structuredClone(existing),
      records: [
        ...existing.records,
        {
          id: recordId,
          ...structuredClone(record),
          ...(record.responseKind === AgentDecision.Proposal ? { proposalStatus: ProposalStatusValue.Pending } : {}),
        },
      ],
      updatedAtMs: record.createdAtMs,
    };
    this.#histories.set(key, next);
    return { ok: true, error: "", recordId };
  }

  excludeRecords(recordIds: readonly string[], excludedAtMs: number, reason: string): readonly string[] {
    const requested = new Set(recordIds);
    const affected: string[] = [];
    for (const [key, history] of this.#histories) {
      let historyChanged = false;
      const records = history.records.map((record) => {
        if (!requested.has(record.id) || record.excludedAtMs !== undefined) {
          return record;
        }
        affected.push(record.id);
        historyChanged = true;
        return { ...record, excludedAtMs, exclusionReason: reason };
      });
      this.#histories.set(key, { ...history, records, updatedAtMs: historyChanged ? excludedAtMs : history.updatedAtMs });
    }
    return affected;
  }
}

export function activeAgentStanceHistoryRecords(history: AgentStanceHistory | undefined): AgentStanceHistoryRecord[] {
  return (history?.records ?? []).filter((record) => record.excludedAtMs === undefined);
}

export function validateMaterializedStanceHistory(history: AgentStanceHistory | undefined): string[] {
  const errors: string[] = [];
  const recordIds = new Set<string>();
  for (const record of activeAgentStanceHistoryRecords(history)) {
    if (!record.id.trim()) {
      errors.push("stance record is missing record id");
    }
    if (recordIds.has(record.id)) {
      errors.push(`duplicate stance record id: ${record.id}`);
    }
    recordIds.add(record.id);
    if (history && (record.conversationId !== history.conversationId || record.agentId !== history.agentId)) {
      errors.push(`stance record ${record.id} crossed history boundary`);
    }
    if (!record.taskId || !record.responseMessageId || !record.handledUntilMessageId || !record.content.trim()) {
      errors.push(`stance record ${record.id} is missing committed provenance or content`);
    }
    if (new Set(record.inputMessageIds).size !== record.inputMessageIds.length) {
      errors.push(`stance record ${record.id} has duplicate input_message_ids`);
    }
    if (new Set(record.retrievedAnchorMessageIds).size !== record.retrievedAnchorMessageIds.length) {
      errors.push(`stance record ${record.id} has duplicate retrieved_anchor_message_ids`);
    }
    if (record.responseKind === AgentDecision.Proposal
      && (!record.proposalId || !record.proposalStatus || !record.proposalDigest?.trim())) {
      errors.push(`proposal stance ${record.id} requires proposal_id, current proposal_status, and proposal_digest`);
    }
    if (record.proposalStatus && !Object.values(ProposalStatusValue).includes(record.proposalStatus)) {
      errors.push(`proposal stance ${record.id} has unsupported proposal_status`);
    }
    if (record.responseKind === AgentDecision.Reply && (record.proposalId || record.proposalStatus || record.proposalDigest)) {
      errors.push(`reply stance ${record.id} cannot carry proposal metadata`);
    }
  }
  return errors;
}

export function selectPrivateStanceRecords(
  history: AgentStanceHistory | undefined,
  selectedMessageIds: ReadonlySet<MessageId>,
  maxRecords: number,
): AgentStanceHistoryRecord[] {
  const candidates = activeAgentStanceHistoryRecords(history).filter(
    (record) => !selectedMessageIds.has(record.responseMessageId),
  );
  if (maxRecords <= 0) {
    return [];
  }
  if (candidates.length <= maxRecords) {
    return candidates;
  }
  if (maxRecords === 1) {
    return [candidates[0]!];
  }
  return [candidates[0]!, ...candidates.slice(-(maxRecords - 1))];
}

function validateAppend(record: AppendAgentStanceHistoryRecord): string | undefined {
  if (isZeroId(record.conversationId) || isZeroId(record.agentId) || isZeroId(record.taskId)) {
    return "stance append missing conversation_id, ai_id, or task_id";
  }
  if (isZeroId(record.responseMessageId) || isZeroId(record.handledUntilMessageId)) {
    return "stance append requires committed response_message_id and handled_until_message_id";
  }
  if (record.content.trim().length === 0) {
    return "stance append missing content";
  }
  if (new Set(record.inputStanceRecordIds).size !== record.inputStanceRecordIds.length) {
    return "stance append input_stance_record_ids must be unique";
  }
  if (new Set(record.inputMessageIds).size !== record.inputMessageIds.length) {
    return "stance append input_message_ids must be unique";
  }
  if (new Set(record.retrievedAnchorMessageIds).size !== record.retrievedAnchorMessageIds.length) {
    return "stance append retrieved_anchor_message_ids must be unique";
  }
  if (record.responseKind === AgentDecision.Proposal && (!record.proposalId || !record.proposalDigest?.trim())) {
    return "proposal stance append requires proposal_id and proposal_digest";
  }
  if (record.responseKind === AgentDecision.Reply && (record.proposalId || record.proposalDigest)) {
    return "reply stance append cannot carry proposal_id";
  }
  return undefined;
}

function historyKey(conversationId: ConversationId, agentId: AgentId): string {
  return `${conversationId}:${agentId}`;
}
