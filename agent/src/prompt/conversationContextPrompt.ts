import { entriesByKind, conversationContextEmpty } from "../context/conversationContext.ts";
import { PromptPlan } from "./promptPlan.ts";
import { ConversationContextEntryKind, ConversationContextEntryStatus, SourceAnchorStatus } from "../context/conversationContext.ts";
import type { ConversationContextEntry, ConversationContextState } from "../context/conversationContext.ts";

export interface ConversationContextPromptOptions {
  includeSourceIds: boolean;
  includeInactiveEntries: boolean;
  maxEntriesPerKind: number;
}

export const DEFAULT_CONVERSATION_CONTEXT_PROMPT_OPTIONS: ConversationContextPromptOptions = {
  includeSourceIds: true,
  includeInactiveEntries: false,
  maxEntriesPerKind: 8,
};

const SECTIONS: readonly { kind: ConversationContextEntryKind; title: string }[] = [
  { kind: ConversationContextEntryKind.Goal, title: "Current goals" },
  { kind: ConversationContextEntryKind.Constraint, title: "Active constraints" },
  { kind: ConversationContextEntryKind.Decision, title: "Active decisions" },
  { kind: ConversationContextEntryKind.CurrentDirection, title: "Current direction" },
  { kind: ConversationContextEntryKind.RejectedOption, title: "Rejected options" },
  { kind: ConversationContextEntryKind.OpenQuestion, title: "Open questions" },
  { kind: ConversationContextEntryKind.Risk, title: "Risks and conflicts" },
  { kind: ConversationContextEntryKind.KeyFact, title: "Key facts" },
  { kind: ConversationContextEntryKind.ProgressNote, title: "Progress notes" },
];

export function appendConversationContextToPrompt(
  plan: PromptPlan,
  state: ConversationContextState,
  options: ConversationContextPromptOptions = DEFAULT_CONVERSATION_CONTEXT_PROMPT_OPTIONS,
): void {
  if (conversationContextEmpty(state)) {
    return;
  }

  plan.addSystem("conversation-context", buildConversationContextBlock(state, options));
}

export function buildConversationContextBlock(
  state: ConversationContextState,
  options: ConversationContextPromptOptions = DEFAULT_CONVERSATION_CONTEXT_PROMPT_OPTIONS,
): string {
  const lines: string[] = [];

  lines.push(`Conversation context state for conversation #${state.conversationId}.`);
  lines.push(`Phase: ${state.phase}.`);
  lines.push(
    "Use this as persistent discussion state. Respect active constraints and decisions. Do not repeat rejected options unless the user reopens them.",
  );

  if (state.lastSummarizedMessageId !== "0") {
    lines.push(`Summary covers messages through #${state.lastSummarizedMessageId}.`);
  }

  if (state.summary.length > 0) {
    lines.push("", "Summary:", state.summary);
  }

  for (const section of SECTIONS) {
    const entries = entriesByKind(state, section.kind, options.includeInactiveEntries);
    if (entries.length === 0) {
      continue;
    }

    lines.push("", `${section.title}:`);
    for (const entry of entries.slice(0, options.maxEntriesPerKind > 0 ? options.maxEntriesPerKind : entries.length)) {
      const status = entry.status === ConversationContextEntryStatus.Active ? "" : `[${entry.status}] `;
      lines.push(`- ${status}${formatEntryContent(entry)}${formatSources(entry, options.includeSourceIds)}`);
    }
  }

  return lines.join("\n");
}

function formatEntryContent(entry: ConversationContextEntry): string {
  if (entry.kind !== ConversationContextEntryKind.RejectedOption || !entry.rejectedOption) {
    return entry.content;
  }

  return [
    `option: ${entry.rejectedOption.option}`,
    `reason: ${entry.rejectedOption.reason}`,
    `premise: ${entry.rejectedOption.premise}`,
  ].join(" | ");
}

function formatSources(entry: ConversationContextEntry, includeSourceIds: boolean): string {
  if (!includeSourceIds || entry.sources.length === 0) {
    return "";
  }

  return ` [sources:${entry.sources
    .map((source) => {
      const status = source.status && source.status !== SourceAnchorStatus.Active ? `:${source.status}` : "";
      return ` #${source.messageId}${status}`;
    })
    .join(",")}]`;
}
