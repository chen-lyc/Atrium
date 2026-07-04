import test from "node:test";
import assert from "node:assert/strict";

import { BACKEND_AGENT_PROTOCOL_VERSION } from "../src/bridge/backendTransition.ts";
import {
  normalizeAgentReadMaterialization,
  type AgentReadMaterializationPayload,
} from "../src/bridge/readMaterialization.ts";
import { ProposalKind, ProposalStatus } from "../src/core/agentTypes.ts";

function refPayload() {
  return {
    task_id: "task-1",
    attempt_no: 1,
    room_id: "1",
    conversation_id: "2",
    ai_id: "8",
  };
}

function materializationPayload(overrides = {}) {
  return {
    processed_until_before: "10",
    handled_until_message_id: "12",
    retrieved_anchor_message_ids: ["7"],
    phase_at_materialization: "divergence",
    context_version_at_materialization: "ctx-v3",
    context_updated_at_ms_at_materialization: 88,
    ...overrides,
  };
}

test("agent read materialization rejects duplicate retrieved anchors instead of silently changing exposure", () => {
  assert.throws(() => normalizeAgentReadMaterialization({
    protocol: BACKEND_AGENT_PROTOCOL_VERSION,
    ref: refPayload(),
    agent: { id: "8", provider: "fake", model: "m" },
    turn: {
      source: "user_message",
      materialization: materializationPayload({ retrieved_anchor_message_ids: ["7", "7"] }),
      messages: [],
    },
  }), /must be unique/);
});

test("agent read materialization rejects old prompt-boundary fields", () => {
  for (const field of ["trigger_message_id", "context_until_message_id", "visible_until", "focus_message_ids"]) {
    const materialization = { ...materializationPayload() } as Record<string, unknown>;
    materialization[field] = "legacy";
    assert.throws(() => normalizeAgentReadMaterialization({
      protocol: BACKEND_AGENT_PROTOCOL_VERSION,
      ref: refPayload(),
      agent: { id: "8", provider: "fake", model: "m" },
      turn: {
        source: "user_message",
        materialization: materialization as any,
        messages: [],
      },
    }), new RegExp(`agent read materialization must not include ${field}`));
  }
});

test("agent read materialization normalizes proposal status and prompt quarantine metadata", () => {
  const normalized = normalizeAgentReadMaterialization({
    protocol: BACKEND_AGENT_PROTOCOL_VERSION,
    ref: refPayload(),
    agent: { id: "8", provider: "fake", model: "m", thinking_adapter: "counterexample" },
    turn: {
      source: "user_message",
      materialization: materializationPayload(),
      messages: [
        {
          id: "10",
          sender: { id: "7", kind: "agent", display_name: "Other AI", display_label: "Other AI (planner)" },
          content: "Change the shared direction.",
          kind: "proposal",
          proposal: {
            proposal_id: "p-1",
            status: "rejected",
            kind: "whiteboard",
            base_phase: "divergence",
            base_context_updated_at_ms: 88,
            source_anchors: [{ message_id: "9", status: "stale" }],
          },
        },
        {
          id: "11",
          sender: { id: "6", kind: "user", display_label: "Lyc" },
          content: "Withdrawn text",
          lifecycle: { excluded_from_prompt_at_ms: 99, exclusion_reason: "security purge" },
        },
      ],
    },
  });
  assert.equal(normalized.turn.task.taskId, normalized.ref.taskId);
  assert.equal(normalized.turn.task.agentId, normalized.ref.agentId);
  assert.equal(normalized.turn.task.processedUntilBefore, "10");
  assert.equal(normalized.turn.task.handledUntilMessageId, "12");
  assert.deepEqual(normalized.turn.task.retrievedAnchorMessageIds, ["7"]);
  assert.equal(normalized.turn.task.contextVersionAtMaterialization, "ctx-v3");
  assert.equal(normalized.turn.messages[0]?.sender.displayName, "Other AI (planner)");
  assert.equal(normalized.turn.messages[0]?.proposal?.status, ProposalStatus.Rejected);
  assert.equal(normalized.turn.messages[0]?.proposal?.kind, ProposalKind.Whiteboard);
  assert.equal(normalized.turn.messages[0]?.proposal?.baseContextUpdatedAtMs, 88);
  assert.equal(normalized.turn.messages[0]?.proposal?.sourceAnchors[0]?.status, "stale");
  assert.equal(normalized.turn.messages[1]?.sender.displayName, "Lyc");
  assert.equal(normalized.turn.messages[1]?.lifecycle?.excludedFromPromptAtMs, 99);
});

test("agent read materialization rejects sender role", () => {
  const payload: AgentReadMaterializationPayload = {
    protocol: BACKEND_AGENT_PROTOCOL_VERSION,
    ref: refPayload(),
    agent: { id: "8", provider: "fake", model: "m" },
    turn: {
      source: "user_message",
      materialization: materializationPayload(),
      messages: [{
        id: "10",
        sender: { id: "7", kind: "agent", display_label: "Other AI" },
        content: "role confusion",
      }],
    },
  };
  (payload.turn.messages[0]!.sender as Record<string, unknown>).role = "owner";
  assert.throws(() => normalizeAgentReadMaterialization(payload), /message sender must not include role/);
});

test("agent read materialization rejects sender permission fields", () => {
  for (const field of ["owner_id", "admin_id", "permissions", "is_owner"]) {
    const payload: AgentReadMaterializationPayload = {
      protocol: BACKEND_AGENT_PROTOCOL_VERSION,
      ref: refPayload(),
      agent: { id: "8", provider: "fake", model: "m" },
      turn: {
        source: "user_message",
        materialization: materializationPayload(),
        messages: [{
          id: "10",
          sender: { id: "7", kind: "user", display_label: "Human" },
          content: "hello",
        }],
      },
    };
    (payload.turn.messages[0]!.sender as Record<string, unknown>)[field] = "legacy";
    assert.throws(() => normalizeAgentReadMaterialization(payload), new RegExp(`message sender must not include ${field}`));
  }
});
