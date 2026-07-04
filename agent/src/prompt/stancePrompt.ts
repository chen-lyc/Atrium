import type { AgentProfile, ConversationPhase, ThinkingAdapter } from "../core/agentTypes.ts";
import {
  ConversationPhase as ConversationPhaseValue,
  ThinkingAdapter as ThinkingAdapterValue,
  agentMemberLabel,
  promptSafeLabel,
} from "../core/agentTypes.ts";
import type { AgentStanceHistoryRecord } from "../context/stanceHistory.ts";
import { entriesByKind, type ConversationContextState } from "../context/conversationContext.ts";
import { ConversationContextEntryKind } from "../context/conversationContext.ts";
import { PromptPlan, PromptSegment } from "./promptPlan.ts";

export interface PromptGuardrails {
  readonly thirdPersonDivergenceFrame: boolean;
  readonly humanPreferenceHedge: boolean;
}

export const DEFAULT_PROMPT_GUARDRAILS: PromptGuardrails = {
  thirdPersonDivergenceFrame: false,
  humanPreferenceHedge: false,
};

export function appendPrivateStanceToPrompt(
  plan: PromptPlan,
  agent: AgentProfile,
  state: ConversationContextState,
  records: readonly AgentStanceHistoryRecord[],
  guardrails: PromptGuardrails = DEFAULT_PROMPT_GUARDRAILS,
): void {
  plan.addSystem(
    PromptSegment.PrivateEvidence,
    "agent-private-stance",
    buildPrivateStanceBlock(agent, state, records, guardrails),
  );
}

export function buildPrivateStanceBlock(
  agent: AgentProfile,
  state: ConversationContextState,
  records: readonly AgentStanceHistoryRecord[],
  guardrails: PromptGuardrails = DEFAULT_PROMPT_GUARDRAILS,
): string {
  const lines = [
    `Private evidence for ${agentMemberLabel(agent)}.`,
    "This slot contains only this AI member's prior public outputs from this conversation.",
    "Use it as evidence of earlier judgments, concerns, and reasons; it is not identity, personality, or an obligation to repeat them.",
    "First decide whether this turn deserves a contribution. If not, no_reply remains valid.",
  ];

  if (records.length === 0) {
    lines.push("", "Prior private evidence: none recorded yet.");
  } else {
    lines.push("", "Prior private evidence:");
    for (const record of records) {
      if (record.responseKind === "proposal" && (!record.proposalId || !record.proposalStatus || !record.proposalDigest?.trim())) {
        throw new Error(`proposal stance ${record.id} is missing current governance metadata`);
      }
      const proposal = record.responseKind === "proposal"
        ? ` proposal_status=${record.proposalStatus}`
        : "";
      const evidence = record.responseKind === "proposal" ? record.proposalDigest! : record.content;
      lines.push(`- message #${promptSafeLabel(record.responseMessageId)}${proposal}: ${evidence}`);
    }
  }

  lines.push("", "Phase re-instantiation:", buildReinstantiationInstruction(agent, state, guardrails));
  return lines.join("\n");
}

export function buildReinstantiationInstruction(
  agent: AgentProfile,
  state: ConversationContextState,
  guardrails: PromptGuardrails = DEFAULT_PROMPT_GUARDRAILS,
): string {
  const focus = selectPhaseFocus(state);
  const adapter = agent.thinkingAdapter ?? ThinkingAdapterValue.Default;
  const custom = adapter === ThinkingAdapterValue.Custom ? agent.customThinkingInstruction?.trim() : undefined;

  if (state.phase === ConversationPhaseValue.Divergence) {
    const parts = ["Exploration mode:"];
    if (guardrails.humanPreferenceHedge) {
      parts.push("Treat a human preference expressed during exploration as input, not a decision; evaluate independently.");
    }
    if (guardrails.thirdPersonDivergenceFrame) {
      parts.push(`If a reply is warranted, evaluate the idea or proposal around "${focus}" as the object of analysis.`);
    } else {
      parts.push("If a reply is warranted, preserve independent judgment.");
    }
    parts.push(custom ? `Apply this custom thinking instruction: ${custom}` : divergenceAction(adapter, focus));
    return parts.join(" ");
  }

  if (custom) {
    return `${phaseLead(state.phase)} If a reply is warranted, apply this custom thinking instruction to "${focus}": ${custom}`;
  }
  return `${phaseLead(state.phase)} If a reply is warranted, ${phaseAction(adapter, state.phase, focus)}`;
}

function selectPhaseFocus(state: ConversationContextState): string {
  if (state.phase === ConversationPhaseValue.Divergence) {
    return firstEntryContent(state, ConversationContextEntryKind.Goal) ?? fallbackFocus(state);
  }
  if (state.phase === ConversationPhaseValue.ConvergenceExecution) {
    return convergenceFocus(state) ?? fallbackFocus(state);
  }
  return firstEntryContent(state, ConversationContextEntryKind.RejectedOption)
    ?? firstEntryContent(state, ConversationContextEntryKind.Decision)
    ?? fallbackFocus(state);
}

function firstEntryContent(state: ConversationContextState, kind: ConversationContextEntryKind): string | undefined {
  const entry = entriesByKind(state, kind)[0];
  if (!entry) {
    return undefined;
  }
  if (entry.kind === ConversationContextEntryKind.RejectedOption && entry.rejectedOption) {
    return `${entry.rejectedOption.option} (reason: ${entry.rejectedOption.reason}; premise: ${entry.rejectedOption.premise})`;
  }
  return entry.content;
}

function convergenceFocus(state: ConversationContextState): string | undefined {
  const decision = firstEntryContent(state, ConversationContextEntryKind.Decision);
  const direction = firstEntryContent(state, ConversationContextEntryKind.CurrentDirection);
  return decision && direction ? `latest decision: ${decision}; current direction: ${direction}` : decision ?? direction;
}

function fallbackFocus(state: ConversationContextState): string {
  return state.summary.length > 0 ? state.summary : "the current discussion";
}

function phaseLead(phase: ConversationPhase): string {
  return phase === ConversationPhaseValue.ConvergenceExecution ? "Shared direction mode:" : "Premise review mode:";
}

function divergenceAction(adapter: ThinkingAdapter, focus: string): string {
  const actions: Record<ThinkingAdapter, string> = {
    default: `Notice the most useful independent contribution for "${focus}" without copying room consensus.`,
    aggressive: `Notice the boldest viable possibility for "${focus}" and the evidence needed to justify its risk.`,
    conservative: `Notice hard constraints around "${focus}" and the safest useful path.`,
    comprehensive: `Notice missing dimensions around "${focus}" before the room narrows.`,
    counterexample: `Notice the most easily overlooked failure scenario for "${focus}".`,
    divergent: `Notice lateral alternatives for "${focus}" that are not obvious from the current thread.`,
    convergent: `Notice a useful decision boundary among the possibilities around "${focus}".`,
    custom: `Notice the most useful independent contribution for "${focus}".`,
  };
  return actions[adapter];
}

function phaseAction(adapter: ThinkingAdapter, phase: ConversationPhase, focus: string): string {
  if (phase === ConversationPhaseValue.ConvergenceExecution) {
    const actions: Record<ThinkingAdapter, string> = {
      default: `help advance "${focus}" while keeping prior objections traceable.`,
      aggressive: `check whether a more decisive version of "${focus}" was prematurely excluded.`,
      conservative: `identify the reversible and reliable path for "${focus}".`,
      comprehensive: `identify dependencies that must hold for "${focus}".`,
      counterexample: `identify the situation where "${focus}" breaks.`,
      divergent: `identify an adjacent route that could still improve "${focus}".`,
      convergent: `identify the next useful move for "${focus}".`,
      custom: `help advance "${focus}" while keeping prior objections traceable.`,
    };
    return actions[adapter];
  }
  const actions: Record<ThinkingAdapter, string> = {
    default: `re-evaluate the premise behind "${focus}" without pretending the old consensus remains stable.`,
    aggressive: `identify the most decisive reset if the premise behind "${focus}" is false.`,
    conservative: `identify the safest fallback before rebuilding around "${focus}".`,
    comprehensive: `trace which decisions and rejected options depend on "${focus}".`,
    counterexample: `revisit the failure mode previously dismissed around "${focus}".`,
    divergent: `identify alternatives that the premise behind "${focus}" may have suppressed.`,
    convergent: `identify what must be re-decided before continuing from "${focus}".`,
    custom: `re-evaluate the premise behind "${focus}" without pretending the old consensus remains stable.`,
  };
  return actions[adapter];
}
