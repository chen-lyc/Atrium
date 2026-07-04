export type EntityId = string;
export type AgentId = EntityId;
export type ConversationId = EntityId;
export type MessageId = EntityId;
export type ProposalId = EntityId;
export type RoomId = EntityId;
export type TaskId = EntityId;
export type UserId = EntityId;

export const ZERO_ID = "0";

export const ConversationPhase = {
  Divergence: "divergence",
  ConvergenceExecution: "convergence_execution",
  Blocked: "blocked",
} as const;

export type ConversationPhase = (typeof ConversationPhase)[keyof typeof ConversationPhase];

export const ParticipantKind = {
  User: "user",
  Agent: "agent",
  System: "system",
} as const;

export type ParticipantKind = (typeof ParticipantKind)[keyof typeof ParticipantKind];

export const SourceAnchorStatus = {
  Active: "active",
  Stale: "stale",
  Purged: "purged",
} as const;

export type SourceAnchorStatus = (typeof SourceAnchorStatus)[keyof typeof SourceAnchorStatus];

export const TurnSource = {
  UserMessage: "user_message",
  AgentMessage: "agent_message",
  SystemEvent: "system_event",
  ManualInvite: "manual_invite",
} as const;

export type TurnSource = (typeof TurnSource)[keyof typeof TurnSource];

export const MessageKind = {
  Speech: "speech",
  Proposal: "proposal",
  ProposalStatus: "proposal_status",
  SystemEvent: "system_event",
} as const;

export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

export const ProposalStatus = {
  Pending: "pending",
  Accepted: "accepted",
  Rejected: "rejected",
  Closed: "closed",
  Expired: "expired",
  Converted: "converted",
} as const;

export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const ProposalKind = {
  Whiteboard: "whiteboard",
  PhaseChange: "phase_change",
  ToolOrResource: "tool_or_resource",
  ProcessState: "process_state",
  SynthesisDraft: "synthesis_draft",
} as const;

export type ProposalKind = (typeof ProposalKind)[keyof typeof ProposalKind];

export const AgentDecision = {
  NoReply: "no_reply",
  Reply: "reply",
  Proposal: "proposal",
  Failed: "failed",
  Cancelled: "cancelled",
  Superseded: "superseded",
} as const;

export type AgentDecision = (typeof AgentDecision)[keyof typeof AgentDecision];

export const NoReplyReason = {
  NoUsefulContribution: "no_useful_contribution",
  NeedsContext: "needs_context",
  Uncertain: "uncertain",
} as const;

export type NoReplyReason = (typeof NoReplyReason)[keyof typeof NoReplyReason];

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
  readonly id: EntityId;
  readonly kind: ParticipantKind;
  readonly displayName: string;
}

export interface MessageSourceAnchor {
  readonly messageId: MessageId;
  readonly status: SourceAnchorStatus;
  readonly note?: string;
}

export interface ProposalMessageMetadata {
  readonly proposalId: ProposalId;
  readonly status: ProposalStatus;
  readonly kind: ProposalKind;
  readonly basePhase: ConversationPhase;
  readonly baseContextUpdatedAtMs: number;
  readonly sourceAnchors: readonly MessageSourceAnchor[];
}

export interface MessageLifecycle {
  readonly deletedAtMs?: number;
  readonly withdrawnAtMs?: number;
  readonly excludedFromPromptAtMs?: number;
  readonly exclusionReason?: string;
}

export interface MessageRef {
  readonly id: MessageId;
  readonly sender: ParticipantRef;
  readonly content: string;
  readonly kind?: MessageKind;
  readonly proposal?: ProposalMessageMetadata;
  readonly lifecycle?: MessageLifecycle;
}

export interface AgentProfile {
  readonly id: AgentId;
  readonly provider: string;
  readonly model: string;
  readonly displayName?: string;
  readonly thinkingAdapter?: ThinkingAdapter;
  readonly customThinkingInstruction?: string;
}

export interface AgentWakeupRef {
  readonly taskId: TaskId;
  readonly attemptNo: number;
  readonly roomId: RoomId;
  readonly conversationId: ConversationId;
  readonly agentId: AgentId;
}

export interface AgentTaskSnapshot extends AgentWakeupRef {
  readonly processedUntilBefore: MessageId;
  readonly handledUntilMessageId: MessageId;
  readonly retrievedAnchorMessageIds: readonly MessageId[];
  readonly phaseAtMaterialization: ConversationPhase;
  readonly contextVersionAtMaterialization: string;
  readonly contextUpdatedAtMsAtMaterialization: number;
}

export interface TurnContext {
  readonly task: AgentTaskSnapshot;
  readonly source: TurnSource;
  readonly messages: readonly MessageRef[];
}

export interface ProposalDraft {
  readonly kind: ProposalKind;
  readonly reason: string;
  readonly sourceMessageIds: readonly MessageId[];
  readonly synthesis?: SynthesisDraftContent;
}

export interface SynthesisDraftContent {
  readonly recommendation: string;
  readonly rationale: string;
  readonly strongestCounterargument: string;
  readonly valuableMinorityViews: readonly string[];
  readonly residualUncertainties: readonly string[];
  readonly falsifiablePremises: readonly string[];
}

export type AgentResponse =
  | { readonly decision: "reply"; readonly content: string; readonly error: "" }
  | { readonly decision: "proposal"; readonly content: string; readonly error: ""; readonly proposal: ProposalDraft }
  | { readonly decision: "no_reply"; readonly content: ""; readonly error: ""; readonly reason: NoReplyReason }
  | { readonly decision: "failed"; readonly content: ""; readonly error: string }
  | { readonly decision: "cancelled"; readonly content: ""; readonly error: string }
  | { readonly decision: "superseded"; readonly content: ""; readonly error: string };

export function noReply(reason: NoReplyReason = NoReplyReason.NoUsefulContribution): AgentResponse {
  return { decision: AgentDecision.NoReply, content: "", error: "", reason };
}

export function reply(content: string): AgentResponse {
  return { decision: AgentDecision.Reply, content, error: "" };
}

export function propose(content: string, draft: ProposalDraft): AgentResponse {
  return { decision: AgentDecision.Proposal, content, error: "", proposal: draft };
}

export function failed(error: string): AgentResponse {
  return { decision: AgentDecision.Failed, content: "", error };
}

export function cancelled(error = "agent task cancelled"): AgentResponse {
  return { decision: AgentDecision.Cancelled, content: "", error };
}

export function superseded(error = "agent task superseded"): AgentResponse {
  return { decision: AgentDecision.Superseded, content: "", error };
}

export function agentDisplayLabel(agent: Pick<AgentProfile, "id" | "displayName">): string {
  const displayName = promptSafeLabel(agent.displayName ?? "");
  return displayName.length > 0 ? displayName : "AI member";
}

export function agentMemberLabel(agent: Pick<AgentProfile, "id" | "displayName">): string {
  const displayName = promptSafeLabel(agent.displayName ?? "");
  return displayName.length > 0 ? displayName : "AI member";
}

export function promptSafeLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function normalizeId(value: unknown): EntityId {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`negative id: ${value}`);
    }
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
    if (/\s|[\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new Error(`id contains whitespace or control characters: ${trimmed}`);
    }
    return trimmed;
  }
  throw new Error(`unsupported id type: ${typeof value}`);
}

export function compareIds(left: EntityId, right: EntityId): number {
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) {
    throw new Error(`ordered message ids must be unsigned decimal strings: ${left}, ${right}`);
  }
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function isZeroId(id: EntityId): boolean {
  return id === ZERO_ID || id === "";
}

export function messageCanEnterPrompt(message: MessageRef): boolean {
  return (
    message.lifecycle?.deletedAtMs === undefined &&
    message.lifecycle?.withdrawnAtMs === undefined &&
    message.lifecycle?.excludedFromPromptAtMs === undefined
  );
}

export function validateMessageRef(message: MessageRef): string[] {
  const errors: string[] = [];
  if (isZeroId(message.id) || isZeroId(message.sender.id)) {
    errors.push("message and sender ids must be non-zero");
  }
  if (!Object.values(ParticipantKind).includes(message.sender.kind)) {
    errors.push(`message ${message.id} has unsupported sender kind`);
  }
  if (message.kind !== undefined && !Object.values(MessageKind).includes(message.kind)) {
    errors.push(`message ${message.id} has unsupported kind`);
  }
  if (!message.sender.displayName.trim()) {
    errors.push(`message ${message.id} has empty sender display name`);
  }
  if (message.kind === MessageKind.Proposal && !message.proposal) {
    errors.push(`proposal message ${message.id} is missing proposal metadata`);
  }
  if (message.proposal && message.kind !== MessageKind.Proposal) {
    errors.push(`message ${message.id} carries proposal metadata without proposal kind`);
  }
  if (message.proposal) {
    if (!Object.values(ProposalStatus).includes(message.proposal.status)
      || !Object.values(ProposalKind).includes(message.proposal.kind)
      || !Object.values(ConversationPhase).includes(message.proposal.basePhase)) {
      errors.push(`proposal message ${message.id} has unsupported governance metadata`);
    }
    if (message.sender.kind !== ParticipantKind.Agent) {
      errors.push(`proposal message ${message.id} must be authored by an AI member`);
    }
    if (!Number.isSafeInteger(message.proposal.baseContextUpdatedAtMs) || message.proposal.baseContextUpdatedAtMs < 0) {
      errors.push(`proposal message ${message.id} has invalid base context timestamp`);
    }
    if (message.proposal.sourceAnchors.length === 0) {
      errors.push(`proposal message ${message.id} requires source anchors`);
    }
    const sourceIds = new Set<MessageId>();
    for (const anchor of message.proposal.sourceAnchors) {
      if (isZeroId(anchor.messageId)) {
        errors.push(`proposal message ${message.id} has invalid source anchor id`);
      }
      if (sourceIds.has(anchor.messageId)) {
        errors.push(`proposal message ${message.id} has duplicate source anchor ${anchor.messageId}`);
      }
      sourceIds.add(anchor.messageId);
      if (!Object.values(SourceAnchorStatus).includes(anchor.status)) {
        errors.push(`proposal message ${message.id} has unsupported source anchor status`);
      }
    }
  }
  const lifecycle = message.lifecycle;
  for (const value of [lifecycle?.deletedAtMs, lifecycle?.withdrawnAtMs, lifecycle?.excludedFromPromptAtMs]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      errors.push(`message ${message.id} has invalid lifecycle timestamp`);
    }
  }
  if (lifecycle?.excludedFromPromptAtMs !== undefined && !lifecycle.exclusionReason?.trim()) {
    errors.push(`prompt-quarantined message ${message.id} requires exclusion reason`);
  }
  if (lifecycle?.exclusionReason && lifecycle.deletedAtMs === undefined
    && lifecycle.withdrawnAtMs === undefined && lifecycle.excludedFromPromptAtMs === undefined) {
    errors.push(`message ${message.id} has exclusion reason without lifecycle tombstone`);
  }
  return errors;
}
