import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_AGENT_PROTOCOL_VERSION,
  buildBackendRunResultPayload,
  normalizeBackendDispatchRequest,
} from "../src/bridge/backendTransition.ts";
import { InMemoryActorProcessedWaterlineCache, runReadOnlyAgentTurn } from "../src/bridge/atriumAgentBridge.ts";
import { AgentDecision, ConversationPhase, ProposalKind, noReply, propose, reply } from "../src/core/agentTypes.ts";

function refPayload() {
  return {
    task_id: "task-1",
    attempt_no: 1,
    room_id: "1",
    conversation_id: "2",
    ai_id: "8",
  };
}

test("minimal dispatch normalizes wakeup coordinates without a trigger message", () => {
  const normalized = normalizeBackendDispatchRequest({ protocol: BACKEND_AGENT_PROTOCOL_VERSION, ref: refPayload() });
  assert.equal(normalized.ref.taskId, "task-1");
  assert.equal(normalized.ref.attemptNo, 1);
  assert.equal(normalized.ref.conversationId, "2");
  assert.equal(normalized.ref.agentId, "8");
  assert.equal("debugTriggerMessageId" in normalized.ref, false);
});

test("dispatch rejects old prompt-boundary and permission fields", () => {
  for (const field of ["trigger_message_id", "context_until_message_id", "visible_until", "focus_message_ids", "owner_user_id", "admin_id"]) {
    const ref = { ...refPayload() } as Record<string, unknown>;
    ref[field] = "legacy";
    assert.throws(
      () => normalizeBackendDispatchRequest({ protocol: BACKEND_AGENT_PROTOCOL_VERSION, ref: ref as any }),
      new RegExp(`wakeup ref must not include ${field}`),
    );
  }
});

test("backend result contains replay materialization and optional commit intent", () => {
  const payload = buildBackendRunResultPayload({
    response: reply("ok"),
    freshness: { stale: false, reasons: [] },
    materialization: {
      taskId: "task-1",
      attemptNo: 1,
      processedUntilBefore: "8",
      handledUntilMessageId: "12",
      inputMessageIds: ["9", "12"],
      triggerMessageIds: ["12"],
      retrievedAnchorMessageIds: ["9"],
      inputStanceRecordIds: ["s-1"],
      phaseAtGeneration: ConversationPhase.Divergence,
      contextVersionAtGeneration: "ctx-v3",
      contextUpdatedAtMsAtGeneration: 123,
      promptTemplateVersion: "test-template",
    },
    stanceCommit: {
      taskId: "task-1",
      responseKind: AgentDecision.Reply,
      phaseAtGeneration: ConversationPhase.Divergence,
      processedUntilBefore: "8",
      handledUntilMessageId: "12",
      inputMessageIds: ["9", "12"],
      retrievedAnchorMessageIds: ["9"],
      inputStanceRecordIds: ["s-1"],
      content: "ok",
    },
  });
  assert.equal(payload.task_id, "task-1");
  assert.deepEqual(payload.materialization.input_message_ids, ["9", "12"]);
  assert.deepEqual(payload.materialization.trigger_message_ids, ["12"]);
  assert.deepEqual(payload.materialization.retrieved_anchor_message_ids, ["9"]);
  assert.equal(payload.materialization.context_updated_at_ms_at_generation, 123);
  assert.equal(payload.stance_commit?.response_kind, AgentDecision.Reply);
  assert.equal("trigger_message_id" in payload.materialization, false);
});

test("backend result normalizes proposal and synthesis fields to snake_case", () => {
  const proposalDraft = {
    kind: ProposalKind.SynthesisDraft,
    reason: "summarize",
    sourceMessageIds: ["12"],
    synthesis: {
      recommendation: "Proceed.",
      rationale: "Evidence.",
      strongestCounterargument: "Counterpoint.",
      valuableMinorityViews: ["Wait."],
      residualUncertainties: ["Unknown."],
      falsifiablePremises: ["Reversible."],
    },
  } as const;
  const proposal = propose("draft", proposalDraft);
  const payload = buildBackendRunResultPayload({
    response: proposal,
    freshness: { stale: false, reasons: [] },
    materialization: {
      taskId: "task-proposal",
      attemptNo: 1,
      processedUntilBefore: "11",
      handledUntilMessageId: "12",
      inputMessageIds: ["12"],
      triggerMessageIds: ["12"],
      retrievedAnchorMessageIds: [],
      inputStanceRecordIds: [],
      phaseAtGeneration: ConversationPhase.Divergence,
      contextVersionAtGeneration: "ctx-v1",
      contextUpdatedAtMsAtGeneration: 9,
      promptTemplateVersion: "test",
    },
    stanceCommit: {
      taskId: "task-proposal",
      responseKind: AgentDecision.Proposal,
      phaseAtGeneration: ConversationPhase.Divergence,
      processedUntilBefore: "11",
      handledUntilMessageId: "12",
      inputMessageIds: ["12"],
      retrievedAnchorMessageIds: [],
      inputStanceRecordIds: [],
      content: "draft",
      proposal: proposalDraft,
    },
  });
  assert.equal(payload.response.decision, AgentDecision.Proposal);
  if (payload.response.decision === AgentDecision.Proposal) {
    assert.deepEqual(payload.response.proposal.source_message_ids, ["12"]);
    assert.equal(payload.response.proposal.synthesis?.strongest_counterargument, "Counterpoint.");
    assert.equal("sourceMessageIds" in payload.response.proposal, false);
  }
  assert.deepEqual(payload.stance_commit?.proposal?.source_message_ids, ["12"]);
});

test("read materializer cannot change any wakeup coordinate field", async () => {
  const ref = normalizeBackendDispatchRequest({ protocol: BACKEND_AGENT_PROTOCOL_VERSION, ref: refPayload() }).ref;
  await assert.rejects(
    runReadOnlyAgentTurn(
      { runTurnDetailed: async () => { throw new Error("executor must not run"); } },
      {
        materializeTurn: async () => ({
          agent: { id: "8", provider: "fake", model: "m" },
          turn: {
            task: {
              ...ref,
              agentId: "9",
              processedUntilBefore: "10",
              handledUntilMessageId: "12",
              retrievedAnchorMessageIds: [],
              phaseAtMaterialization: ConversationPhase.Divergence,
              contextVersionAtMaterialization: "ctx-v1",
              contextUpdatedAtMsAtMaterialization: 1,
            },
            source: "user_message",
            messages: [],
          },
        }),
      },
      ref,
    ),
    /different immutable task/,
  );
});

test("read materializer can apply same-actor local processed waterline without making it persistent truth", async () => {
  const ref = normalizeBackendDispatchRequest({ protocol: BACKEND_AGENT_PROTOCOL_VERSION, ref: refPayload() }).ref;
  const cache = new InMemoryActorProcessedWaterlineCache();
  cache.rememberProcessedUntil(ref.conversationId, ref.agentId, "11");
  let observedProcessedUntil = "";

  const result = await runReadOnlyAgentTurn(
    {
      runTurnDetailed: async (_agent, turn) => {
        observedProcessedUntil = turn.task.processedUntilBefore;
        return {
          response: noReply(),
          freshness: { stale: false, reasons: [] },
          materialization: {
            taskId: turn.task.taskId,
            attemptNo: turn.task.attemptNo,
            processedUntilBefore: turn.task.processedUntilBefore,
            handledUntilMessageId: turn.task.handledUntilMessageId,
            inputMessageIds: [],
            triggerMessageIds: [],
            retrievedAnchorMessageIds: [],
            inputStanceRecordIds: [],
            phaseAtGeneration: ConversationPhase.Divergence,
            contextVersionAtGeneration: "ctx-v1",
            contextUpdatedAtMsAtGeneration: 1,
            promptTemplateVersion: "test",
          },
        };
      },
    },
    {
      materializeTurn: async () => ({
        agent: { id: "8", provider: "fake", model: "m" },
        turn: {
          task: {
            ...ref,
            processedUntilBefore: "10",
            handledUntilMessageId: "12",
            retrievedAnchorMessageIds: [],
            phaseAtMaterialization: ConversationPhase.Divergence,
            contextVersionAtMaterialization: "ctx-v1",
            contextUpdatedAtMsAtMaterialization: 1,
          },
          source: "user_message",
          messages: [],
        },
      }),
    },
    ref,
    { waterlineCache: cache },
  );

  assert.equal(observedProcessedUntil, "11");
  assert.equal(result.materialization.processedUntilBefore, "11");
  assert.equal(cache.getProcessedUntil(ref.conversationId, ref.agentId), "12");
});

test("local processed waterline rejects materialization older than the same actor cache", async () => {
  const ref = normalizeBackendDispatchRequest({ protocol: BACKEND_AGENT_PROTOCOL_VERSION, ref: refPayload() }).ref;
  const cache = new InMemoryActorProcessedWaterlineCache();
  cache.rememberProcessedUntil(ref.conversationId, ref.agentId, "13");

  await assert.rejects(
    runReadOnlyAgentTurn(
      { runTurnDetailed: async () => { throw new Error("executor must not run"); } },
      {
        materializeTurn: async () => ({
          agent: { id: "8", provider: "fake", model: "m" },
          turn: {
            task: {
              ...ref,
              processedUntilBefore: "10",
              handledUntilMessageId: "12",
              retrievedAnchorMessageIds: [],
              phaseAtMaterialization: ConversationPhase.Divergence,
              contextVersionAtMaterialization: "ctx-v1",
              contextUpdatedAtMsAtMaterialization: 1,
            },
            source: "user_message",
            messages: [],
          },
        }),
      },
      ref,
      { waterlineCache: cache },
    ),
    /behind local actor processed waterline/,
  );
});
