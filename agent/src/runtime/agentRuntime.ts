import type { AgentProfile, AgentResponse, AgentTaskSnapshot, TurnContext } from "../core/agentTypes.ts";
import {
  AgentDecision,
  ConversationPhase,
  ThinkingAdapter,
  failed,
  isZeroId,
  superseded,
} from "../core/agentTypes.ts";
import { buildContextPack, type ContextLimits, DEFAULT_CONTEXT_LIMITS } from "../context/contextPack.ts";
import type { ConversationContextReader, ConversationContextState } from "../context/conversationContext.ts";
import { validateConfirmedConversationContext } from "../context/conversationContext.ts";
import type { AgentStanceHistoryReader } from "../context/stanceHistory.ts";
import { selectPrivateStanceRecords, validateMaterializedStanceHistory } from "../context/stanceHistory.ts";
import type { StanceCommitIntent, TaskFreshness, TaskMaterializationRecord } from "../context/taskMaterialization.ts";
import { taskFreshness } from "../context/taskMaterialization.ts";
import { appendStaticAgentIdentityToPrompt, PROMPT_TEMPLATE_VERSION } from "../prompt/agentIdentityPrompt.ts";
import { appendConversationContextToPrompt } from "../prompt/conversationContextPrompt.ts";
import { appendMessagesToPrompt, validatePromptSpeakerLabels } from "../prompt/messagePrompt.ts";
import { PromptPlan, PromptSegment } from "../prompt/promptPlan.ts";
import type { PromptGuardrails } from "../prompt/stancePrompt.ts";
import { appendPrivateStanceToPrompt, DEFAULT_PROMPT_GUARDRAILS } from "../prompt/stancePrompt.ts";
import type { ModelGateway, ModelRequest } from "../providers/modelGateway.ts";

export interface AgentRuntimeDeps {
  readonly modelGateway: ModelGateway;
  readonly conversationContextReader: ConversationContextReader;
  readonly stanceHistoryReader: AgentStanceHistoryReader;
  readonly contextLimits?: ContextLimits;
  readonly promptGuardrails?: PromptGuardrails;
  readonly maxPrivateStanceRecords?: number;
}

export interface AgentRunTurnResult {
  readonly response: AgentResponse;
  readonly freshness: TaskFreshness;
  readonly materialization: TaskMaterializationRecord;
  readonly stanceCommit?: StanceCommitIntent;
}

interface BuiltPrompt {
  readonly plan: PromptPlan;
  readonly contextState: ConversationContextState;
  readonly materialization: TaskMaterializationRecord;
}

export class AgentRuntime {
  readonly #deps: AgentRuntimeDeps;
  readonly #taskFingerprints = new Map<string, string>();
  readonly #attemptResults = new Map<string, AgentRunTurnResult>();

  constructor(deps: AgentRuntimeDeps) {
    this.#deps = deps;
  }

  async runTurn(agent: AgentProfile, turn: TurnContext): Promise<AgentResponse> {
    return (await this.runTurnDetailed(agent, turn)).response;
  }

  async runTurnDetailed(agent: AgentProfile, turn: TurnContext): Promise<AgentRunTurnResult> {
    const validationError = validateTask(agent, turn.task);
    if (validationError) {
      return this.failureResult(turn.task, validationError);
    }
    const fingerprint = taskFingerprint(agent, turn.task);
    const previousFingerprint = this.#taskFingerprints.get(turn.task.taskId);
    if (previousFingerprint && previousFingerprint !== fingerprint) {
      return this.failureResult(turn.task, "immutable task fields changed for an existing task_id");
    }
    this.#taskFingerprints.set(turn.task.taskId, fingerprint);

    const attemptKey = `${turn.task.taskId}:${turn.task.attemptNo}`;
    const cached = this.#attemptResults.get(attemptKey);
    if (cached) {
      return structuredClone(cached);
    }

    try {
      const built = await this.buildPromptWithMetadata(agent, turn);
      const before = taskFreshness(
        turn.task.phaseAtMaterialization,
        turn.task.contextVersionAtMaterialization,
        built.contextState.phase,
        built.contextState.contextVersion,
      );
      if (before.stale) {
        const result = {
          response: superseded("task snapshot was stale before generation"),
          freshness: before,
          materialization: emptyMaterialization(turn.task),
        };
        this.#attemptResults.set(attemptKey, result);
        return structuredClone(result);
      }

      const request: ModelRequest = { agent, prompt: built.plan, stream: true };
      const generated = normalizeGeneratedResponse(await this.#deps.modelGateway.complete(request), built.materialization.inputMessageIds);
      const latestContext = await this.#deps.conversationContextReader.load(turn.task.conversationId);
      if (!latestContext) {
        return this.cacheResult(attemptKey, {
          response: failed("conversation context disappeared during generation"),
          freshness: { stale: true, reasons: ["context_changed"] },
          materialization: built.materialization,
        });
      }
      const after = taskFreshness(
        built.contextState.phase,
        built.contextState.contextVersion,
        latestContext.phase,
        latestContext.contextVersion,
      );
      if (after.stale && generated.decision === AgentDecision.Proposal) {
        return this.cacheResult(attemptKey, {
          response: superseded("stale task cannot submit a proposal"),
          freshness: after,
          materialization: built.materialization,
        });
      }

      const result: AgentRunTurnResult = {
        response: generated,
        freshness: after,
        materialization: built.materialization,
        ...(!after.stale && (generated.decision === AgentDecision.Reply || generated.decision === AgentDecision.Proposal)
          ? { stanceCommit: buildStanceCommit(generated, built.materialization) }
          : {}),
      };
      return this.cacheResult(attemptKey, result);
    } catch (error) {
      return this.cacheResult(attemptKey, this.failureResult(turn.task, error instanceof Error ? error.message : String(error)));
    }
  }

  async buildPrompt(agent: AgentProfile, turn: TurnContext): Promise<PromptPlan> {
    const validationError = validateTask(agent, turn.task);
    if (validationError) {
      throw new Error(validationError);
    }
    const built = await this.buildPromptWithMetadata(agent, turn);
    const freshness = taskFreshness(
      turn.task.phaseAtMaterialization,
      turn.task.contextVersionAtMaterialization,
      built.contextState.phase,
      built.contextState.contextVersion,
    );
    if (freshness.stale) {
      throw new Error(`cannot build provider prompt from stale task: ${freshness.reasons.join(",")}`);
    }
    return built.plan;
  }

  private async buildPromptWithMetadata(agent: AgentProfile, turn: TurnContext): Promise<BuiltPrompt> {
    const contextState = await this.#deps.conversationContextReader.load(turn.task.conversationId);
    if (!contextState) {
      throw new Error("conversation context is required for every agent task");
    }
    if (contextState.conversationId !== turn.task.conversationId) {
      throw new Error("conversation context reader crossed conversation boundary");
    }
    const contextErrors = validateConfirmedConversationContext(contextState);
    if (contextErrors.length > 0) {
      throw new Error(`invalid confirmed whiteboard: ${contextErrors.join("; ")}`);
    }

    const pack = buildContextPack(turn, this.#deps.contextLimits ?? DEFAULT_CONTEXT_LIMITS);
    const history = await this.#deps.stanceHistoryReader.load(turn.task.conversationId, agent.id);
    if (history && (history.conversationId !== turn.task.conversationId || history.agentId !== agent.id)) {
      throw new Error("private stance reader crossed conversation or AI boundary");
    }
    const stanceErrors = validateMaterializedStanceHistory(history);
    if (stanceErrors.length > 0) {
      throw new Error(`invalid private stance projection: ${stanceErrors.join("; ")}`);
    }
    const selectedMessageIds = new Set(pack.inputMessageIds);
    validatePromptSpeakerLabels([...pack.contextMessages, ...pack.triggerMessages], agent);
    const stanceRecords = selectPrivateStanceRecords(
      history,
      selectedMessageIds,
      this.#deps.maxPrivateStanceRecords ?? 6,
    );

    const plan = new PromptPlan();
    appendStaticAgentIdentityToPrompt(plan, agent);
    appendConversationContextToPrompt(plan, contextState);
    appendMessagesToPrompt(plan, PromptSegment.ContextMessages, pack.contextMessages, agent);
    appendPrivateStanceToPrompt(
      plan,
      agent,
      contextState,
      stanceRecords,
      this.#deps.promptGuardrails ?? DEFAULT_PROMPT_GUARDRAILS,
    );
    appendMessagesToPrompt(plan, PromptSegment.TriggerMessages, pack.triggerMessages, agent);

    return {
      plan,
      contextState,
      materialization: {
        taskId: turn.task.taskId,
        attemptNo: turn.task.attemptNo,
        processedUntilBefore: turn.task.processedUntilBefore,
        handledUntilMessageId: turn.task.handledUntilMessageId,
        inputMessageIds: pack.inputMessageIds,
        triggerMessageIds: pack.triggerMessageIds,
        retrievedAnchorMessageIds: pack.retrievedAnchorMessageIds,
        inputStanceRecordIds: stanceRecords.map((record) => record.id),
        phaseAtGeneration: contextState.phase,
        contextVersionAtGeneration: contextState.contextVersion,
        contextUpdatedAtMsAtGeneration: contextState.updatedAtMs,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
      },
    };
  }

  private failureResult(task: AgentTaskSnapshot, error: string): AgentRunTurnResult {
    return {
      response: failed(error),
      freshness: { stale: false, reasons: [] },
      materialization: emptyMaterialization(task),
    };
  }

  private cacheResult(key: string, result: AgentRunTurnResult): AgentRunTurnResult {
    this.#attemptResults.set(key, structuredClone(result));
    return result;
  }
}

function validateTask(agent: AgentProfile, task: AgentTaskSnapshot): string | undefined {
  if (!agent.provider.trim() || !agent.model.trim()) {
    return "agent profile requires provider and model";
  }
  if (agent.thinkingAdapter === ThinkingAdapter.Custom && !agent.customThinkingInstruction?.trim()) {
    return "custom thinking adapter requires a custom instruction";
  }
  if (isZeroId(agent.id)
    || isZeroId(task.taskId)
    || isZeroId(task.roomId)
    || isZeroId(task.conversationId)
    || isZeroId(task.agentId)
    || isZeroId(task.handledUntilMessageId)) {
    return "agent task missing required identifiers";
  }
  if (task.agentId !== agent.id) {
    return "task ai_id does not match current agent";
  }
  if (!Number.isInteger(task.attemptNo) || task.attemptNo < 1) {
    return "attempt_no must be a positive integer";
  }
  if (!task.phaseAtMaterialization || !task.contextVersionAtMaterialization) {
    return "agent task missing phase/context materialization watermark";
  }
  if (!Object.values(ConversationPhase).includes(task.phaseAtMaterialization)) {
    return "agent task has unsupported phase_at_materialization";
  }
  if (!Number.isSafeInteger(task.contextUpdatedAtMsAtMaterialization) || task.contextUpdatedAtMsAtMaterialization < 0) {
    return "agent task has invalid context_updated_at_ms_at_materialization";
  }
  if (new Set(task.retrievedAnchorMessageIds).size !== task.retrievedAnchorMessageIds.length) {
    return "retrieved_anchor_message_ids must be unique";
  }
  return undefined;
}

function normalizeGeneratedResponse(response: AgentResponse, inputMessageIds: readonly string[]): AgentResponse {
  if (response.decision === AgentDecision.Reply && response.content.trim().length === 0) {
    return failed("reply result must contain visible content");
  }
  if (response.decision === AgentDecision.Proposal) {
    if (response.content.trim().length === 0 || response.proposal.reason.trim().length === 0) {
      return failed("proposal result requires content and a short reason");
    }
    const inputs = new Set(inputMessageIds);
    if (response.proposal.sourceMessageIds.length === 0
      || new Set(response.proposal.sourceMessageIds).size !== response.proposal.sourceMessageIds.length
      || response.proposal.sourceMessageIds.some((id) => !inputs.has(id))) {
      return failed("proposal source anchors must be non-empty and come from actual prompt messages");
    }
    if (response.proposal.kind === "synthesis_draft") {
      const synthesis = response.proposal.synthesis;
      if (!synthesis
        || !synthesis.recommendation.trim()
        || !synthesis.rationale.trim()
        || !synthesis.strongestCounterargument.trim()
        || !nonEmptyStrings(synthesis.valuableMinorityViews)
        || !nonEmptyStrings(synthesis.residualUncertainties)
        || !nonEmptyStrings(synthesis.falsifiablePremises)) {
        return failed("synthesis proposal requires recommendation, rationale, strongest counterargument, minority views, uncertainties, and falsifiable premises");
      }
    } else if (response.proposal.synthesis) {
      return failed("only synthesis_draft proposal may carry synthesis fields");
    }
  }
  return response;
}

function nonEmptyStrings(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().length > 0);
}

function buildStanceCommit(response: AgentResponse, materialization: TaskMaterializationRecord): StanceCommitIntent {
  if (response.decision !== AgentDecision.Reply && response.decision !== AgentDecision.Proposal) {
    throw new Error("only visible reply/proposal can produce a stance commit intent");
  }
  return {
    taskId: materialization.taskId,
    responseKind: response.decision,
    phaseAtGeneration: materialization.phaseAtGeneration,
    processedUntilBefore: materialization.processedUntilBefore,
    handledUntilMessageId: materialization.handledUntilMessageId,
    inputMessageIds: materialization.inputMessageIds,
    retrievedAnchorMessageIds: materialization.retrievedAnchorMessageIds,
    inputStanceRecordIds: materialization.inputStanceRecordIds,
    content: response.content,
    ...(response.decision === AgentDecision.Proposal ? { proposal: response.proposal } : {}),
  };
}

function taskFingerprint(agent: AgentProfile, task: AgentTaskSnapshot): string {
  return JSON.stringify({
    taskId: task.taskId,
    roomId: task.roomId,
    conversationId: task.conversationId,
    agentId: task.agentId,
    processedUntilBefore: task.processedUntilBefore,
    handledUntilMessageId: task.handledUntilMessageId,
    retrievedAnchorMessageIds: [...task.retrievedAnchorMessageIds],
    phaseAtMaterialization: task.phaseAtMaterialization,
    contextVersionAtMaterialization: task.contextVersionAtMaterialization,
    contextUpdatedAtMsAtMaterialization: task.contextUpdatedAtMsAtMaterialization,
    agentProvider: agent.provider,
    agentModel: agent.model,
    agentDisplayName: agent.displayName ?? null,
    agentThinkingAdapter: agent.thinkingAdapter ?? null,
    agentCustomThinkingInstruction: agent.customThinkingInstruction ?? null,
  });
}

function emptyMaterialization(task: AgentTaskSnapshot): TaskMaterializationRecord {
  return {
    taskId: task.taskId,
    attemptNo: task.attemptNo,
    processedUntilBefore: task.processedUntilBefore,
    handledUntilMessageId: task.handledUntilMessageId,
    inputMessageIds: [],
    triggerMessageIds: [],
    retrievedAnchorMessageIds: [],
    inputStanceRecordIds: [],
    phaseAtGeneration: task.phaseAtMaterialization,
    contextVersionAtGeneration: task.contextVersionAtMaterialization,
    contextUpdatedAtMsAtGeneration: task.contextUpdatedAtMsAtMaterialization,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
  };
}
