import type { AgentProfile, ThinkingAdapter } from "../core/agentTypes.ts";
import { ThinkingAdapter as ThinkingAdapterValue, agentMemberLabel } from "../core/agentTypes.ts";
import { activeAgentStanceHistoryRecords, type AgentStanceHistory } from "../context/stanceHistory.ts";
import { entriesByKind, type ConversationContextState } from "../context/conversationContext.ts";
import { ConversationContextEntryKind, ConversationPhase } from "../context/conversationContext.ts";
import { PromptPlan } from "./promptPlan.ts";

export interface PrivateStancePromptOptions {
  maxRecords: number;
}

export const DEFAULT_PRIVATE_STANCE_PROMPT_OPTIONS: PrivateStancePromptOptions = {
  maxRecords: 6,
};

export function appendPrivateStanceToPrompt(
  plan: PromptPlan,
  agent: AgentProfile,
  state: ConversationContextState | undefined,
  history: AgentStanceHistory | undefined,
  options: PrivateStancePromptOptions = DEFAULT_PRIVATE_STANCE_PROMPT_OPTIONS,
): void {
  plan.addSystem("agent-private-stance", buildPrivateStanceBlock(agent, state, history, options));
}

export function buildPrivateStanceBlock(
  agent: AgentProfile,
  state: ConversationContextState | undefined,
  history: AgentStanceHistory | undefined,
  options: PrivateStancePromptOptions = DEFAULT_PRIVATE_STANCE_PROMPT_OPTIONS,
): string {
  const lines: string[] = [];

  lines.push(`Private stance continuity for ${agentMemberLabel(agent)}.`);
  lines.push("This is private to this AI member inside this conversation. Do not infer or import another AI member's private stance.");
  lines.push("Use this only as evidence of prior judgments, concerns, and reasons. Do not turn it into a persona, role, or obligation to repeat an old angle.");
  lines.push("First decide whether this turn deserves a contribution. If not, <NO_REPLY> remains valid; the thinking adapter only shapes a reply after that decision.");

  const records = activeAgentStanceHistoryRecords(history);
  if (records.length > 0) {
    lines.push("", "Your prior stance in this conversation:");
    for (const record of records.slice(-options.maxRecords)) {
      lines.push(`- after trigger #${record.triggerMessageId}: ${record.content}`);
    }
  } else {
    lines.push("", "Your prior stance in this conversation: none recorded yet.");
  }

  lines.push("", "Re-instantiation instruction:");
  lines.push(buildReinstantiationInstruction(agent, state));

  return lines.join("\n");
}

export function buildReinstantiationInstruction(agent: AgentProfile, state: ConversationContextState | undefined): string {
  const phase = state?.phase ?? ConversationPhase.Divergence;
  const focus = selectPhaseFocus(state);
  const adapter = agent.thinkingAdapter ?? ThinkingAdapterValue.Default;
  const custom = adapter === ThinkingAdapterValue.Custom ? agent.customThinkingInstruction : undefined;

  if (phase === ConversationPhase.Divergence) {
    return buildDivergenceInstruction(adapter, focus, custom);
  }

  if (custom && custom.length > 0) {
    return `${phaseLead(phase)} If a reply is warranted, apply your custom thinking instruction to "${focus}". Custom instruction: ${custom}`;
  }

  return `${phaseLead(phase)} If a reply is warranted, ${adapterAction(adapter, phase, focus)}`;
}

function selectPhaseFocus(state: ConversationContextState | undefined): string {
  if (!state) {
    return "the current discussion";
  }

  if (state.phase === ConversationPhase.Divergence) {
    return firstEntryContent(state, ConversationContextEntryKind.Goal) ?? firstEntryContent(state, ConversationContextEntryKind.OpenQuestion) ?? fallbackFocus(state);
  }

  if (state.phase === ConversationPhase.ConvergenceExecution) {
    return convergenceFocus(state) ?? firstEntryContent(state, ConversationContextEntryKind.ProgressNote) ?? fallbackFocus(state);
  }

  return (
    firstEntryContent(state, ConversationContextEntryKind.Risk) ??
    firstEntryContent(state, ConversationContextEntryKind.RejectedOption) ??
    firstEntryContent(state, ConversationContextEntryKind.Decision) ??
    fallbackFocus(state)
  );
}

function firstEntryContent(state: ConversationContextState, kind: ConversationContextEntryKind): string | undefined {
  const entry = entriesByKind(state, kind)[0];
  if (!entry) {
    return undefined;
  }
  if (entry.kind === ConversationContextEntryKind.RejectedOption && entry.rejectedOption) {
    return `${entry.rejectedOption.option} (rejected because ${entry.rejectedOption.reason}; premise: ${entry.rejectedOption.premise})`;
  }
  return entry.content;
}

function convergenceFocus(state: ConversationContextState): string | undefined {
  const decision = firstEntryContent(state, ConversationContextEntryKind.Decision);
  const direction = firstEntryContent(state, ConversationContextEntryKind.CurrentDirection);
  if (decision && direction) {
    return `latest decision: ${decision}; current direction: ${direction}`;
  }
  return decision ?? direction;
}

function fallbackFocus(state: ConversationContextState): string {
  return state.summary.length > 0 ? state.summary : "the current discussion";
}

function phaseLead(phase: ConversationPhase): string {
  if (phase === ConversationPhase.Divergence) {
    return "Exploration mode:";
  }
  if (phase === ConversationPhase.ConvergenceExecution) {
    return "Shared direction mode:";
  }
  return "Premise review mode:";
}

function adapterAction(adapter: ThinkingAdapter, phase: ConversationPhase, focus: string): string {
  if (phase === ConversationPhase.ConvergenceExecution) {
    return convergenceAction(adapter, focus);
  }
  return blockedAction(adapter, focus);
}

function buildDivergenceInstruction(adapter: ThinkingAdapter, focus: string, custom: string | undefined): string {
  const lines = [
    `${phaseLead(ConversationPhase.Divergence)} Treat any owner preference expressed during exploration as an input, not a decision; evaluate independently from this AI member's own stance.`,
    `If a reply is warranted, evaluate the idea or proposal itself around "${focus}" as an object of analysis, not as a stance to agree with.`,
  ];

  if (custom && custom.length > 0) {
    lines.push(`Custom thinking instruction for this independent evaluation: ${custom}`);
  } else {
    lines.push(divergenceAction(adapter, focus));
  }

  return lines.join(" ");
}

function divergenceAction(adapter: ThinkingAdapter, focus: string): string {
  switch (adapter) {
    case ThinkingAdapterValue.Aggressive:
      return `Assessment focus: the boldest viable possibility for "${focus}" and the evidence that would make it worth the risk.`;
    case ThinkingAdapterValue.Conservative:
      return `Assessment focus: the hard constraints around "${focus}" and the safest useful path.`;
    case ThinkingAdapterValue.Comprehensive:
      return `Assessment focus: missing dimensions around "${focus}" before the room narrows too early.`;
    case ThinkingAdapterValue.Counterexample:
      return `Assessment focus: the most easily overlooked failure scenario for "${focus}".`;
    case ThinkingAdapterValue.Divergent:
      return `Assessment focus: lateral alternatives for "${focus}" that are not obvious from the current thread.`;
    case ThinkingAdapterValue.Convergent:
      return `Assessment focus: a useful decision boundary for the scattered possibilities around "${focus}".`;
    case ThinkingAdapterValue.Custom:
    case ThinkingAdapterValue.Default:
      return `Assessment focus: the most useful independent contribution for "${focus}" without copying the room consensus.`;
  }
}

function convergenceAction(adapter: ThinkingAdapter, focus: string): string {
  switch (adapter) {
    case ThinkingAdapterValue.Aggressive:
      return `let your attention favor whether a more decisive version of the current shared direction "${focus}" was prematurely excluded.`;
    case ThinkingAdapterValue.Conservative:
      return `let your attention favor the reversible, reliable path for the current shared direction "${focus}".`;
    case ThinkingAdapterValue.Comprehensive:
      return `let your attention favor the dependencies that must hold for the current shared direction "${focus}".`;
    case ThinkingAdapterValue.Counterexample:
      return `let your attention favor the situation where the current shared direction "${focus}" breaks.`;
    case ThinkingAdapterValue.Divergent:
      return `let your attention favor an adjacent route that could still improve the current shared direction "${focus}".`;
    case ThinkingAdapterValue.Convergent:
      return `let your attention favor the next useful move for the current shared direction "${focus}".`;
    case ThinkingAdapterValue.Custom:
    case ThinkingAdapterValue.Default:
      return `let your attention favor helping the room move on the current shared direction "${focus}" while keeping prior objections traceable.`;
  }
}

function blockedAction(adapter: ThinkingAdapter, focus: string): string {
  switch (adapter) {
    case ThinkingAdapterValue.Aggressive:
      return `let your attention favor the most decisive reset if the questioned premise "${focus}" is false.`;
    case ThinkingAdapterValue.Conservative:
      return `let your attention favor the safest fallback before rebuilding around the questioned premise "${focus}".`;
    case ThinkingAdapterValue.Comprehensive:
      return `let your attention favor which decisions and rejected options depend on the questioned premise "${focus}".`;
    case ThinkingAdapterValue.Counterexample:
      return `let your attention favor the failure mode that was previously dismissed around the questioned premise "${focus}".`;
    case ThinkingAdapterValue.Divergent:
      return `let your attention favor alternatives that the questioned premise "${focus}" may have suppressed.`;
    case ThinkingAdapterValue.Convergent:
      return `let your attention favor what must be re-decided before the room continues from the questioned premise "${focus}".`;
    case ThinkingAdapterValue.Custom:
    case ThinkingAdapterValue.Default:
      return `let your attention favor re-evaluation around the questioned premise "${focus}" without pretending the old consensus is still stable.`;
  }
}
