import type { ConversationId, ConversationPhase, MessageId, MessageSourceAnchor } from "../core/agentTypes.ts";
import { ConversationPhase as ConversationPhaseValue, SourceAnchorStatus, ZERO_ID, compareIds, isZeroId } from "../core/agentTypes.ts";

export { SourceAnchorStatus } from "../core/agentTypes.ts";
export type { MessageSourceAnchor } from "../core/agentTypes.ts";

export const ConversationContextEntryKind = {
  Goal: "goal",
  Constraint: "constraint",
  Decision: "decision",
  CurrentDirection: "current_direction",
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

export interface NonMessageProvenance {
  readonly type: "owner_action" | "system_event";
  readonly provenanceId: string;
  readonly note?: string;
}

export type ContextProvenance = ({ readonly type: "message" } & MessageSourceAnchor) | NonMessageProvenance;

export interface RejectedOptionRecord {
  readonly option: string;
  readonly reason: string;
  readonly premise: string;
}

export interface ConversationContextEntry {
  readonly id: string;
  readonly kind: ConversationContextEntryKind;
  readonly status: ConversationContextEntryStatus;
  readonly content: string;
  readonly rejectedOption?: RejectedOptionRecord;
  readonly sources: readonly ContextProvenance[];
  readonly priority: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface ConversationContextState {
  readonly conversationId: ConversationId;
  readonly contextVersion: string;
  readonly phase: ConversationPhase;
  readonly summary: string;
  readonly entries: readonly ConversationContextEntry[];
  readonly lastSummarizedMessageId: MessageId;
  readonly updatedAtMs: number;
}

export interface ConversationContextReader {
  load(conversationId: ConversationId): ConversationContextState | undefined | Promise<ConversationContextState | undefined>;
}

export function createConversationContextState(
  conversationId: ConversationId = ZERO_ID,
  contextVersion = "0",
): ConversationContextState {
  return {
    conversationId,
    contextVersion,
    phase: ConversationPhaseValue.Divergence,
    summary: "",
    entries: [],
    lastSummarizedMessageId: ZERO_ID,
    updatedAtMs: 0,
  };
}

export function conversationContextEmpty(state: ConversationContextState): boolean {
  return state.summary.length === 0 && state.entries.length === 0;
}

export function entriesByKind(
  state: ConversationContextState,
  kind: ConversationContextEntryKind,
  includeInactive = false,
): ConversationContextEntry[] {
  return state.entries
    .filter((entry) => entry.kind === kind)
    .filter((entry) => includeInactive || entry.status === ConversationContextEntryStatus.Active)
    .toSorted((lhs, rhs) => (lhs.priority !== rhs.priority ? rhs.priority - lhs.priority : rhs.updatedAtMs - lhs.updatedAtMs));
}

export function validateConfirmedConversationContext(state: ConversationContextState): string[] {
  const errors: string[] = [];
  if (isZeroId(state.conversationId)) {
    errors.push("conversation context missing conversation_id");
  }
  if (state.contextVersion.length === 0) {
    errors.push("conversation context missing context_version");
  }
  if (!Object.values(ConversationPhaseValue).includes(state.phase)) {
    errors.push(`conversation context has unsupported phase: ${String(state.phase)}`);
  }
  if (!Number.isSafeInteger(state.updatedAtMs) || state.updatedAtMs < 0) {
    errors.push("conversation context has invalid updated_at_ms");
  }
  const entryIds = new Set<string>();
  for (const entry of state.entries) {
    if (entryIds.has(entry.id)) {
      errors.push(`duplicate context entry id: ${entry.id}`);
    }
    entryIds.add(entry.id);
    if (!Object.values(ConversationContextEntryKind).includes(entry.kind)) {
      errors.push(`context entry ${entry.id} has unsupported kind`);
    }
    if (!Object.values(ConversationContextEntryStatus).includes(entry.status)) {
      errors.push(`context entry ${entry.id} has unsupported status`);
    }
    if (entry.content.trim().length === 0 && entry.kind !== ConversationContextEntryKind.RejectedOption) {
      errors.push(`context entry ${entry.id} missing content`);
    }
    if (entry.sources.length === 0) {
      errors.push(`context entry ${entry.id} missing provenance`);
    }
    for (const source of entry.sources) {
      if (source.type === "message") {
        if (isZeroId(source.messageId)) {
          errors.push(`context entry ${entry.id} has invalid message source`);
        }
        if (!Object.values(SourceAnchorStatus).includes(source.status)) {
          errors.push(`context entry ${entry.id} has unsupported source status`);
        }
      } else if (source.type === "owner_action" || source.type === "system_event") {
        if (!source.provenanceId.trim()) {
          errors.push(`context entry ${entry.id} has empty non-message provenance`);
        }
      } else {
        errors.push(`context entry ${entry.id} has unsupported provenance type`);
      }
    }
    if (entry.kind === ConversationContextEntryKind.RejectedOption) {
      const rejected = entry.rejectedOption;
      if (!rejected?.option.trim() || !rejected.reason.trim() || !rejected.premise.trim()) {
        errors.push(`rejected option ${entry.id} must contain option, reason, and premise`);
      }
    } else if (entry.rejectedOption) {
      errors.push(`non-rejected context entry ${entry.id} cannot carry rejected-option fields`);
    }
  }
  return errors;
}

export function isContextMessageCovered(state: ConversationContextState, messageId: MessageId): boolean {
  if (isZeroId(messageId) || isZeroId(state.lastSummarizedMessageId)) {
    return false;
  }
  return compareIds(messageId, state.lastSummarizedMessageId) <= 0;
}

export function rejectedOptionContent(record: RejectedOptionRecord): string {
  return `${record.option} | reason: ${record.reason} | premise: ${record.premise}`;
}
