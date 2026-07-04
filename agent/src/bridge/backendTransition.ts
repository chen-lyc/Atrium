import type {
  ConversationPhase,
  ProposalKind,
  ProposalDraft,
} from "../core/agentTypes.ts";
import {
  normalizeId,
  isZeroId,
} from "../core/agentTypes.ts";
import type { AtriumAgentTurnRef } from "./atriumAgentBridge.ts";
import type { AgentRunTurnResult } from "../runtime/agentRuntime.ts";

export const BACKEND_AGENT_PROTOCOL_VERSION = "atrium.agent.turn.v1";

const FORBIDDEN_DISPATCH_REF_FIELDS = [
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
  "user_id",
  "userId",
  "owner_user_id",
  "ownerUserId",
  "owner_id",
  "ownerId",
  "admin_id",
  "adminId",
  "phase_at_dispatch",
  "phaseAtDispatch",
  "context_version_at_dispatch",
  "contextVersionAtDispatch",
  "context_updated_at_ms_at_dispatch",
  "contextUpdatedAtMsAtDispatch",
] as const;

export interface BackendAgentDispatchRefPayload {
  task_id: unknown;
  attempt_no: unknown;
  room_id: unknown;
  conversation_id: unknown;
  ai_id: unknown;
}

export interface BackendAgentDispatchRequestPayload {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  ref: BackendAgentDispatchRefPayload;
}

export interface BackendAgentRunResultPayload {
  protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  task_id: string;
  attempt_no: number;
  response: BackendAgentResponsePayload;
  freshness: AgentRunTurnResult["freshness"];
  materialization: {
    processed_until_before: string;
    handled_until_message_id: string;
    input_message_ids: readonly string[];
    trigger_message_ids: readonly string[];
    retrieved_anchor_message_ids: readonly string[];
    input_stance_record_ids: readonly string[];
    phase_at_generation: ConversationPhase;
    context_version_at_generation: string;
    context_updated_at_ms_at_generation: number;
    prompt_template_version: string;
  };
  stance_commit?: {
    response_kind: "reply" | "proposal";
    phase_at_generation: ConversationPhase;
    processed_until_before: string;
    handled_until_message_id: string;
    input_message_ids: readonly string[];
    retrieved_anchor_message_ids: readonly string[];
    input_stance_record_ids: readonly string[];
    content: string;
    proposal?: BackendProposalDraftPayload;
  };
}

export type BackendAgentResponsePayload =
  | { decision: "reply"; content: string; error: "" }
  | { decision: "proposal"; content: string; error: ""; proposal: BackendProposalDraftPayload }
  | { decision: "no_reply"; content: ""; error: ""; reason: string }
  | { decision: "failed" | "cancelled" | "superseded"; content: ""; error: string };

export interface BackendProposalDraftPayload {
  kind: ProposalKind;
  reason: string;
  source_message_ids: readonly string[];
  synthesis?: {
    recommendation: string;
    rationale: string;
    strongest_counterargument: string;
    valuable_minority_views: readonly string[];
    residual_uncertainties: readonly string[];
    falsifiable_premises: readonly string[];
  };
}

export interface NormalizedBackendAgentDispatchRequest {
  readonly protocol: typeof BACKEND_AGENT_PROTOCOL_VERSION;
  readonly ref: AtriumAgentTurnRef;
}

export function normalizeBackendDispatchRequest(
  payload: BackendAgentDispatchRequestPayload,
): NormalizedBackendAgentDispatchRequest {
  assertProtocol(payload.protocol);
  return { protocol: payload.protocol, ref: normalizeBackendAgentTurnRef(payload.ref) };
}

export function buildBackendRunResultPayload(result: AgentRunTurnResult): BackendAgentRunResultPayload {
  const materialization = result.materialization;
  return {
    protocol: BACKEND_AGENT_PROTOCOL_VERSION,
    task_id: materialization.taskId,
    attempt_no: materialization.attemptNo,
    response: buildBackendAgentResponse(result.response),
    freshness: result.freshness,
    materialization: {
      processed_until_before: materialization.processedUntilBefore,
      handled_until_message_id: materialization.handledUntilMessageId,
      input_message_ids: [...materialization.inputMessageIds],
      trigger_message_ids: [...materialization.triggerMessageIds],
      retrieved_anchor_message_ids: [...materialization.retrievedAnchorMessageIds],
      input_stance_record_ids: [...materialization.inputStanceRecordIds],
      phase_at_generation: materialization.phaseAtGeneration,
      context_version_at_generation: materialization.contextVersionAtGeneration,
      context_updated_at_ms_at_generation: materialization.contextUpdatedAtMsAtGeneration,
      prompt_template_version: materialization.promptTemplateVersion,
    },
    ...(result.stanceCommit
      ? {
          stance_commit: {
            response_kind: result.stanceCommit.responseKind,
            phase_at_generation: result.stanceCommit.phaseAtGeneration,
            processed_until_before: result.stanceCommit.processedUntilBefore,
            handled_until_message_id: result.stanceCommit.handledUntilMessageId,
            input_message_ids: [...result.stanceCommit.inputMessageIds],
            retrieved_anchor_message_ids: [...result.stanceCommit.retrievedAnchorMessageIds],
            input_stance_record_ids: [...result.stanceCommit.inputStanceRecordIds],
            content: result.stanceCommit.content,
            ...(result.stanceCommit.proposal ? { proposal: buildBackendProposalDraft(result.stanceCommit.proposal) } : {}),
          },
        }
      : {}),
  };
}

function buildBackendAgentResponse(response: AgentRunTurnResult["response"]): BackendAgentResponsePayload {
  if (response.decision === "proposal") {
    return { ...response, proposal: buildBackendProposalDraft(response.proposal) };
  }
  return response;
}

function buildBackendProposalDraft(proposal: ProposalDraft): BackendProposalDraftPayload {
  return {
    kind: proposal.kind,
    reason: proposal.reason,
    source_message_ids: [...proposal.sourceMessageIds],
    ...(proposal.synthesis
      ? {
          synthesis: {
            recommendation: proposal.synthesis.recommendation,
            rationale: proposal.synthesis.rationale,
            strongest_counterargument: proposal.synthesis.strongestCounterargument,
            valuable_minority_views: [...proposal.synthesis.valuableMinorityViews],
            residual_uncertainties: [...proposal.synthesis.residualUncertainties],
            falsifiable_premises: [...proposal.synthesis.falsifiablePremises],
          },
        }
      : {}),
  };
}

export function normalizeBackendAgentTurnRef(payload: BackendAgentDispatchRefPayload): AtriumAgentTurnRef {
  rejectForbiddenKeys(payload, FORBIDDEN_DISPATCH_REF_FIELDS, "backend->agent wakeup ref");
  const ref: AtriumAgentTurnRef = {
    taskId: normalizeId(payload.task_id),
    attemptNo: normalizePositiveInteger(payload.attempt_no, "attempt_no"),
    roomId: normalizeId(payload.room_id),
    conversationId: normalizeId(payload.conversation_id),
    agentId: normalizeId(payload.ai_id),
  };
  if (isZeroId(ref.taskId) || isZeroId(ref.roomId) || isZeroId(ref.conversationId) || isZeroId(ref.agentId)) {
    throw new Error("task_id, room_id, conversation_id, and ai_id must be non-zero");
  }
  return ref;
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
    throw new Error(`unsupported backend agent protocol: ${protocol}`);
  }
}

function normalizePositiveInteger(value: unknown, field: string): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return number;
}
