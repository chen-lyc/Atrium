import type { AgentProfile, MessageRef } from "../core/agentTypes.ts";
import { MessageKind, promptSafeLabel } from "../core/agentTypes.ts";
import { PromptPlan, PromptSegment } from "./promptPlan.ts";

export function appendMessagesToPrompt(
  plan: PromptPlan,
  segment: typeof PromptSegment.ContextMessages | typeof PromptSegment.TriggerMessages,
  messages: readonly MessageRef[],
  agent: AgentProfile,
): void {
  if (messages.length === 0) {
    const isContext = segment === PromptSegment.ContextMessages;
    plan.addSystem(
      segment,
      isContext ? "context-messages-empty" : "trigger-messages-empty",
      isContext ? "No bounded context messages were selected for this snapshot." : "No trigger messages were selected for this snapshot.",
    );
    return;
  }
  for (const message of messages) {
    const label = promptMessageSpeakerLabel(message, agent);
    const content = renderMessageContent(message);
    if (message.sender.kind === "agent" && message.sender.id === agent.id) {
      plan.addAssistant(segment, label, content);
    } else {
      plan.addUser(segment, label, content);
    }
  }
}

export function renderMessageContent(message: MessageRef): string {
  if (message.kind !== MessageKind.Proposal || !message.proposal) {
    return message.content;
  }
  const proposal = message.proposal;
  return [
    `[unconfirmed_proposal / no authority / status=${proposal.status} / proposal_id=${promptSafeLabel(proposal.proposalId)}]`,
    `[source_anchors=${proposal.sourceAnchors.map((anchor) => `${promptSafeLabel(anchor.messageId)}:${anchor.status}`).join(",")}]`,
    message.content,
  ].join("\n");
}

export function validatePromptSpeakerLabels(messages: readonly MessageRef[], agent: AgentProfile): void {
  const labels = new Map<string, { readonly participantKey: string; readonly messageId: string }>();
  for (const message of messages) {
    const label = promptMessageSpeakerLabel(message, agent);
    const participantKey = `${message.sender.kind}:${message.sender.id}`;
    const previous = labels.get(label);
    if (previous && previous.participantKey !== participantKey) {
      throw new Error(
        `duplicate prompt speaker label "${label}" for messages ${previous.messageId} and ${message.id}; agent read adapter must provide disambiguated display_label`,
      );
    }
    labels.set(label, { participantKey, messageId: message.id });
  }
}

export function promptMessageSpeakerLabel(message: MessageRef, agent: AgentProfile): string {
  const sender = message.sender;
  const displayName = promptSafeLabel(sender.displayName);
  if (sender.kind === "agent" && sender.id === agent.id) {
    return displayName ? `${displayName} (current AI)` : "Current AI";
  }
  return displayName || (sender.kind === "system" ? "System" : sender.kind === "agent" ? "AI member" : "Human member");
}
