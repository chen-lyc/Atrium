import type { AgentProfile, AgentResponse, MessageRef, TurnContext } from "../core/agentTypes.ts";
import { AgentDecision, failed } from "../core/agentTypes.ts";
import { buildContextPack, type ContextPack } from "../context/contextPack.ts";
import type { ConversationContextStore } from "../context/conversationContext.ts";
import type { AgentStanceHistoryStore } from "../context/stanceHistory.ts";
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
  nowMs?: () => number;
}

export class AgentRuntime {
  readonly #deps: AgentRuntimeDeps;

  constructor(deps: AgentRuntimeDeps) {
    this.#deps = deps;
  }

  async runTurn(agent: AgentProfile, turn: TurnContext): Promise<AgentResponse> {
    if (!this.#deps.modelGateway) {
      return failed("agent runtime missing model gateway");
    }

    const contextPack = buildContextPack(turn);
    const prompt = await this.buildPrompt(agent, turn, contextPack);
    const request: ModelRequest = { agent, prompt, stream: true };

    try {
      const response = await this.#deps.modelGateway.complete(request);
      await this.recordReplyStance(agent, turn, response);
      return response;
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
  }

  async buildPrompt(agent: AgentProfile, turn: TurnContext, contextPack: ContextPack): Promise<PromptPlan> {
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
      if (message.sender.id === agent.id) {
        plan.addAssistant(message.sender.displayName, message.content);
      } else {
        plan.addUser(message.sender.displayName, message.content);
      }
    }

    const stanceHistory = this.#deps.stanceHistoryStore
      ? await this.#deps.stanceHistoryStore.load(turn.conversationId, agent.id)
      : undefined;
    appendPrivateStanceToPrompt(plan, agent, contextState, stanceHistory);

    if (split.currentMessage) {
      if (split.currentMessage.sender.id === agent.id) {
        plan.addAssistant(split.currentMessage.sender.displayName, split.currentMessage.content);
      } else {
        plan.addUser(split.currentMessage.sender.displayName, split.currentMessage.content);
      }
    }

    return plan;
  }

  private async recordReplyStance(agent: AgentProfile, turn: TurnContext, response: AgentResponse): Promise<void> {
    if (!this.#deps.stanceHistoryStore || response.decision !== AgentDecision.Reply || response.content.length === 0) {
      return;
    }

    await this.#deps.stanceHistoryStore.append({
      conversationId: turn.conversationId,
      agentId: agent.id,
      triggerMessageId: turn.triggerMessageId,
      content: response.content,
      createdAtMs: this.#deps.nowMs?.() ?? Date.now(),
    });
  }
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
