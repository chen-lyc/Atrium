import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_AGENT_PROTOCOL_VERSION,
  buildBackendRunResultPayload,
  normalizeBackendDispatchRequest,
  normalizeBackendRunRequest,
} from "../src/bridge/backendTransition.ts";
import { reply } from "../src/core/agentTypes.ts";
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

test("backend transition accepts minimal dispatch payload for read-only agent materialization", () => {
  const normalized = normalizeBackendDispatchRequest({
    protocol: BACKEND_AGENT_PROTOCOL_VERSION,
    ref: {
      request_id: "run-123",
      room_id: "1",
      conversation_id: "2",
      ai_id: "8",
      trigger_message_id: "3",
      context_until_message_id: "3",
      phase_at_dispatch: "divergence",
      context_updated_at_ms_at_dispatch: "1000",
    },
  });

  assert.equal(normalized.ref.requestId, "run-123");
  assert.equal(normalized.ref.roomId, "1");
  assert.equal(normalized.ref.conversationId, "2");
  assert.equal(normalized.ref.agentId, "8");
  assert.equal(normalized.ref.triggerMessageId, "3");
  assert.equal(normalized.ref.contextUntilMessageId, "3");
  assert.equal(normalized.ref.phaseAtDispatch, "divergence");
  assert.equal(normalized.ref.contextUpdatedAtMsAtDispatch, 1000);
  assert.equal(normalized.ref.userId, undefined);
  assert.equal(normalized.ref.ownerUserId, undefined);
});

test("backend transition does not require current agent display name", () => {
  const normalized = normalizeBackendRunRequest({
    protocol: BACKEND_AGENT_PROTOCOL_VERSION,
    ref: {
      room_id: "1",
      conversation_id: "2",
      trigger_message_id: "3",
      context_until_message_id: "3",
      user_id: "5",
      owner_user_id: "6",
    },
    agent: {
      id: "8",
      provider: "fake",
      model: "fake-model",
      thinking_adapter: "counterexample",
    },
    turn: {
      room_id: "1",
      conversation_id: "2",
      trigger_message_id: "3",
      context_until_message_id: "3",
      user_id: "5",
      owner_user_id: "6",
      source: "user_message",
      messages: [
        {
          id: "3",
          sender: {
            id: "5",
            kind: "user",
            display_name: "User",
          },
          content: "Use the DB-backed read path.",
        },
      ],
    },
  });

  assert.equal(normalized.agent.id, "8");
  assert.equal(normalized.agent.displayName, undefined);
  assert.equal(normalized.agent.thinkingAdapter, ThinkingAdapter.Counterexample);
});

test("backend result payload omits agent profile and carries generation metadata", () => {
  const payload = buildBackendRunResultPayload(
    {
      requestId: "run-123",
      roomId: "1",
      conversationId: "2",
      agentId: "8",
      triggerMessageId: "3",
      contextUntilMessageId: "3",
    },
    {
      response: reply("ok"),
      phaseAtGeneration: "divergence",
      contextUntilMessageId: "3",
      inputStanceRecordIds: ["stance_2_8_1"],
    },
  );

  assert.equal(payload.protocol, BACKEND_AGENT_PROTOCOL_VERSION);
  assert.equal(payload.ref.agentId, "8");
  assert.equal(payload.response.content, "ok");
  assert.equal(payload.phase_at_generation, "divergence");
  assert.equal(payload.context_until_message_id, "3");
  assert.deepEqual(payload.input_stance_record_ids, ["stance_2_8_1"]);
  assert.equal("agent" in payload, false);
});
