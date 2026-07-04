import type { ConversationId, MessageId, TaskId } from "../core/agentTypes.ts";

export interface CommittedTaskTrace {
  readonly taskId: TaskId;
  readonly conversationId: ConversationId;
  readonly inputMessageIds: readonly MessageId[];
  readonly inputStanceRecordIds: readonly string[];
  readonly responseMessageId?: MessageId;
  readonly stanceRecordId?: string;
}

export interface SourceBackedArtifact {
  readonly id: string;
  readonly kind: "whiteboard_entry" | "draft" | "proposal";
  readonly sourceMessageIds: readonly MessageId[];
}

export interface PurgeBySourceMessageInput {
  readonly conversationId: ConversationId;
  readonly rootMessageId: MessageId;
  readonly selectedMessageSeedIds?: readonly MessageId[];
  readonly selectedStanceSeedIds?: readonly string[];
  readonly conservative: boolean;
}

export interface ProvenancePurgePlan {
  readonly affectedTaskIds: readonly TaskId[];
  readonly quarantinedMessageIds: readonly MessageId[];
  readonly excludedStanceRecordIds: readonly string[];
  readonly staleArtifactIds: readonly string[];
}

/**
 * Computes observable exposure descendants. Edges mean "entered the prompt", not
 * hidden model causality. Authorization and persistence remain backend-owned.
 */
export function buildProvenancePurgePlan(
  input: PurgeBySourceMessageInput,
  traces: readonly CommittedTaskTrace[],
  artifacts: readonly SourceBackedArtifact[] = [],
): ProvenancePurgePlan {
  const tasks = traces.filter((trace) => trace.conversationId === input.conversationId);
  const messages = new Set<MessageId>([input.rootMessageId, ...(input.selectedMessageSeedIds ?? [])]);
  const propagatingMessages = new Set<MessageId>(input.selectedMessageSeedIds ?? []);
  if (input.conservative) {
    propagatingMessages.add(input.rootMessageId);
  }
  const stances = new Set<string>(input.selectedStanceSeedIds ?? []);
  const affectedTasks = new Set<TaskId>();

  for (const trace of tasks) {
    if (trace.inputMessageIds.includes(input.rootMessageId)) {
      affectedTasks.add(trace.taskId);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const trace of tasks) {
      const exposed = trace.inputMessageIds.some((id) => propagatingMessages.has(id))
        || trace.inputStanceRecordIds.some((id) => stances.has(id));
      if (!exposed) {
        continue;
      }
      affectedTasks.add(trace.taskId);
      if (trace.responseMessageId && !messages.has(trace.responseMessageId)) {
        messages.add(trace.responseMessageId);
        propagatingMessages.add(trace.responseMessageId);
        changed = true;
      }
      if (trace.stanceRecordId && !stances.has(trace.stanceRecordId)) {
        stances.add(trace.stanceRecordId);
        changed = true;
      }
    }
  }

  const staleArtifactIds = artifacts
    .filter((artifact) => artifact.sourceMessageIds.some((id) => messages.has(id)))
    .map((artifact) => artifact.id);

  return {
    affectedTaskIds: [...affectedTasks],
    quarantinedMessageIds: [...messages],
    excludedStanceRecordIds: [...stances],
    staleArtifactIds,
  };
}
