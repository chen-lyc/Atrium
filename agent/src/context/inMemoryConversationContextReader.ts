import type { ConversationId } from "../core/agentTypes.ts";
import type { ConversationContextReader, ConversationContextState } from "./conversationContext.ts";

/** Immutable fixture/read adapter. Production writes remain backend-owned. */
export class InMemoryConversationContextReader implements ConversationContextReader {
  readonly #states: ReadonlyMap<ConversationId, ConversationContextState>;

  constructor(states: readonly ConversationContextState[] = []) {
    this.#states = new Map(states.map((state) => [state.conversationId, structuredClone(state)]));
  }

  load(conversationId: ConversationId): ConversationContextState | undefined {
    const state = this.#states.get(conversationId);
    return state ? structuredClone(state) : undefined;
  }
}
