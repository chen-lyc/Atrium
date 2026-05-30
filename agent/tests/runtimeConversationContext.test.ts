import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentDecision,
  ParticipantKind,
  ThinkingAdapter,
  TurnSource,
  reply,
  type AgentProfile,
  type AgentResponse,
} from "../src/core/agentTypes.ts";
import {
  ConversationContextEntryKind,
  ConversationContextEntryStatus,
  ConversationPhase,
  createConversationContextState,
} from "../src/context/conversationContext.ts";
import { InMemoryConversationContextStore } from "../src/context/inMemoryConversationContextStore.ts";
import { InMemoryAgentStanceHistoryStore } from "../src/context/stanceHistory.ts";
import type { ModelGateway, ModelRequest } from "../src/providers/modelGateway.ts";
import { AgentRuntime } from "../src/runtime/agentRuntime.ts";

class CapturingModelGateway implements ModelGateway {
  request?: ModelRequest;

  complete(request: ModelRequest): AgentResponse {
    this.request = request;
    return reply("ok");
  }
}

test("runtime assembles Atrium double-axis prompt before current trigger message", async () => {
  const contextStore = new InMemoryConversationContextStore();
  const state = createConversationContextState("99");
  state.phase = ConversationPhase.Divergence;
  state.entries.push({
    id: "ctx_99_1",
    kind: ConversationContextEntryKind.Goal,
    status: ConversationContextEntryStatus.Active,
    content: "Decide where the transition interface should live.",
    sources: [],
    priority: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
  });
  contextStore.save(state);

  const stanceStore = new InMemoryAgentStanceHistoryStore();
  stanceStore.append({
    conversationId: "99",
    agentId: "8",
    triggerMessageId: "9",
    content: "I warned that direct backend coupling would erase the agent boundary.",
    createdAtMs: 2,
  });
  stanceStore.append({
    conversationId: "99",
    agentId: "9",
    triggerMessageId: "9",
    content: "Other AI wanted a quicker backend patch.",
    createdAtMs: 2,
  });

  const gateway = new CapturingModelGateway();
  const runtime = new AgentRuntime({
    modelGateway: gateway,
    conversationContextStore: contextStore,
    stanceHistoryStore: stanceStore,
    nowMs: () => 3000,
  });
  const agent: AgentProfile = {
    id: "8",
    provider: "fake",
    model: "fake-model",
    displayName: "Test Agent",
    thinkingAdapter: ThinkingAdapter.Counterexample,
  };

  const response = await runtime.runTurn(agent, {
    roomId: "1",
    conversationId: "99",
    userId: "2",
    triggerMessageId: "10",
    contextUntilMessageId: "10",
    source: TurnSource.UserMessage,
    messages: [
      {
        id: "9",
        sender: { id: "2", kind: ParticipantKind.User, displayName: "User" },
        content: "Earlier we considered putting transition logic near the reactor.",
      },
      {
        id: "10",
        sender: { id: "2", kind: ParticipantKind.User, displayName: "User" },
        content: "Where should the transition interface live?",
      },
    ],
  });

  assert.equal(response.decision, AgentDecision.Reply);
  const fragments = gateway.request?.prompt.fragments() ?? [];
  assert.equal(fragments[0]?.name, "agent-runtime");
  assert.equal(fragments[1]?.name, "agent-model");
  assert.equal(fragments[2]?.name, "agent-static-thinking");
  assert.match(fragments[0]?.content ?? "", /adapter is a cognitive tendency/);
  assert.match(fragments[2]?.content ?? "", /Baseline thinking adapter/);
  assert.equal(fragments[3]?.name, "conversation-context");
  assert.match(fragments[3]?.content ?? "", /transition interface/);
  const recentIndex = fragments.findIndex((fragment) => fragment.content.includes("Earlier we considered"));
  const stanceIndex = fragments.findIndex((fragment) => fragment.name === "agent-private-stance");
  const currentIndex = fragments.findIndex((fragment) => fragment.content.includes("Where should the transition interface live?"));
  assert.ok(recentIndex > 3);
  assert.ok(stanceIndex > recentIndex);
  assert.ok(currentIndex > stanceIndex);
  assert.match(fragments[stanceIndex]?.content ?? "", /I warned that direct backend coupling/);
  assert.doesNotMatch(fragments[stanceIndex]?.content ?? "", /Other AI wanted/);
  assert.match(fragments[stanceIndex]?.content ?? "", /<NO_REPLY> remains valid/);
  assert.match(fragments[stanceIndex]?.content ?? "", /If a reply is warranted/);
  assert.match(fragments[stanceIndex]?.content ?? "", /Do not turn it into a persona/);
  assert.match(fragments[stanceIndex]?.content ?? "", /failure scenario/);
  assert.equal(fragments.at(-1)?.role, "user");

  const updatedHistory = stanceStore.load("99", "8");
  assert.equal(updatedHistory?.records.length, 2);
  assert.equal(updatedHistory?.records.at(-1)?.content, "ok");
});
