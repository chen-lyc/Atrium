import type { MessageRef, TurnContext } from "../core/agentTypes.ts";

export interface ContextLimits {
  maxMessages: number;
  maxContentBytes: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxMessages: 30,
  maxContentBytes: 12_000,
};

export class ContextPack {
  readonly #limits: ContextLimits;
  readonly #messages: MessageRef[] = [];

  constructor(limits: ContextLimits = DEFAULT_CONTEXT_LIMITS) {
    this.#limits = limits;
  }

  add(message: MessageRef): void {
    this.#messages.push(message);
  }

  trimToLimits(): void {
    while (this.#messages.length > this.#limits.maxMessages) {
      this.#messages.shift();
    }

    while (this.#messages.length > 0 && this.contentBytes() > this.#limits.maxContentBytes) {
      this.#messages.shift();
    }
  }

  messages(): readonly MessageRef[] {
    return this.#messages;
  }

  empty(): boolean {
    return this.#messages.length === 0;
  }

  private contentBytes(): number {
    return this.#messages.reduce((total, message) => total + Buffer.byteLength(message.content, "utf8"), 0);
  }
}

export function buildContextPack(turn: TurnContext, limits: ContextLimits = DEFAULT_CONTEXT_LIMITS): ContextPack {
  const pack = new ContextPack(limits);
  for (const message of turn.messages) {
    pack.add(message);
  }
  pack.trimToLimits();
  return pack;
}

