import type { ConversationId, MessageId } from "../core/agentTypes.ts";
import { ZERO_ID, isZeroId } from "../core/agentTypes.ts";
import type {
  ConversationContextEntry,
  ConversationContextEntryStatus as ConversationContextEntryStatusType,
  ConversationContextState,
  ConversationPhase as ConversationPhaseType,
} from "./conversationContext.ts";
import {
  ConversationContextEntryKind,
  ConversationContextEntryStatus,
  ConversationPhase,
  rejectedOptionContent,
} from "./conversationContext.ts";

export const ConversationContextPatchOperation = {
  UpsertEntry: "upsert_entry",
  MarkEntryStatus: "mark_entry_status",
  RemoveEntry: "remove_entry",
  UpdateSummary: "update_summary",
  SetLastSummarizedMessage: "set_last_summarized_message",
  SetPhase: "set_phase",
} as const;

export type ConversationContextPatchOperation =
  (typeof ConversationContextPatchOperation)[keyof typeof ConversationContextPatchOperation];

export const ConversationContextPatchAuthor = {
  Owner: "owner",
  System: "system",
} as const;

export type ConversationContextPatchAuthor =
  (typeof ConversationContextPatchAuthor)[keyof typeof ConversationContextPatchAuthor];

export interface ConversationContextPatchItem {
  operation: ConversationContextPatchOperation;
  entry?: ConversationContextEntry;
  targetEntryId?: string;
  status?: ConversationContextEntryStatusType;
  summary?: string;
  messageId?: MessageId;
  phase?: ConversationPhaseType;
}

export interface ConversationContextPatch {
  conversationId: ConversationId;
  author: ConversationContextPatchAuthor;
  updatedAtMs: number;
  items: ConversationContextPatchItem[];
}

export interface ConversationContextApplyResult {
  ok: boolean;
  error: string;
  state: ConversationContextState;
}

export interface ConversationContextPolicy {
  maxUnsummarizedMessages: bigint;
}

export const DEFAULT_CONVERSATION_CONTEXT_POLICY: ConversationContextPolicy = {
  maxUnsummarizedMessages: 40n,
};

export class ConversationContextManager {
  readonly #policy: ConversationContextPolicy;

  constructor(policy: ConversationContextPolicy = DEFAULT_CONVERSATION_CONTEXT_POLICY) {
    this.#policy = policy;
  }

  applyPatch(state: ConversationContextState, patch: ConversationContextPatch): ConversationContextApplyResult {
    const next = structuredClone(state);

    if (isZeroId(patch.conversationId)) {
      return applyFailure("patch missing conversation_id", next);
    }
    if (!isZeroId(next.conversationId) && next.conversationId !== patch.conversationId) {
      return applyFailure("patch conversation_id does not match state", next);
    }
    if (isZeroId(next.conversationId)) {
      next.conversationId = patch.conversationId;
    }

    for (const item of patch.items) {
      switch (item.operation) {
        case ConversationContextPatchOperation.UpsertEntry: {
          if (item.entry && this.entryRequiresOwner(item.entry) && patch.author !== ConversationContextPatchAuthor.Owner) {
            return applyFailure("decision-zone entries require owner patch author", next);
          }
          if (!item.entry || !this.upsertEntry(next, item.entry, patch.updatedAtMs)) {
            return applyFailure("failed to upsert conversation context entry", next);
          }
          break;
        }
        case ConversationContextPatchOperation.MarkEntryStatus: {
          const target = item.targetEntryId ?? "";
          const status = item.status ?? ConversationContextEntryStatus.Active;
          if (this.targetEntryRequiresOwner(next, target) && patch.author !== ConversationContextPatchAuthor.Owner) {
            return applyFailure("decision-zone entry status changes require owner patch author", next);
          }
          if (!this.markEntryStatus(next, target, status, patch.updatedAtMs)) {
            return applyFailure(`conversation context entry not found: ${target}`, next);
          }
          break;
        }
        case ConversationContextPatchOperation.RemoveEntry: {
          const target = item.targetEntryId ?? "";
          if (this.targetEntryRequiresOwner(next, target) && patch.author !== ConversationContextPatchAuthor.Owner) {
            return applyFailure("decision-zone entry removal requires owner patch author", next);
          }
          if (!this.removeEntry(next, target)) {
            return applyFailure(`conversation context entry not found: ${target}`, next);
          }
          break;
        }
        case ConversationContextPatchOperation.UpdateSummary: {
          next.summary = item.summary ?? "";
          break;
        }
        case ConversationContextPatchOperation.SetLastSummarizedMessage: {
          next.lastSummarizedMessageId = item.messageId ?? ZERO_ID;
          break;
        }
        case ConversationContextPatchOperation.SetPhase: {
          if (patch.author !== ConversationContextPatchAuthor.Owner) {
            return applyFailure("conversation phase changes require owner patch author", next);
          }
          if (!item.phase) {
            return applyFailure("conversation phase patch missing phase", next);
          }
          next.phase = item.phase;
          break;
        }
      }
    }

    if (patch.updatedAtMs !== 0) {
      next.updatedAtMs = patch.updatedAtMs;
    }

    return applySuccess(next);
  }

  needsSummarization(state: ConversationContextState, latestMessageId: MessageId): boolean {
    if (isZeroId(latestMessageId) || BigInt(latestMessageId) <= BigInt(state.lastSummarizedMessageId)) {
      return false;
    }
    return BigInt(latestMessageId) - BigInt(state.lastSummarizedMessageId) >= this.#policy.maxUnsummarizedMessages;
  }

  private upsertEntry(state: ConversationContextState, incoming: ConversationContextEntry, updatedAtMs: number): boolean {
    const entry = structuredClone(incoming);
    if (!this.normalizeRejectedOptionEntry(entry)) {
      return false;
    }
    if (entry.content.length === 0) {
      return false;
    }
    if (entry.id.length === 0) {
      entry.id = this.nextEntryId(state);
    }
    if (updatedAtMs !== 0) {
      entry.updatedAtMs = updatedAtMs;
      if (entry.createdAtMs === 0) {
        entry.createdAtMs = updatedAtMs;
      }
    }

    const index = state.entries.findIndex((existing) => existing.id === entry.id);
    if (index === -1) {
      state.entries.push(entry);
      return true;
    }

    const existing = state.entries[index];
    if (existing && entry.createdAtMs === 0) {
      entry.createdAtMs = existing.createdAtMs;
    }
    state.entries[index] = entry;
    return true;
  }

  private markEntryStatus(
    state: ConversationContextState,
    entryId: string,
    status: ConversationContextEntryStatusType,
    updatedAtMs: number,
  ): boolean {
    const entry = state.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      return false;
    }
    entry.status = status;
    if (updatedAtMs !== 0) {
      entry.updatedAtMs = updatedAtMs;
    }
    return true;
  }

  private removeEntry(state: ConversationContextState, entryId: string): boolean {
    const before = state.entries.length;
    state.entries = state.entries.filter((entry) => entry.id !== entryId);
    return state.entries.length !== before;
  }

  private nextEntryId(state: ConversationContextState): string {
    return `ctx_${state.conversationId}_${state.entries.length + 1}`;
  }

  private entryRequiresOwner(entry: ConversationContextEntry): boolean {
    return entry.kind === ConversationContextEntryKind.Decision || entry.kind === ConversationContextEntryKind.RejectedOption;
  }

  private targetEntryRequiresOwner(state: ConversationContextState, entryId: string): boolean {
    const entry = state.entries.find((candidate) => candidate.id === entryId);
    return entry ? this.entryRequiresOwner(entry) : false;
  }

  private normalizeRejectedOptionEntry(entry: ConversationContextEntry): boolean {
    if (entry.kind !== ConversationContextEntryKind.RejectedOption) {
      return true;
    }

    const record = entry.rejectedOption;
    if (!record || record.option.length === 0 || record.reason.length === 0 || record.premise.length === 0) {
      return false;
    }

    if (entry.content.length === 0) {
      entry.content = rejectedOptionContent(record);
    }
    return true;
  }
}

function applySuccess(state: ConversationContextState): ConversationContextApplyResult {
  return { ok: true, error: "", state };
}

function applyFailure(error: string, state: ConversationContextState): ConversationContextApplyResult {
  return { ok: false, error, state };
}
