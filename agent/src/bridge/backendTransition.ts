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
import type { AtriumAgentTurnRef, AtriumTurnRef } from "./atriumAgentBridge.ts";
import type { AgentRunTurnResult } from "../runtime/agentRuntime.ts";

export const BACKEND_AGENT_PROTOCOL_VERSION = "atrium.agent.turn.v1";

export interface BackendAgentTurnRefPayload {
  room_id: unknown;
  conversation_id: unknown;
  trigger_message_id: unknown;
  context_until_message_id: unknown;
  user_id?: unknown;
  owner_user_id?: unknown;
  phase_at_dispatch?: unknown;
  context_updated_at_ms_at_dispatch?: unknown;
}

export interface BackendAgentDispatchRefPayload {
  request_id?: unknown;
  room_id: unknown;
  conversation_id: unknown;
  ai_id: unknown;
  trigger_message_id: unknown;
  context_until_message_id: unknown;
  phase_at_dispatch?: unknown;
  context_updated_at_ms_at_dispatch?: unknown;
}

export interface BackendAgentProfilePayload {
  id: unknown;
  provider: string;
  model: string;
  display_name?: unknown;
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

export interface BackendAgentDispatchRequestPayload {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  ref: BackendAgentDispatchRefPayload;
}

export interface BackendAgentRunResultPayload {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  ref: AtriumAgentTurnRef;
  response: AgentResponse;
  phase_at_generation?: string;
  context_until_message_id: string;
  input_stance_record_ids: string[];
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

export interface NormalizedBackendAgentDispatchRequest {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  ref: AtriumAgentTurnRef;
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

export function buildBackendRunResultPayload(
  ref: AtriumAgentTurnRef,
  result: AgentRunTurnResult,
): BackendAgentRunResultPayload {
  return {
    protocol: BACKEND_AGENT_PROTOCOL_VERSION,
    ref,
    response: result.response,
    ...(result.phaseAtGeneration ? { phase_at_generation: result.phaseAtGeneration } : {}),
    context_until_message_id: result.contextUntilMessageId,
    input_stance_record_ids: [...result.inputStanceRecordIds],
  };
}

export function normalizeBackendDispatchRequest(
  payload: BackendAgentDispatchRequestPayload,
): NormalizedBackendAgentDispatchRequest {
  if (payload.protocol !== BACKEND_AGENT_PROTOCOL_VERSION) {
    throw new Error(`unsupported backend agent protocol: ${payload.protocol}`);
  }

  return {
    protocol: payload.protocol,
    ref: normalizeBackendAgentTurnRef(payload.ref),
  };
}

export function normalizeBackendTurnRef(payload: BackendAgentTurnRefPayload): AtriumTurnRef {
  return {
    roomId: normalizeId(payload.room_id),
    conversationId: normalizeId(payload.conversation_id),
    triggerMessageId: normalizeId(payload.trigger_message_id),
    contextUntilMessageId: normalizeId(payload.context_until_message_id),
    ...(payload.user_id !== undefined ? { userId: normalizeId(payload.user_id) } : {}),
    ...(payload.owner_user_id !== undefined ? { ownerUserId: normalizeId(payload.owner_user_id) } : {}),
    ...(payload.phase_at_dispatch ? { phaseAtDispatch: String(payload.phase_at_dispatch) } : {}),
    ...(payload.context_updated_at_ms_at_dispatch !== undefined
      ? { contextUpdatedAtMsAtDispatch: normalizeOptionalSafeNumber(payload.context_updated_at_ms_at_dispatch) }
      : {}),
  };
}

export function normalizeBackendAgentTurnRef(payload: BackendAgentDispatchRefPayload): AtriumAgentTurnRef {
  const requestId = normalizeOptionalString(payload.request_id);
  return {
    roomId: normalizeId(payload.room_id),
    conversationId: normalizeId(payload.conversation_id),
    agentId: normalizeId(payload.ai_id),
    triggerMessageId: normalizeId(payload.trigger_message_id),
    contextUntilMessageId: normalizeId(payload.context_until_message_id),
    ...(requestId ? { requestId } : {}),
    ...(payload.phase_at_dispatch ? { phaseAtDispatch: String(payload.phase_at_dispatch) } : {}),
    ...(payload.context_updated_at_ms_at_dispatch !== undefined
      ? { contextUpdatedAtMsAtDispatch: normalizeOptionalSafeNumber(payload.context_updated_at_ms_at_dispatch) }
      : {}),
  };
}

export function normalizeBackendAgentProfile(payload: BackendAgentProfilePayload): AgentProfile {
  const thinkingAdapter = normalizeThinkingAdapter(payload.thinking_adapter);
  const displayName = normalizeOptionalString(payload.display_name);
  return {
    id: normalizeId(payload.id),
    provider: payload.provider,
    model: payload.model,
    ...(displayName ? { displayName } : {}),
    ...(thinkingAdapter ? { thinkingAdapter } : {}),
    ...(payload.custom_thinking_instruction ? { customThinkingInstruction: payload.custom_thinking_instruction } : {}),
  };
}

export function normalizeBackendTurnContext(payload: BackendTurnContextPayload): TurnContext {
  return {
    roomId: normalizeId(payload.room_id),
    conversationId: normalizeId(payload.conversation_id),
    userId: normalizeId(payload.user_id),
    ownerUserId: normalizeId(payload.owner_user_id),
    triggerMessageId: normalizeId(payload.trigger_message_id),
    contextUntilMessageId: normalizeId(payload.context_until_message_id),
    ...(payload.phase_at_dispatch ? { phaseAtDispatch: String(payload.phase_at_dispatch) } : {}),
    ...(payload.context_updated_at_ms_at_dispatch !== undefined
      ? { contextUpdatedAtMsAtDispatch: normalizeOptionalSafeNumber(payload.context_updated_at_ms_at_dispatch) }
      : {}),
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

function normalizeOptionalSafeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  throw new Error(`unsupported safe number: ${String(value)}`);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
