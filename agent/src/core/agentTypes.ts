export type EntityId = string;
export type AgentId = EntityId;
export type ConversationId = EntityId;
export type MessageId = EntityId;
export type RoomId = EntityId;
export type UserId = EntityId;

export const ZERO_ID = "0";

export const ParticipantKind = {
  User: "user",
  Agent: "agent",
  System: "system",
} as const;

export type ParticipantKind = (typeof ParticipantKind)[keyof typeof ParticipantKind];

export const TurnSource = {
  UserMessage: "user_message",
  AgentMessage: "agent_message",
  SystemEvent: "system_event",
} as const;

export type TurnSource = (typeof TurnSource)[keyof typeof TurnSource];

export const AgentDecision = {
  NoReply: "no_reply",
  Reply: "reply",
  UseTool: "use_tool",
  NeedsContext: "needs_context",
  Failed: "failed",
} as const;

export type AgentDecision = (typeof AgentDecision)[keyof typeof AgentDecision];

export const ThinkingAdapter = {
  Default: "default",
  Aggressive: "aggressive",
  Conservative: "conservative",
  Comprehensive: "comprehensive",
  Counterexample: "counterexample",
  Divergent: "divergent",
  Convergent: "convergent",
  Custom: "custom",
} as const;

export type ThinkingAdapter = (typeof ThinkingAdapter)[keyof typeof ThinkingAdapter];

export interface ParticipantRef {
  id: EntityId;
  kind: ParticipantKind;
  displayName: string;
}

export interface MessageRef {
  id: MessageId;
  sender: ParticipantRef;
  content: string;
}

export interface AgentProfile {
  id: AgentId;
  provider: string;
  model: string;
  displayName: string;
  thinkingAdapter?: ThinkingAdapter;
  customThinkingInstruction?: string;
}

export interface TurnContext {
  roomId: RoomId;
  conversationId: ConversationId;
  userId: UserId;
  ownerUserId: UserId;
  triggerMessageId: MessageId;
  contextUntilMessageId: MessageId;
  phaseAtDispatch?: string;
  contextUpdatedAtMsAtDispatch?: number;
  source: TurnSource;
  messages: MessageRef[];
}

export interface AgentResponse {
  decision: AgentDecision;
  content: string;
  error: string;
}

export function noReply(): AgentResponse {
  return { decision: AgentDecision.NoReply, content: "", error: "" };
}

export function reply(content: string): AgentResponse {
  return { decision: AgentDecision.Reply, content, error: "" };
}

export function failed(error: string): AgentResponse {
  return { decision: AgentDecision.Failed, content: "", error };
}

export function normalizeId(value: unknown): EntityId {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`unsafe numeric id: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("empty id");
    }
    return trimmed;
  }
  throw new Error(`unsupported id type: ${typeof value}`);
}

export function isZeroId(id: EntityId): boolean {
  return id === ZERO_ID || id === "";
}
