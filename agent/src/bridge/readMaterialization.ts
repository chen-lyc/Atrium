import type {
  AgentProfile,
  ConversationPhase,
  MessageLifecycle,
  MessageKind as MessageKindType,
  MessageRef,
  ParticipantKind as ParticipantKindType,
  ProposalKind,
  ProposalStatus,
  ThinkingAdapter,
  TurnContext,
  TurnSource as TurnSourceType,
} from "../core/agentTypes.ts";
import {
  ConversationPhase as ConversationPhaseValue,
  MessageKind,
  ParticipantKind,
  ProposalKind as ProposalKindValue,
  ProposalStatus as ProposalStatusValue,
  ThinkingAdapter as ThinkingAdapterValue,
  TurnSource,
  normalizeId,
  validateMessageRef,
} from "../core/agentTypes.ts";
import type { AtriumAgentTurnRef } from "./atriumAgentBridge.ts";
import {
  BACKEND_AGENT_PROTOCOL_VERSION,
  type BackendAgentDispatchRefPayload,
  normalizeBackendAgentTurnRef,
} from "./backendTransition.ts";

const FORBIDDEN_MATERIALIZATION_FIELDS = [
  "trigger_message_id",
  "triggerMessageId",
  "context_until_message_id",
  "contextUntilMessageId",
  "visible_until",
  "visibleUntil",
  "visible_id",
  "visibleId",
  "focus_message_ids",
  "focusMessageIds",
  "focus_id",
  "focusId",
  "phase_at_dispatch",
  "phaseAtDispatch",
  "context_updated_at_ms_at_dispatch",
  "contextUpdatedAtMsAtDispatch",
] as const;

const FORBIDDEN_SENDER_FIELDS = [
  "role",
  "member_role",
  "memberRole",
  "user_role",
  "userRole",
  "owner_id",
  "ownerId",
  "admin_id",
  "adminId",
  "permissions",
  "permission",
  "is_owner",
  "isOwner",
  "is_admin",
  "isAdmin",
] as const;

export interface AgentReadProfilePayload {
  id: unknown;
  provider: string;
  model: string;
  display_name?: unknown;
  thinking_adapter?: unknown;
  custom_thinking_instruction?: string;
}

export interface AgentReadMessagePayload {
  id: unknown;
  sender: { id: unknown; kind: unknown; display_name?: unknown; display_label?: unknown };
  content: string;
  kind?: unknown;
  lifecycle?: {
    deleted_at_ms?: unknown;
    withdrawn_at_ms?: unknown;
    excluded_from_prompt_at_ms?: unknown;
    exclusion_reason?: unknown;
  };
  proposal?: {
    proposal_id: unknown;
    status: unknown;
    kind: unknown;
    base_phase: unknown;
    base_context_updated_at_ms: unknown;
    source_anchors: unknown;
  };
}

export interface AgentReadTurnMaterializationPayload {
  source: unknown;
  materialization: {
    processed_until_before: unknown;
    handled_until_message_id: unknown;
    retrieved_anchor_message_ids?: unknown;
    phase_at_materialization: unknown;
    context_version_at_materialization: unknown;
    context_updated_at_ms_at_materialization: unknown;
  };
  messages: AgentReadMessagePayload[];
}

export interface AgentReadMaterializationPayload {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  ref: BackendAgentDispatchRefPayload;
  agent: AgentReadProfilePayload;
  turn: AgentReadTurnMaterializationPayload;
}

export interface NormalizedAgentReadMaterialization {
  readonly protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  readonly ref: AtriumAgentTurnRef;
  readonly agent: AgentProfile;
  readonly turn: TurnContext;
}

export function normalizeAgentReadMaterialization(
  payload: AgentReadMaterializationPayload,
): NormalizedAgentReadMaterialization {
  assertProtocol(payload.protocol);
  const ref = normalizeBackendAgentTurnRef(payload.ref);
  const task = normalizeAgentReadTurnMaterialization(payload.turn.materialization, ref);
  return {
    protocol: payload.protocol,
    ref,
    agent: normalizeAgentReadProfile(payload.agent),
    turn: {
      task,
      source: normalizeTurnSource(payload.turn.source),
      messages: payload.turn.messages.map(normalizeAgentReadMessage),
    },
  };
}

export function normalizeAgentReadTurnMaterialization(
  payload: AgentReadTurnMaterializationPayload["materialization"],
  ref: AtriumAgentTurnRef,
): NormalizedAgentReadMaterialization["turn"]["task"] {
  rejectForbiddenKeys(payload, FORBIDDEN_MATERIALIZATION_FIELDS, "agent read materialization");
  const anchors = normalizeIdArray(payload.retrieved_anchor_message_ids ?? [], "retrieved_anchor_message_ids");
  if (new Set(anchors).size !== anchors.length) {
    throw new Error("retrieved_anchor_message_ids must be unique");
  }
  return {
    ...ref,
    processedUntilBefore: normalizeId(payload.processed_until_before),
    handledUntilMessageId: normalizeId(payload.handled_until_message_id),
    retrievedAnchorMessageIds: anchors,
    phaseAtMaterialization: normalizeConversationPhase(payload.phase_at_materialization),
    contextVersionAtMaterialization: normalizeRequiredString(
      payload.context_version_at_materialization,
      "context_version_at_materialization",
    ),
    contextUpdatedAtMsAtMaterialization: normalizeRequiredSafeNumber(
      payload.context_updated_at_ms_at_materialization,
      "context_updated_at_ms_at_materialization",
    ),
  };
}

export function normalizeAgentReadProfile(payload: AgentReadProfilePayload): AgentProfile {
  const displayName = normalizeOptionalString(payload.display_name);
  const thinkingAdapter = normalizeThinkingAdapter(payload.thinking_adapter);
  return {
    id: normalizeId(payload.id),
    provider: payload.provider,
    model: payload.model,
    ...(displayName ? { displayName } : {}),
    ...(thinkingAdapter ? { thinkingAdapter } : {}),
    ...(payload.custom_thinking_instruction ? { customThinkingInstruction: payload.custom_thinking_instruction } : {}),
  };
}

export function normalizeAgentReadMessage(payload: AgentReadMessagePayload): MessageRef {
  const lifecycle = normalizeLifecycle(payload.lifecycle);
  const proposal = payload.proposal
    ? {
        proposalId: normalizeId(payload.proposal.proposal_id),
        status: normalizeProposalStatus(payload.proposal.status),
        kind: normalizeProposalKind(payload.proposal.kind),
        basePhase: normalizeConversationPhase(payload.proposal.base_phase),
        baseContextUpdatedAtMs: normalizeRequiredSafeNumber(
          payload.proposal.base_context_updated_at_ms,
          "base_context_updated_at_ms",
        ),
        sourceAnchors: normalizeSourceAnchors(payload.proposal.source_anchors),
      }
    : undefined;
  const kind = normalizeMessageKind(payload.kind, proposal !== undefined);
  const participantKind = normalizeParticipantKind(payload.sender.kind);
  rejectForbiddenKeys(payload.sender, FORBIDDEN_SENDER_FIELDS, "message sender");
  if (kind === MessageKind.Proposal && !proposal) {
    throw new Error("proposal message missing proposal metadata");
  }
  const displayName = normalizeOptionalString(payload.sender.display_label)
    ?? normalizeRequiredString(payload.sender.display_name, "sender.display_label or sender.display_name");
  const message: MessageRef = {
    id: normalizeId(payload.id),
    sender: {
      id: normalizeId(payload.sender.id),
      kind: participantKind,
      displayName,
    },
    content: payload.content,
    kind,
    ...(lifecycle ? { lifecycle } : {}),
    ...(proposal ? { proposal } : {}),
  };
  const errors = validateMessageRef(message);
  if (errors.length > 0) {
    throw new Error(`invalid materialized message: ${errors.join("; ")}`);
  }
  return message;
}

function rejectForbiddenKeys(payload: object, forbiddenFields: readonly string[], scope: string): void {
  for (const field of forbiddenFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new Error(`${scope} must not include ${field}`);
    }
  }
}

function assertProtocol(protocol: string): void {
  if (protocol !== BACKEND_AGENT_PROTOCOL_VERSION) {
    throw new Error(`unsupported agent read materialization protocol: ${protocol}`);
  }
}

function normalizeConversationPhase(value: unknown): ConversationPhase {
  if (value === ConversationPhaseValue.Divergence || value === ConversationPhaseValue.ConvergenceExecution || value === ConversationPhaseValue.Blocked) {
    return value;
  }
  throw new Error(`unsupported conversation phase: ${String(value)}`);
}

function normalizeParticipantKind(value: unknown): ParticipantKindType {
  if (Object.values(ParticipantKind).includes(value as ParticipantKindType)) {
    return value as ParticipantKindType;
  }
  throw new Error(`unsupported participant kind: ${String(value)}`);
}

function normalizeTurnSource(value: unknown): TurnSourceType {
  if (Object.values(TurnSource).includes(value as TurnSourceType)) {
    return value as TurnSourceType;
  }
  throw new Error(`unsupported turn source: ${String(value)}`);
}

function normalizeProposalStatus(value: unknown): ProposalStatus {
  if (Object.values(ProposalStatusValue).includes(value as ProposalStatus)) {
    return value as ProposalStatus;
  }
  throw new Error(`unsupported proposal status: ${String(value)}`);
}

function normalizeProposalKind(value: unknown): ProposalKind {
  if (Object.values(ProposalKindValue).includes(value as ProposalKind)) {
    return value as ProposalKind;
  }
  throw new Error(`unsupported proposal kind: ${String(value)}`);
}

function normalizeMessageKind(value: unknown, hasProposal: boolean): MessageKindType {
  if (value === undefined || value === null || value === "") {
    return hasProposal ? MessageKind.Proposal : MessageKind.Speech;
  }
  if (Object.values(MessageKind).includes(value as MessageKindType)) {
    return value as MessageKindType;
  }
  throw new Error(`unsupported message kind: ${String(value)}`);
}

function normalizeLifecycle(payload: AgentReadMessagePayload["lifecycle"]): MessageLifecycle | undefined {
  if (!payload) {
    return undefined;
  }
  const deletedAtMs = normalizeOptionalSafeNumber(payload.deleted_at_ms);
  const withdrawnAtMs = normalizeOptionalSafeNumber(payload.withdrawn_at_ms);
  const excludedFromPromptAtMs = normalizeOptionalSafeNumber(payload.excluded_from_prompt_at_ms);
  const exclusionReason = normalizeOptionalString(payload.exclusion_reason);
  if (deletedAtMs === undefined && withdrawnAtMs === undefined && excludedFromPromptAtMs === undefined && !exclusionReason) {
    return undefined;
  }
  return {
    ...(deletedAtMs !== undefined ? { deletedAtMs } : {}),
    ...(withdrawnAtMs !== undefined ? { withdrawnAtMs } : {}),
    ...(excludedFromPromptAtMs !== undefined ? { excludedFromPromptAtMs } : {}),
    ...(exclusionReason ? { exclusionReason } : {}),
  };
}

function normalizeThinkingAdapter(value: unknown): ThinkingAdapter | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (Object.values(ThinkingAdapterValue).includes(value as ThinkingAdapter)) {
    return value as ThinkingAdapter;
  }
  throw new Error(`unsupported thinking adapter: ${String(value)}`);
}

function normalizeIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map(normalizeId);
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeOptionalSafeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number === "number" && Number.isSafeInteger(number) && number >= 0) {
    return number;
  }
  if (typeof number === "bigint" && number >= 0n && number <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(number);
  }
  throw new Error(`unsupported safe number: ${String(value)}`);
}

function normalizeRequiredSafeNumber(value: unknown, field: string): number {
  const normalized = normalizeOptionalSafeNumber(value);
  if (normalized === undefined) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeSourceAnchors(value: unknown): Array<{ messageId: string; status: "active" | "stale" | "purged"; note?: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("source_anchors must be a non-empty array");
  }
  return value.map((anchor) => {
    if (!anchor || typeof anchor !== "object") {
      throw new Error("source anchor must be an object");
    }
    const item = anchor as { message_id?: unknown; status?: unknown; note?: unknown };
    if (item.status !== "active" && item.status !== "stale" && item.status !== "purged") {
      throw new Error(`unsupported source anchor status: ${String(item.status)}`);
    }
    const note = normalizeOptionalString(item.note);
    return {
      messageId: normalizeId(item.message_id),
      status: item.status,
      ...(note ? { note } : {}),
    };
  });
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
