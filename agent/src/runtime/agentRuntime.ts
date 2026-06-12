import type { AgentProfile, AgentResponse, MessageId, MessageRef, TurnContext } from "../core/agentTypes.ts";
import { AgentDecision, ParticipantKind, failed } from "../core/agentTypes.ts";
import { buildContextPack, type ContextPack } from "../context/contextPack.ts";
import type { ConversationContextState, ConversationContextStore, ConversationPhase } from "../context/conversationContext.ts";
import { activeAgentStanceHistoryRecords, type AgentStanceHistoryStore } from "../context/stanceHistory.ts";
import { appendConversationContextToPrompt } from "../prompt/conversationContextPrompt.ts";
import { appendStaticAgentIdentityToPrompt } from "../prompt/agentIdentityPrompt.ts";
import { appendPrivateStanceToPrompt } from "../prompt/stancePrompt.ts";
import { PromptPlan } from "../prompt/promptPlan.ts";
import type { MemoryStore } from "../memory/memoryStore.ts";
import type { ModelGateway, ModelRequest } from "../providers/modelGateway.ts";
import type { ToolRegistry } from "../tools/toolRegistry.ts";

export interface AgentRuntimeDeps {
  modelGateway?: ModelGateway;
  conversationContextStore?: ConversationContextStore;
  stanceHistoryStore?: AgentStanceHistoryStore;
  memoryStore?: MemoryStore;
  toolRegistry?: ToolRegistry;
  recordStanceOnReply?: boolean;
  nowMs?: () => number;
}

export interface AgentRunTurnResult {
  response: AgentResponse;
  phaseAtGeneration?: ConversationPhase;
  contextUntilMessageId: MessageId;
  inputStanceRecordIds: string[];
}

export class AgentRuntime {
  readonly #deps: AgentRuntimeDeps;

  constructor(deps: AgentRuntimeDeps) {
    this.#deps = deps;
  }

  async runTurn(agent: AgentProfile, turn: TurnContext): Promise<AgentResponse> {
    return (await this.runTurnDetailed(agent, turn)).response;
  }

  async runTurnDetailed(agent: AgentProfile, turn: TurnContext): Promise<AgentRunTurnResult> {
    if (!this.#deps.modelGateway) {
      return {
        response: failed("agent runtime missing model gateway"),
        contextUntilMessageId: turn.contextUntilMessageId,
        inputStanceRecordIds: [],
      };
    }

    const contextPack = buildContextPack(turn);
    const promptBuild = await this.buildPromptWithMetadata(agent, turn, contextPack);
    const request: ModelRequest = { agent, prompt: promptBuild.plan, stream: true };

    try {
      const response = await this.#deps.modelGateway.complete(request);
      await this.recordReplyStance(agent, turn, response, promptBuild.phaseAtGeneration, promptBuild.inputStanceRecordIds);
      return buildRunTurnResult(response, turn.contextUntilMessageId, promptBuild);
    } catch (error) {
      const response = failed(error instanceof Error ? error.message : String(error));
      return buildRunTurnResult(response, turn.contextUntilMessageId, promptBuild);
    }
  }

  async buildPrompt(agent: AgentProfile, turn: TurnContext, contextPack: ContextPack): Promise<PromptPlan> {
    return (await this.buildPromptWithMetadata(agent, turn, contextPack)).plan;
  }

  private async buildPromptWithMetadata(agent: AgentProfile, turn: TurnContext, contextPack: ContextPack): Promise<BuiltPrompt> {
    const plan = new PromptPlan();
    appendStaticAgentIdentityToPrompt(plan, agent);

    const contextState = this.#deps.conversationContextStore
      ? await this.#deps.conversationContextStore.load(turn.conversationId)
      : undefined;
    if (this.#deps.conversationContextStore) {
      if (contextState) {
        appendConversationContextToPrompt(plan, contextState);
      }
    }

    const split = splitCurrentTriggerMessage(contextPack.messages(), turn.triggerMessageId);

    for (const message of split.recentMessages) {
      const speaker = speakerLabel(message, agent, turn);
      if (isCurrentAgentMessage(message, agent)) {
        plan.addAssistant(speaker, message.content);
      } else {
        plan.addUser(speaker, message.content);
      }
    }

    const stanceHistory = this.#deps.stanceHistoryStore
      ? await this.#deps.stanceHistoryStore.load(turn.conversationId, agent.id)
      : undefined;
    const inputStanceRecordIds = activeAgentStanceHistoryRecords(stanceHistory).map((record) => record.id);
    appendPrivateStanceToPrompt(plan, agent, contextState, stanceHistory);

    if (split.currentMessage) {
      const speaker = speakerLabel(split.currentMessage, agent, turn);
      if (isCurrentAgentMessage(split.currentMessage, agent)) {
        plan.addAssistant(speaker, split.currentMessage.content);
      } else {
        plan.addUser(speaker, split.currentMessage.content);
      }
    }

    return {
      plan,
      ...(contextState?.phase ? { phaseAtGeneration: contextState.phase } : {}),
      inputStanceRecordIds,
    };
  }

  private async recordReplyStance(
    agent: AgentProfile,
    turn: TurnContext,
    response: AgentResponse,
    phaseAtGeneration: ConversationPhase | undefined,
    inputStanceRecordIds: string[],
  ): Promise<void> {
    if (
      this.#deps.recordStanceOnReply === false ||
      !this.#deps.stanceHistoryStore ||
      response.decision !== AgentDecision.Reply ||
      response.content.length === 0
    ) {
      return;
    }

    await this.#deps.stanceHistoryStore.append({
      conversationId: turn.conversationId,
      agentId: agent.id,
      triggerMessageId: turn.triggerMessageId,
      ...(phaseAtGeneration ? { phaseAtGeneration } : {}),
      contextUntilMessageId: turn.contextUntilMessageId,
      inputStanceRecordIds,
      content: response.content,
      createdAtMs: this.#deps.nowMs?.() ?? Date.now(),
    });
  }
}

interface BuiltPrompt {
  plan: PromptPlan;
  phaseAtGeneration?: ConversationContextState["phase"];
  inputStanceRecordIds: string[];
}

function buildRunTurnResult(
  response: AgentResponse,
  contextUntilMessageId: MessageId,
  promptBuild: BuiltPrompt,
): AgentRunTurnResult {
  return {
    response,
    ...(promptBuild.phaseAtGeneration ? { phaseAtGeneration: promptBuild.phaseAtGeneration } : {}),
    contextUntilMessageId,
    inputStanceRecordIds: promptBuild.inputStanceRecordIds,
  };
}

function isCurrentAgentMessage(message: MessageRef, agent: AgentProfile): boolean {
  return message.sender.kind === ParticipantKind.Agent && message.sender.id === agent.id;
}

function speakerLabel(message: MessageRef, agent: AgentProfile, turn: TurnContext): string {
  const sender = message.sender;
  if (isCurrentAgentMessage(message, agent)) {
    return `Current AI member #${sender.id} (${sender.displayName})`;
  }
  if (sender.kind === ParticipantKind.Agent) {
    return `AI member #${sender.id} (${sender.displayName})`;
  }
  if (sender.kind === ParticipantKind.User) {
    if (sender.id === turn.ownerUserId) {
      return `Owner human #${sender.id} (${sender.displayName})`;
    }
    return `Human member #${sender.id} (${sender.displayName})`;
  }
  return `System event #${sender.id} (${sender.displayName})`;
}

function splitCurrentTriggerMessage(
  messages: readonly MessageRef[],
  triggerMessageId: string,
): { recentMessages: MessageRef[]; currentMessage: MessageRef | undefined } {
  const triggerIndex = messages.findLastIndex((message) => message.id === triggerMessageId);
  if (triggerIndex === -1) {
    return { recentMessages: [...messages], currentMessage: undefined };
  }

  return {
    recentMessages: messages.filter((_message, index) => index !== triggerIndex),
    currentMessage: messages[triggerIndex],
  };
}
