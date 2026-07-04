import test from "node:test";
import assert from "node:assert/strict";

import { buildProvenancePurgePlan } from "../src/context/provenance.ts";
import { InMemoryAgentStanceHistoryLedger } from "../src/context/stanceHistory.ts";
import { ConversationPhase, ProposalStatus } from "../src/core/agentTypes.ts";

test("security purge follows alternating public-message and private-stance exposure edges", () => {
  const plan = buildProvenancePurgePlan(
    { conversationId: "42", rootMessageId: "100", conservative: true },
    [
      { taskId: "t1", conversationId: "42", inputMessageIds: ["100"], inputStanceRecordIds: [], responseMessageId: "101", stanceRecordId: "s1" },
      { taskId: "t2", conversationId: "42", inputMessageIds: ["101"], inputStanceRecordIds: [], responseMessageId: "102", stanceRecordId: "s2" },
      { taskId: "t3", conversationId: "42", inputMessageIds: ["50"], inputStanceRecordIds: ["s2"], responseMessageId: "103", stanceRecordId: "s3" },
      { taskId: "other", conversationId: "99", inputMessageIds: ["100"], inputStanceRecordIds: [], responseMessageId: "999" },
    ],
    [
      { id: "draft-1", kind: "draft", sourceMessageIds: ["102"] },
      { id: "draft-safe", kind: "draft", sourceMessageIds: ["50"] },
    ],
  );
  assert.deepEqual(plan.affectedTaskIds, ["t1", "t2", "t3"]);
  assert.deepEqual(plan.quarantinedMessageIds, ["100", "101", "102", "103"]);
  assert.deepEqual(plan.excludedStanceRecordIds, ["s1", "s2", "s3"]);
  assert.deepEqual(plan.staleArtifactIds, ["draft-1"]);
});

test("ordinary review reports root exposure but propagates only owner-selected seeds", () => {
  const traces = [
    { taskId: "t1", conversationId: "42", inputMessageIds: ["100"], inputStanceRecordIds: [], responseMessageId: "101", stanceRecordId: "s1" },
    { taskId: "t2", conversationId: "42", inputMessageIds: ["101"], inputStanceRecordIds: [], responseMessageId: "102", stanceRecordId: "s2" },
  ] as const;
  const candidatesOnly = buildProvenancePurgePlan(
    { conversationId: "42", rootMessageId: "100", conservative: false },
    traces,
  );
  assert.deepEqual(candidatesOnly.affectedTaskIds, ["t1"]);
  assert.deepEqual(candidatesOnly.quarantinedMessageIds, ["100"]);
  assert.deepEqual(candidatesOnly.excludedStanceRecordIds, []);

  const selected = buildProvenancePurgePlan(
    {
      conversationId: "42",
      rootMessageId: "100",
      selectedMessageSeedIds: ["101"],
      selectedStanceSeedIds: ["s1"],
      conservative: false,
    },
    traces,
  );
  assert.deepEqual(selected.affectedTaskIds, ["t1", "t2"]);
  assert.deepEqual(selected.quarantinedMessageIds, ["100", "101", "102"]);
  assert.deepEqual(selected.excludedStanceRecordIds, ["s1", "s2"]);
});

test("stance ledger requires committed provenance and proposal governance metadata", () => {
  const ledger = new InMemoryAgentStanceHistoryLedger();
  const rejected = ledger.appendCommitted({
    conversationId: "42",
    agentId: "8",
    taskId: "t1",
    responseMessageId: "101",
    responseKind: "proposal",
    proposalId: "p-missing-digest",
    phaseAtGeneration: ConversationPhase.Divergence,
    processedUntilBefore: "99",
    handledUntilMessageId: "100",
    inputMessageIds: ["100"],
    retrievedAnchorMessageIds: [],
    inputStanceRecordIds: [],
    content: "proposal",
    createdAtMs: 1,
  });
  assert.equal(rejected.ok, false);

  const accepted = ledger.appendCommitted({
    conversationId: "42",
    agentId: "8",
    taskId: "t1",
    responseMessageId: "101",
    responseKind: "proposal",
    proposalId: "p1",
    proposalDigest: "proposal digest",
    phaseAtGeneration: ConversationPhase.Divergence,
    processedUntilBefore: "99",
    handledUntilMessageId: "100",
    inputMessageIds: ["100"],
    retrievedAnchorMessageIds: [],
    inputStanceRecordIds: [],
    content: "proposal",
    createdAtMs: 1,
  });
  assert.equal(accepted.ok, true);
  assert.equal(ledger.appendCommitted({
    conversationId: "42",
    agentId: "8",
    taskId: "t1",
    responseMessageId: "101",
    responseKind: "proposal",
    proposalId: "p1",
    proposalDigest: "proposal digest",
    phaseAtGeneration: ConversationPhase.Divergence,
    processedUntilBefore: "99",
    handledUntilMessageId: "100",
    inputMessageIds: ["100"],
    retrievedAnchorMessageIds: [],
    inputStanceRecordIds: [],
    content: "duplicate",
    createdAtMs: 2,
  }).ok, false);
  assert.equal(ledger.load("42", "8")?.records[0]?.proposalStatus, ProposalStatus.Pending);
  assert.equal(ledger.appendCommitted({
    conversationId: "42",
    agentId: "8",
    taskId: "t1",
    responseMessageId: "102",
    responseKind: "reply",
    phaseAtGeneration: ConversationPhase.Divergence,
    processedUntilBefore: "100",
    handledUntilMessageId: "101",
    inputMessageIds: ["101"],
    retrievedAnchorMessageIds: [],
    inputStanceRecordIds: [],
    content: "conflicting second terminal output",
    createdAtMs: 3,
  }).ok, false);
});
