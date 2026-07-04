import { entriesByKind } from "../context/conversationContext.ts";
import { ConversationContextEntryKind, ConversationContextEntryStatus } from "../context/conversationContext.ts";
import type { ContextProvenance, ConversationContextEntry, ConversationContextState } from "../context/conversationContext.ts";
import { promptSafeLabel } from "../core/agentTypes.ts";
import { PromptPlan, PromptSegment } from "./promptPlan.ts";

export interface ConversationContextPromptOptions {
  readonly includeSourceIds: boolean;
  readonly includeInactiveEntries: boolean;
  readonly maxEntriesPerKind: number;
}

export const DEFAULT_CONVERSATION_CONTEXT_PROMPT_OPTIONS: ConversationContextPromptOptions = {
  includeSourceIds: true,
  includeInactiveEntries: false,
  maxEntriesPerKind: 8,
};

const SECTIONS: readonly { kind: ConversationContextEntryKind; title: string }[] = [
  { kind: ConversationContextEntryKind.Goal, title: "Current goals" },
  { kind: ConversationContextEntryKind.Constraint, title: "Confirmed constraints" },
  { kind: ConversationContextEntryKind.Decision, title: "Confirmed decisions" },
  { kind: ConversationContextEntryKind.CurrentDirection, title: "Confirmed current direction" },
  { kind: ConversationContextEntryKind.RejectedOption, title: "Rejected options" },
  { kind: ConversationContextEntryKind.OpenQuestion, title: "Open questions" },
  { kind: ConversationContextEntryKind.Risk, title: "Risks" },
  { kind: ConversationContextEntryKind.KeyFact, title: "Key facts" },
  { kind: ConversationContextEntryKind.ProgressNote, title: "Progress notes" },
];

export function appendConversationContextToPrompt(
  plan: PromptPlan,
  state: ConversationContextState,
  options: ConversationContextPromptOptions = DEFAULT_CONVERSATION_CONTEXT_PROMPT_OPTIONS,
): void {
  plan.addSystem(PromptSegment.ConfirmedWhiteboard, "conversation-context", buildConversationContextBlock(state, options));
}

export function buildConversationContextBlock(
  state: ConversationContextState,
  options: ConversationContextPromptOptions = DEFAULT_CONVERSATION_CONTEXT_PROMPT_OPTIONS,
): string {
  const lines = [
    `Confirmed conversation whiteboard for conversation #${promptSafeLabel(state.conversationId)}.`,
    `Context version: ${promptSafeLabel(state.contextVersion)}.`,
    `Phase: ${state.phase}.`,
    "Only confirmed material appears here. Treat proposals and drafts elsewhere as unconfirmed.",
  ];

  if (state.lastSummarizedMessageId !== "0") {
    lines.push(`Summary covers messages through #${promptSafeLabel(state.lastSummarizedMessageId)}.`);
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
    const limit = options.maxEntriesPerKind > 0 ? options.maxEntriesPerKind : entries.length;
    for (const entry of entries.slice(0, limit)) {
      const status = entry.status === ConversationContextEntryStatus.Active ? "" : `[${entry.status}] `;
      lines.push(`- ${status}${formatEntryContent(entry)}${formatSources(entry.sources, options.includeSourceIds)}`);
    }
  }

  if (state.summary.length === 0 && state.entries.length === 0) {
    lines.push("", "No confirmed whiteboard content yet.");
  }
  return lines.join("\n");
}

function formatEntryContent(entry: ConversationContextEntry): string {
  if (entry.kind !== ConversationContextEntryKind.RejectedOption || !entry.rejectedOption) {
    return entry.content;
  }
  return `option: ${entry.rejectedOption.option} | reason: ${entry.rejectedOption.reason} | premise: ${entry.rejectedOption.premise}`;
}

function formatSources(sources: readonly ContextProvenance[], includeSourceIds: boolean): string {
  if (!includeSourceIds) {
    return "";
  }
  return ` [sources:${sources.map(formatSource).join(",")}]`;
}

function formatSource(source: ContextProvenance): string {
  if (source.type === "message") {
    return ` #${promptSafeLabel(source.messageId)}:${source.status}`;
  }
  return ` ${source.type}:${promptSafeLabel(source.provenanceId)}`;
}
