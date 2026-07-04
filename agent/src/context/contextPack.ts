import type { MessageId, MessageRef, TurnContext } from "../core/agentTypes.ts";
import { compareIds, messageCanEnterPrompt, validateMessageRef } from "../core/agentTypes.ts";

export interface ContextLimits {
  readonly maxMessages: number;
  readonly maxContentBytes: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxMessages: 30,
  maxContentBytes: 12_000,
};

export interface ContextPack {
  readonly contextMessages: readonly MessageRef[];
  readonly triggerMessages: readonly MessageRef[];
  readonly inputMessageIds: readonly MessageId[];
  readonly triggerMessageIds: readonly MessageId[];
  readonly retrievedAnchorMessageIds: readonly MessageId[];
}

export function buildContextPack(turn: TurnContext, limits: ContextLimits = DEFAULT_CONTEXT_LIMITS): ContextPack {
  validateMessageSnapshot(turn.messages);
  if (compareIds(turn.task.processedUntilBefore, turn.task.handledUntilMessageId) > 0) {
    throw new Error("processed_until_before cannot be greater than handled_until_message_id");
  }
  const visible = turn.messages.filter(
    (message) => compareIds(message.id, turn.task.handledUntilMessageId) <= 0 && messageCanEnterPrompt(message),
  );
  const byId = new Map(visible.map((message) => [message.id, message]));

  const requestedAnchorIds = uniqueIds(turn.task.retrievedAnchorMessageIds);
  for (const anchorId of requestedAnchorIds) {
    const message = byId.get(anchorId);
    if (!message) {
      throw new Error(`retrieved anchor message ${anchorId} is missing, beyond handled_until_message_id, or excluded from prompt`);
    }
    if (compareIds(message.id, turn.task.processedUntilBefore) > 0) {
      throw new Error(`retrieved anchor message ${anchorId} is inside the trigger range`);
    }
  }

  const anchorSet = new Set(requestedAnchorIds);
  const triggerMessages = visible.filter(
    (message) => compareIds(message.id, turn.task.processedUntilBefore) > 0,
  );
  const triggerSet = new Set(triggerMessages.map((message) => message.id));
  const anchorMessages = visible.filter((message) => anchorSet.has(message.id));
  const baselineCandidates = visible.filter((message) => !triggerSet.has(message.id) && !anchorSet.has(message.id));
  const baselineMessages = trimBaseline(baselineCandidates, limits);
  const contextSet = new Set([...baselineMessages, ...anchorMessages].map((message) => message.id));
  const contextMessages = visible.filter((message) => contextSet.has(message.id));
  const selectedSet = new Set([...contextMessages, ...triggerMessages].map((message) => message.id));
  const inputMessageIds = visible.filter((message) => selectedSet.has(message.id)).map((message) => message.id);

  return {
    contextMessages,
    triggerMessages,
    inputMessageIds,
    triggerMessageIds: triggerMessages.map((message) => message.id),
    retrievedAnchorMessageIds: anchorMessages.map((message) => message.id),
  };
}

function validateMessageSnapshot(messages: readonly MessageRef[]): void {
  const ids = new Set<MessageId>();
  let previous: MessageId | undefined;
  for (const message of messages) {
    const errors = validateMessageRef(message);
    if (errors.length > 0) {
      throw new Error(`invalid message materialization: ${errors.join("; ")}`);
    }
    if (ids.has(message.id)) {
      throw new Error(`duplicate message id in task snapshot: ${message.id}`);
    }
    if (previous !== undefined && compareIds(previous, message.id) >= 0) {
      throw new Error("task snapshot messages must be in strict original id order");
    }
    ids.add(message.id);
    previous = message.id;
  }
}

function trimBaseline(messages: readonly MessageRef[], limits: ContextLimits): MessageRef[] {
  const selected = messages.slice(-Math.max(0, limits.maxMessages));
  let bytes = selected.reduce((total, message) => total + Buffer.byteLength(message.content, "utf8"), 0);
  while (selected.length > 0 && bytes > limits.maxContentBytes) {
    const removed = selected.shift();
    if (removed) {
      bytes -= Buffer.byteLength(removed.content, "utf8");
    }
  }
  return selected;
}

function uniqueIds(ids: readonly MessageId[]): MessageId[] {
  return [...new Set(ids)];
}
