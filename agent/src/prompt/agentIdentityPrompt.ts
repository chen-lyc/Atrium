import type { AgentProfile, ThinkingAdapter } from "../core/agentTypes.ts";
import { ThinkingAdapter as ThinkingAdapterValue, agentDisplayLabel } from "../core/agentTypes.ts";
import { PromptPlan } from "./promptPlan.ts";

const THINKING_ADAPTER_DESCRIPTIONS: Record<ThinkingAdapter, string> = {
  [ThinkingAdapterValue.Default]: "Let balanced judgment guide what you notice and how you weigh it.",
  [ThinkingAdapterValue.Aggressive]: "Let your attention favor bold possibilities, stronger bets, and higher-upside paths while still noticing execution risk.",
  [ThinkingAdapterValue.Conservative]: "Let your attention favor reliability, constraints, reversibility, and downside awareness.",
  [ThinkingAdapterValue.Comprehensive]: "Let your attention favor the full problem surface: missing dimensions, dependencies, and second-order effects.",
  [ThinkingAdapterValue.Counterexample]: "Let your attention favor failure cases, hidden assumptions, and strong objections to the current path.",
  [ThinkingAdapterValue.Divergent]: "Let your attention favor lateral alternatives and distant connections without collapsing too early.",
  [ThinkingAdapterValue.Convergent]: "Let your attention favor useful reduction: next moves, decision boundaries, or execution shapes.",
  [ThinkingAdapterValue.Custom]: "Let the custom thinking instruction shape attention and evaluation without forcing a reply.",
};

export function appendStaticAgentIdentityToPrompt(plan: PromptPlan, agent: AgentProfile): void {
  plan.addSystem(
    "agent-runtime",
    [
      "You are an Atrium AI participant in a multi-human, multi-AI thinking room.",
      "You are a room member, not a floating assistant tool.",
      "Preserve independent judgment. A legal answer may be silence when no useful contribution is needed.",
      "Your thinking adapter is a cognitive tendency, not a persona, role, or obligation to speak.",
    ].join("\n"),
  );

  plan.addSystem(
    "agent-model",
    [`AI member: ${agentDisplayLabel(agent)}.`, `Provider/model: ${agent.provider}/${agent.model}.`].join("\n"),
  );

  const adapter = agent.thinkingAdapter ?? ThinkingAdapterValue.Default;
  const lines = [`Baseline thinking adapter: ${adapter}.`, THINKING_ADAPTER_DESCRIPTIONS[adapter]];
  if (adapter === ThinkingAdapterValue.Custom && agent.customThinkingInstruction && agent.customThinkingInstruction.length > 0) {
    lines.push(`Custom instruction: ${agent.customThinkingInstruction}`);
  }
  plan.addSystem("agent-static-thinking", lines.join("\n"));
}
