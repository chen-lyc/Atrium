import test from "node:test";
import assert from "node:assert/strict";

import { BACKEND_AGENT_PROTOCOL_VERSION, normalizeBackendRunRequest } from "../src/bridge/backendTransition.ts";
import { ThinkingAdapter } from "../src/core/agentTypes.ts";

test("backend transition normalizes snake_case payloads and numeric ids", () => {
  const normalized = normalizeBackendRunRequest({
    protocol: BACKEND_AGENT_PROTOCOL_VERSION,
    ref: {
      room_id: 1,
      conversation_id: "2",
      trigger_message_id: 3n,
      context_until_message_id: "4",
      user_id: 5,
      owner_user_id: "6",
      phase_at_dispatch: "divergence",
      context_updated_at_ms_at_dispatch: "1000",
    },
    agent: {
      id: "8",
      provider: "fake",
      model: "fake-model",
      display_name: "Architect",
      thinking_adapter: "counterexample",
    },
    turn: {
      room_id: 1,
      conversation_id: "2",
      trigger_message_id: 3n,
      context_until_message_id: "4",
      user_id: 5,
      owner_user_id: "6",
      phase_at_dispatch: "divergence",
      context_updated_at_ms_at_dispatch: 1000,
      source: "user_message",
      messages: [
        {
          id: "3",
          sender: {
            id: "5",
            kind: "user",
            display_name: "User",
          },
          content: "Move the agent out of backend src/include.",
        },
      ],
    },
  });

  assert.equal(normalized.ref.triggerMessageId, "3");
  assert.equal(normalized.ref.ownerUserId, "6");
  assert.equal(normalized.ref.phaseAtDispatch, "divergence");
  assert.equal(normalized.ref.contextUpdatedAtMsAtDispatch, 1000);
  assert.equal(normalized.agent.displayName, "Architect");
  assert.equal(normalized.agent.thinkingAdapter, ThinkingAdapter.Counterexample);
  assert.equal(normalized.turn.ownerUserId, "6");
  assert.equal(normalized.turn.phaseAtDispatch, "divergence");
  assert.equal(normalized.turn.contextUpdatedAtMsAtDispatch, 1000);
  assert.equal(normalized.turn.messages[0]?.sender.displayName, "User");
});
