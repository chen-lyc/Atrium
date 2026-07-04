import type {
  ConversationPhase,
  MessageId,
  ProposalDraft,
  TaskId,
} from "../core/agentTypes.ts";

export interface TaskMaterializationRecord {
  readonly taskId: TaskId;
  readonly attemptNo: number;
  readonly processedUntilBefore: MessageId;
  readonly handledUntilMessageId: MessageId;
  readonly inputMessageIds: readonly MessageId[];
  readonly triggerMessageIds: readonly MessageId[];
  readonly retrievedAnchorMessageIds: readonly MessageId[];
  readonly inputStanceRecordIds: readonly string[];
  readonly phaseAtGeneration: ConversationPhase;
  readonly contextVersionAtGeneration: string;
  readonly contextUpdatedAtMsAtGeneration: number;
  readonly promptTemplateVersion: string;
}

export interface TaskFreshness {
  readonly stale: boolean;
  readonly reasons: readonly ("phase_changed" | "context_changed")[];
}

export interface StanceCommitIntent {
  readonly taskId: TaskId;
  readonly responseKind: "reply" | "proposal";
  readonly phaseAtGeneration: ConversationPhase;
  readonly processedUntilBefore: MessageId;
  readonly handledUntilMessageId: MessageId;
  readonly inputMessageIds: readonly MessageId[];
  readonly retrievedAnchorMessageIds: readonly MessageId[];
  readonly inputStanceRecordIds: readonly string[];
  readonly content: string;
  readonly proposal?: ProposalDraft;
}

export function taskFreshness(
  phaseAtGeneration: ConversationPhase,
  contextVersionAtGeneration: string,
  currentPhase: ConversationPhase,
  currentContextVersion: string,
): TaskFreshness {
  const reasons: ("phase_changed" | "context_changed")[] = [];
  if (phaseAtGeneration !== currentPhase) {
    reasons.push("phase_changed");
  }
  if (contextVersionAtGeneration !== currentContextVersion) {
    reasons.push("context_changed");
  }
  return { stale: reasons.length > 0, reasons };
}
