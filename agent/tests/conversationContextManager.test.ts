import test from "node:test";
import assert from "node:assert/strict";

import {
  ConversationContextEntryKind,
  ConversationContextEntryStatus,
  ConversationPhase,
  SourceAnchorStatus,
  createConversationContextState,
} from "../src/context/conversationContext.ts";
import {
  ConversationContextManager,
  ConversationContextPatchAuthor,
  ConversationContextPatchOperation,
} from "../src/context/conversationContextManager.ts";
import { buildConversationContextBlock } from "../src/prompt/conversationContextPrompt.ts";

test("conversation context manager applies patches and prompt renders active state", () => {
  const manager = new ConversationContextManager({ maxUnsummarizedMessages: 10n });
  const state = createConversationContextState("42");

  const applied = manager.applyPatch(state, {
    conversationId: "42",
    author: ConversationContextPatchAuthor.Owner,
    updatedAtMs: 1000,
    items: [
      {
        operation: ConversationContextPatchOperation.UpdateSummary,
        summary: "The room is deciding where the agent boundary belongs.",
      },
      {
        operation: ConversationContextPatchOperation.SetPhase,
        phase: ConversationPhase.ConvergenceExecution,
      },
      {
        operation: ConversationContextPatchOperation.UpsertEntry,
        entry: {
          id: "",
          kind: ConversationContextEntryKind.Decision,
          status: ConversationContextEntryStatus.Active,
          content: "The bridge owns backend transition contracts.",
          sources: [{ messageId: "12", note: "user direction", status: SourceAnchorStatus.Stale }],
          priority: 2,
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      },
      {
        operation: ConversationContextPatchOperation.UpsertEntry,
        entry: {
          id: "",
          kind: ConversationContextEntryKind.CurrentDirection,
          status: ConversationContextEntryStatus.Active,
          content: "Keep the agent contract at the bridge boundary.",
          sources: [{ messageId: "12", note: "owner direction" }],
          priority: 2,
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      },
      {
        operation: ConversationContextPatchOperation.UpsertEntry,
        entry: {
          id: "",
          kind: ConversationContextEntryKind.RejectedOption,
          status: ConversationContextEntryStatus.Active,
          content: "",
          rejectedOption: {
            option: "Let the runtime write SQL directly.",
            reason: "It would couple agent execution to backend storage.",
            premise: "Runtime must remain transport and storage agnostic.",
          },
          sources: [{ messageId: "13", note: "owner rejection" }],
          priority: 1,
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      },
      {
        operation: ConversationContextPatchOperation.SetLastSummarizedMessage,
        messageId: "15",
      },
    ],
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.state.entries[0]?.id, "ctx_42_1");
  assert.equal(applied.state.phase, ConversationPhase.ConvergenceExecution);
  assert.equal(manager.needsSummarization(applied.state, "26"), true);

  const block = buildConversationContextBlock(applied.state);
  assert.match(block, /Phase: convergence_execution/);
  assert.match(block, /Active decisions/);
  assert.match(block, /The bridge owns backend transition contracts/);
  assert.match(block, /Current direction/);
  assert.match(block, /Keep the agent contract at the bridge boundary/);
  assert.match(block, /Rejected options/);
  assert.match(block, /reason: It would couple agent execution to backend storage/);
  assert.match(block, /premise: Runtime must remain transport and storage agnostic/);
  assert.match(block, /#12:stale/);
});

test("conversation context manager keeps decision zone owner-only", () => {
  const manager = new ConversationContextManager();
  const state = createConversationContextState("42");

  const applied = manager.applyPatch(state, {
    conversationId: "42",
    author: ConversationContextPatchAuthor.System,
    updatedAtMs: 1000,
    items: [
      {
        operation: ConversationContextPatchOperation.UpsertEntry,
        entry: {
          id: "",
          kind: ConversationContextEntryKind.RejectedOption,
          status: ConversationContextEntryStatus.Active,
          content: "",
          rejectedOption: {
            option: "Automatically mark a proposal rejected.",
            reason: "The model inferred it from discussion tone.",
            premise: "A model is allowed to infer owner decisions.",
          },
          sources: [],
          priority: 0,
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      },
    ],
  });

  assert.equal(applied.ok, false);
  assert.match(applied.error, /owner/);
  assert.equal(applied.state.entries.length, 0);
});

test("conversation context manager keeps current direction and phase owner-only", () => {
  const manager = new ConversationContextManager();
  const state = createConversationContextState("42");

  const direction = manager.applyPatch(state, {
    conversationId: "42",
    author: ConversationContextPatchAuthor.System,
    updatedAtMs: 1000,
    items: [
      {
        operation: ConversationContextPatchOperation.UpsertEntry,
        entry: {
          id: "",
          kind: ConversationContextEntryKind.CurrentDirection,
          status: ConversationContextEntryStatus.Active,
          content: "Move into implementation.",
          sources: [],
          priority: 0,
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      },
    ],
  });

  assert.equal(direction.ok, false);
  assert.match(direction.error, /owner/);
  assert.equal(direction.state.entries.length, 0);

  const phase = manager.applyPatch(state, {
    conversationId: "42",
    author: ConversationContextPatchAuthor.System,
    updatedAtMs: 1000,
    items: [
      {
        operation: ConversationContextPatchOperation.SetPhase,
        phase: ConversationPhase.ConvergenceExecution,
      },
    ],
  });

  assert.equal(phase.ok, false);
  assert.match(phase.error, /owner/);
  assert.equal(phase.state.phase, ConversationPhase.Divergence);
});
