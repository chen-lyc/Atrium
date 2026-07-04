import test from "node:test";
import assert from "node:assert/strict";

import {
  ConversationContextEntryKind,
  ConversationContextEntryStatus,
  SourceAnchorStatus,
  validateConfirmedConversationContext,
  type ConversationContextState,
} from "../src/context/conversationContext.ts";
import { ConversationPhase } from "../src/core/agentTypes.ts";
import { buildConversationContextBlock } from "../src/prompt/conversationContextPrompt.ts";

function validState(): ConversationContextState {
  return {
    conversationId: "42",
    contextVersion: "ctx-v7",
    phase: ConversationPhase.Blocked,
    summary: "The room is rechecking an assumption.",
    lastSummarizedMessageId: "10",
    updatedAtMs: 100,
    entries: [
      {
        id: "goal-1",
        kind: ConversationContextEntryKind.Goal,
        status: ConversationContextEntryStatus.Active,
        content: "Choose the durable agent boundary.",
        sources: [{ type: "message", messageId: "8", status: SourceAnchorStatus.Stale }],
        priority: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
      {
        id: "reject-1",
        kind: ConversationContextEntryKind.RejectedOption,
        status: ConversationContextEntryStatus.Active,
        content: "Do not let runtime write SQL.",
        rejectedOption: {
          option: "Runtime writes SQL directly",
          reason: "It crosses the process boundary",
          premise: "Runtime remains storage agnostic",
        },
        sources: [{ type: "owner_action", provenanceId: "owner-action-9" }],
        priority: 1,
        createdAtMs: 3,
        updatedAtMs: 4,
      },
    ],
  };
}

test("confirmed whiteboard requires provenance and a complete rejected-option tuple", () => {
  const state = validState();
  assert.deepEqual(validateConfirmedConversationContext(state), []);

  const invalid: ConversationContextState = {
    ...state,
    entries: [
      { ...state.entries[0]!, sources: [] },
      { ...state.entries[1]!, rejectedOption: { option: "x", reason: "", premise: "" } },
    ],
  };
  const errors = validateConfirmedConversationContext(invalid).join("\n");
  assert.match(errors, /missing provenance/);
  assert.match(errors, /option, reason, and premise/);
});

test("whiteboard prompt preserves anchor state and non-message provenance", () => {
  const block = buildConversationContextBlock(validState());
  assert.match(block, /Context version: ctx-v7/);
  assert.match(block, /Phase: blocked/);
  assert.match(block, /#8:stale/);
  assert.match(block, /owner_action:owner-action-9/);
  assert.match(block, /premise: Runtime remains storage agnostic/);
  assert.match(block, /Only confirmed material appears here/);
});

test("confirmed whiteboard rejects duplicate ids and malformed runtime anchor states", () => {
  const state = validState();
  const invalid = {
    ...state,
    entries: [
      state.entries[0],
      { ...state.entries[0], sources: [{ type: "message", messageId: "8", status: "invalid" }] },
    ],
  } as unknown as ConversationContextState;
  const errors = validateConfirmedConversationContext(invalid).join("\n");
  assert.match(errors, /duplicate context entry id/);
  assert.match(errors, /unsupported source status/);
});

test("confirmed whiteboard rejects unsupported non-message provenance types", () => {
  const state = validState();
  const invalid = {
    ...state,
    entries: [
      {
        ...state.entries[1]!,
        sources: [{ type: "admin_note", provenanceId: "admin-note-1" }],
      },
    ],
  } as unknown as ConversationContextState;
  const errors = validateConfirmedConversationContext(invalid).join("\n");
  assert.match(errors, /unsupported provenance type/);
});
