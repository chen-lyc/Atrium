import type { AgentId, AgentProfile, AgentTaskSnapshot, AgentWakeupRef, ConversationId, MessageId, TurnContext } from "../core/agentTypes.ts";
import { AgentDecision, compareIds } from "../core/agentTypes.ts";
import type { AgentRunTurnResult } from "../runtime/agentRuntime.ts";

export type AtriumAgentTurnRef = AgentWakeupRef;

export interface AtriumAgentReadMaterialization {
  readonly agent: AgentProfile;
  readonly turn: TurnContext;
}

/** Agent-side read materializer. It may use a read-only DB/view/API, but it must never expose business writes. */
export interface AtriumAgentReadMaterializer {
  materializeTurn(ref: AtriumAgentTurnRef): AtriumAgentReadMaterialization | Promise<AtriumAgentReadMaterialization>;
}

export interface AtriumAgentTurnExecutor {
  runTurnDetailed(agent: AgentProfile, turn: TurnContext): Promise<AgentRunTurnResult>;
}

export interface ActorProcessedWaterlineCache {
  getProcessedUntil(conversationId: ConversationId, agentId: AgentId): MessageId | undefined;
  rememberProcessedUntil(conversationId: ConversationId, agentId: AgentId, handledUntilMessageId: MessageId): void;
}

export class InMemoryActorProcessedWaterlineCache implements ActorProcessedWaterlineCache {
  readonly #waterlines = new Map<string, MessageId>();

  getProcessedUntil(conversationId: ConversationId, agentId: AgentId): MessageId | undefined {
    return this.#waterlines.get(actorKey(conversationId, agentId));
  }

  rememberProcessedUntil(conversationId: ConversationId, agentId: AgentId, handledUntilMessageId: MessageId): void {
    const key = actorKey(conversationId, agentId);
    const previous = this.#waterlines.get(key);
    if (!previous || compareIds(handledUntilMessageId, previous) > 0) {
      this.#waterlines.set(key, handledUntilMessageId);
    }
  }
}

export interface RunReadOnlyAgentTurnOptions {
  readonly waterlineCache?: ActorProcessedWaterlineCache;
}

export async function runReadOnlyAgentTurn(
  executor: AtriumAgentTurnExecutor,
  materializer: AtriumAgentReadMaterializer,
  ref: AtriumAgentTurnRef,
  options: RunReadOnlyAgentTurnOptions = {},
): Promise<AgentRunTurnResult> {
  const material = await materializer.materializeTurn(ref);
  if (!sameImmutableTask(material.turn.task, ref) || material.agent.id !== ref.agentId) {
    throw new Error("read materializer returned material for a different immutable task");
  }
  const turn = {
    ...material.turn,
    task: applyLocalWaterline(material.turn.task, options.waterlineCache),
  };
  const result = await executor.runTurnDetailed(material.agent, turn);
  if (options.waterlineCache && shouldAdvanceLocalWaterline(result)) {
    options.waterlineCache.rememberProcessedUntil(ref.conversationId, ref.agentId, result.materialization.handledUntilMessageId);
  }
  return result;
}

function sameImmutableTask(actual: AgentTaskSnapshot, expected: AgentWakeupRef): boolean {
  return actual.taskId === expected.taskId
    && actual.attemptNo === expected.attemptNo
    && actual.roomId === expected.roomId
    && actual.conversationId === expected.conversationId
    && actual.agentId === expected.agentId;
}

function applyLocalWaterline(task: AgentTaskSnapshot, cache: ActorProcessedWaterlineCache | undefined): AgentTaskSnapshot {
  const cached = cache?.getProcessedUntil(task.conversationId, task.agentId);
  if (!cached || compareIds(cached, task.processedUntilBefore) <= 0) {
    return task;
  }
  if (compareIds(cached, task.handledUntilMessageId) > 0) {
    throw new Error("read materialization is behind local actor processed waterline");
  }
  return { ...task, processedUntilBefore: cached };
}

function shouldAdvanceLocalWaterline(result: AgentRunTurnResult): boolean {
  if (result.freshness.stale) {
    return false;
  }
  return result.response.decision === AgentDecision.Reply
    || result.response.decision === AgentDecision.Proposal
    || result.response.decision === AgentDecision.NoReply;
}

function actorKey(conversationId: ConversationId, agentId: AgentId): string {
  return `${conversationId}:${agentId}`;
}
