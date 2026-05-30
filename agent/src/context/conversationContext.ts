import type { ConversationId, MessageId } from "../core/agentTypes.ts";
import { ZERO_ID, isZeroId } from "../core/agentTypes.ts";

export const ConversationPhase = {
  Divergence: "divergence",
  ConvergenceExecution: "convergence_execution",
  Blocked: "blocked",
} as const;

export type ConversationPhase = (typeof ConversationPhase)[keyof typeof ConversationPhase];

export const ConversationContextEntryKind = {
  Goal: "goal",
  Constraint: "constraint",
  Decision: "decision",
  RejectedOption: "rejected_option",
  OpenQuestion: "open_question",
  Risk: "risk",
  KeyFact: "key_fact",
  ProgressNote: "progress_note",
} as const;

export type ConversationContextEntryKind = (typeof ConversationContextEntryKind)[keyof typeof ConversationContextEntryKind];

export const ConversationContextEntryStatus = {
  Active: "active",
  Superseded: "superseded",
  Resolved: "resolved",
  Rejected: "rejected",
} as const;

export type ConversationContextEntryStatus = (typeof ConversationContextEntryStatus)[keyof typeof ConversationContextEntryStatus];

export interface SourceAnchor {
  messageId: MessageId;
  note: string;
}

export interface RejectedOptionRecord {
  option: string;
  reason: string;
  premise: string;
}

export interface ConversationContextEntry {
  id: string;
  kind: ConversationContextEntryKind;
  status: ConversationContextEntryStatus;
  content: string;
  rejectedOption?: RejectedOptionRecord;
  sources: SourceAnchor[];
  priority: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ConversationContextState {
  conversationId: ConversationId;
  phase: ConversationPhase;
  summary: string;
  entries: ConversationContextEntry[];
  lastSummarizedMessageId: MessageId;
  updatedAtMs: number;
}

export interface ConversationContextWriteResult {
  ok: boolean;
  error: string;
}

export interface ConversationContextStore {
  load(conversationId: ConversationId): ConversationContextState | undefined | Promise<ConversationContextState | undefined>;
  save(state: ConversationContextState): ConversationContextWriteResult | Promise<ConversationContextWriteResult>;
}

export class NullConversationContextStore implements ConversationContextStore {
  load(_conversationId: ConversationId): undefined {
    return undefined;
  }

  save(_state: ConversationContextState): ConversationContextWriteResult {
    return contextWriteFailure("null conversation context store is read-only");
  }
}

export function createConversationContextState(conversationId: ConversationId = ZERO_ID): ConversationContextState {
  return {
    conversationId,
    phase: ConversationPhase.Divergence,
    summary: "",
    entries: [],
    lastSummarizedMessageId: ZERO_ID,
    updatedAtMs: 0,
  };
}

export function conversationContextEmpty(state: ConversationContextState): boolean {
  return state.phase === ConversationPhase.Divergence && state.summary.length === 0 && state.entries.length === 0;
}

export function contextWriteSuccess(): ConversationContextWriteResult {
  return { ok: true, error: "" };
}

export function contextWriteFailure(error: string): ConversationContextWriteResult {
  return { ok: false, error };
}

export function entriesByKind(
  state: ConversationContextState,
  kind: ConversationContextEntryKind,
  includeInactive = false,
): ConversationContextEntry[] {
  return state.entries
    .filter((entry) => entry.kind === kind)
    .filter((entry) => includeInactive || entry.status === ConversationContextEntryStatus.Active)
    .toSorted((lhs, rhs) => {
      if (lhs.priority !== rhs.priority) {
        return rhs.priority - lhs.priority;
      }
      return rhs.updatedAtMs - lhs.updatedAtMs;
    });
}

export function isContextMessageCovered(state: ConversationContextState, messageId: MessageId): boolean {
  if (isZeroId(messageId) || isZeroId(state.lastSummarizedMessageId)) {
    return false;
  }
  return BigInt(messageId) <= BigInt(state.lastSummarizedMessageId);
}

export function rejectedOptionContent(record: RejectedOptionRecord): string {
  return `${record.option} | reason: ${record.reason} | premise: ${record.premise}`;
}
