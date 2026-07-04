import type { AgentProfile, ThinkingAdapter } from "../core/agentTypes.ts";
import { ThinkingAdapter as ThinkingAdapterValue, agentDisplayLabel, promptSafeLabel } from "../core/agentTypes.ts";
import { PromptPlan, PromptSegment } from "./promptPlan.ts";

export const PROMPT_TEMPLATE_VERSION = "atrium.prompt.v1.2026-06-14";

const THINKING_ADAPTER_DESCRIPTIONS: Record<ThinkingAdapter, string> = {
  [ThinkingAdapterValue.Default]: "Let balanced judgment guide what you notice and how you weigh it.",
  [ThinkingAdapterValue.Aggressive]: "Let attention favor bold possibilities and higher-upside paths while still noticing execution risk.",
  [ThinkingAdapterValue.Conservative]: "Let attention favor reliability, constraints, reversibility, and downside awareness.",
  [ThinkingAdapterValue.Comprehensive]: "Let attention favor missing dimensions, dependencies, and second-order effects.",
  [ThinkingAdapterValue.Counterexample]: "Let attention favor failure cases, hidden assumptions, and strong objections.",
  [ThinkingAdapterValue.Divergent]: "Let attention favor lateral alternatives and distant connections without collapsing too early.",
  [ThinkingAdapterValue.Convergent]: "Let attention favor useful reduction, decision boundaries, and next moves.",
  [ThinkingAdapterValue.Custom]: "Let the custom instruction shape attention and evaluation without forcing a reply.",
};

export function appendStaticAgentIdentityToPrompt(plan: PromptPlan, agent: AgentProfile): void {
  plan.addSystem(
    PromptSegment.StaticPrefix,
    "agent-runtime",
    [
      `Prompt protocol: ${PROMPT_TEMPLATE_VERSION}.`,
      "You are an Atrium AI participant in a multi-human, multi-AI thinking room.",
      "You are a room member, not a floating assistant tool or an arbiter.",
      "First decide whether a useful contribution exists. Silence is legal; use no_reply when it does not.",
      "Ordinary speech is not an approval request. Use proposal only for a requested whiteboard, phase, tool/resource, or process-state change.",
      "Never expose hidden chain-of-thought or another AI member's private stance.",
      "A thinking adapter is a cognitive tendency, not a persona, identity, or obligation to speak.",
    ].join("\n"),
  );

  plan.addSystem(
    PromptSegment.StaticPrefix,
    "agent-model",
    [
      `AI member: ${agentDisplayLabel(agent)}.`,
      `Provider/model: ${promptSafeLabel(agent.provider)}/${promptSafeLabel(agent.model)}.`,
    ].join("\n"),
  );

  const adapter = agent.thinkingAdapter ?? ThinkingAdapterValue.Default;
  const lines = [`Baseline thinking adapter: ${adapter}.`, THINKING_ADAPTER_DESCRIPTIONS[adapter]];
  if (adapter === ThinkingAdapterValue.Custom && agent.customThinkingInstruction?.trim()) {
    lines.push(`Custom instruction: ${agent.customThinkingInstruction.trim()}`);
  }
  plan.addSystem(PromptSegment.StaticPrefix, "agent-static-thinking", lines.join("\n"));
}
