import type { AgentProfile, AgentResponse, ConversationId, MessageId, RoomId, TurnContext, UserId } from "../core/agentTypes.ts";

export interface AtriumTurnRef {
  roomId: RoomId;
  conversationId: ConversationId;
  triggerMessageId: MessageId;
  contextUntilMessageId: MessageId;
  userId: UserId;
}

export interface AtriumAgentBridge {
  loadTurnContext(ref: AtriumTurnRef): TurnContext | Promise<TurnContext>;
  commitResponse(ref: AtriumTurnRef, agent: AgentProfile, response: AgentResponse): void | Promise<void>;
}

