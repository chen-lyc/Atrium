import type {
  AgentProfile,
  AgentResponse,
  MessageRef,
  ParticipantKind as ParticipantKindType,
  ThinkingAdapter,
  TurnContext,
  TurnSource as TurnSourceType,
} from "../core/agentTypes.ts";
import { ParticipantKind, ThinkingAdapter as ThinkingAdapterValue, TurnSource, normalizeId } from "../core/agentTypes.ts";
import type { AtriumTurnRef } from "./atriumAgentBridge.ts";

export const BACKEND_AGENT_PROTOCOL_VERSION = "atrium.agent.turn.v1";

export interface BackendAgentTurnRefPayload {
  room_id: unknown;
  conversation_id: unknown;
  trigger_message_id: unknown;
  context_until_message_id: unknown;
  user_id: unknown;
}

export interface BackendAgentProfilePayload {
  id: unknown;
  provider: string;
  model: string;
  display_name: string;
  thinking_adapter?: unknown;
  custom_thinking_instruction?: string;
}

export interface BackendTurnContextPayload extends BackendAgentTurnRefPayload {
  source: unknown;
  messages: BackendMessagePayload[];
}

export interface BackendAgentRunRequestPayload {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  ref: BackendAgentTurnRefPayload;
  agent: BackendAgentProfilePayload;
  turn: BackendTurnContextPayload;
}

export interface BackendAgentRunResultPayload {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  ref: AtriumTurnRef;
  agent: AgentProfile;
  response: AgentResponse;
}

export interface BackendMessagePayload {
  id: unknown;
  sender: {
    id: unknown;
    kind: unknown;
    display_name: string;
  };
  content: string;
}

export interface NormalizedBackendAgentRunRequest {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  ref: AtriumTurnRef;
  agent: AgentProfile;
  turn: TurnContext;
}

export function normalizeBackendRunRequest(payload: BackendAgentRunRequestPayload): NormalizedBackendAgentRunRequest {
  if (payload.protocol !== BACKEND_AGENT_PROTOCOL_VERSION) {
    throw new Error(`unsupported backend agent protocol: ${payload.protocol}`);
  }

  return {
    protocol: payload.protocol,
    ref: normalizeBackendTurnRef(payload.ref),
    agent: normalizeBackendAgentProfile(payload.agent),
    turn: normalizeBackendTurnContext(payload.turn),
  };
}

export function normalizeBackendTurnRef(payload: BackendAgentTurnRefPayload): AtriumTurnRef {
  return {
    roomId: normalizeId(payload.room_id),
    conversationId: normalizeId(payload.conversation_id),
    triggerMessageId: normalizeId(payload.trigger_message_id),
    contextUntilMessageId: normalizeId(payload.context_until_message_id),
    userId: normalizeId(payload.user_id),
  };
}

export function normalizeBackendAgentProfile(payload: BackendAgentProfilePayload): AgentProfile {
  const thinkingAdapter = normalizeThinkingAdapter(payload.thinking_adapter);
  return {
    id: normalizeId(payload.id),
    provider: payload.provider,
    model: payload.model,
    displayName: payload.display_name,
    ...(thinkingAdapter ? { thinkingAdapter } : {}),
    ...(payload.custom_thinking_instruction ? { customThinkingInstruction: payload.custom_thinking_instruction } : {}),
  };
}

export function normalizeBackendTurnContext(payload: BackendTurnContextPayload): TurnContext {
  return {
    roomId: normalizeId(payload.room_id),
    conversationId: normalizeId(payload.conversation_id),
    userId: normalizeId(payload.user_id),
    triggerMessageId: normalizeId(payload.trigger_message_id),
    contextUntilMessageId: normalizeId(payload.context_until_message_id),
    source: normalizeTurnSource(payload.source),
    messages: payload.messages.map(normalizeBackendMessage),
  };
}

export function normalizeBackendMessage(payload: BackendMessagePayload): MessageRef {
  return {
    id: normalizeId(payload.id),
    sender: {
      id: normalizeId(payload.sender.id),
      kind: normalizeParticipantKind(payload.sender.kind),
      displayName: payload.sender.display_name,
    },
    content: payload.content,
  };
}

function normalizeParticipantKind(value: unknown): ParticipantKindType {
  if (value === ParticipantKind.User || value === ParticipantKind.Agent || value === ParticipantKind.System) {
    return value;
  }
  throw new Error(`unsupported participant kind: ${String(value)}`);
}

function normalizeTurnSource(value: unknown): TurnSourceType {
  if (value === TurnSource.UserMessage || value === TurnSource.AgentMessage || value === TurnSource.SystemEvent) {
    return value;
  }
  throw new Error(`unsupported turn source: ${String(value)}`);
}

function normalizeThinkingAdapter(value: unknown): ThinkingAdapter | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (
    value === ThinkingAdapterValue.Default ||
    value === ThinkingAdapterValue.Aggressive ||
    value === ThinkingAdapterValue.Conservative ||
    value === ThinkingAdapterValue.Comprehensive ||
    value === ThinkingAdapterValue.Counterexample ||
    value === ThinkingAdapterValue.Divergent ||
    value === ThinkingAdapterValue.Convergent ||
    value === ThinkingAdapterValue.Custom
  ) {
    return value;
  }
  throw new Error(`unsupported thinking adapter: ${String(value)}`);
}
