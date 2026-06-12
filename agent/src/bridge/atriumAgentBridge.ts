import type { AgentId, AgentProfile, AgentResponse, ConversationId, MessageId, RoomId, TurnContext, UserId } from "../core/agentTypes.ts";
import type { AgentRunTurnResult } from "../runtime/agentRuntime.ts";

export interface AtriumTurnRef {
  roomId: RoomId;
  conversationId: ConversationId;
  triggerMessageId: MessageId;
  contextUntilMessageId: MessageId;
  userId?: UserId;
  ownerUserId?: UserId;
  phaseAtDispatch?: string;
  contextUpdatedAtMsAtDispatch?: number;
}

export interface AtriumAgentTurnRef extends AtriumTurnRef {
  agentId: AgentId;
  requestId?: string;
}

export interface AtriumAgentTurnMaterial {
  agent: AgentProfile;
  turn: TurnContext;
}

export interface AtriumAgentReadBridge {
  loadTurnMaterial(ref: AtriumAgentTurnRef): AtriumAgentTurnMaterial | Promise<AtriumAgentTurnMaterial>;
}

export interface AtriumAgentTurnExecutor {
  runTurnDetailed(agent: AgentProfile, turn: TurnContext): Promise<AgentRunTurnResult>;
}

export async function runReadOnlyAgentTurn(
  executor: AtriumAgentTurnExecutor,
  bridge: AtriumAgentReadBridge,
  ref: AtriumAgentTurnRef,
): Promise<AgentRunTurnResult> {
  const material = await bridge.loadTurnMaterial(ref);
  return executor.runTurnDetailed(material.agent, material.turn);
}

export interface AtriumAgentBridge {
  loadTurnContext(ref: AtriumTurnRef): TurnContext | Promise<TurnContext>;
  commitResponse(ref: AtriumTurnRef, agent: AgentProfile, response: AgentResponse): void | Promise<void>;
}
