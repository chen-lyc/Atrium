import type { ConversationContextState, ConversationContextStore, ConversationContextWriteResult } from "./conversationContext.ts";
import { contextWriteFailure, contextWriteSuccess } from "./conversationContext.ts";
import type { ConversationId } from "../core/agentTypes.ts";
import { isZeroId } from "../core/agentTypes.ts";

export class InMemoryConversationContextStore implements ConversationContextStore {
  readonly #states = new Map<ConversationId, ConversationContextState>();

  load(conversationId: ConversationId): ConversationContextState | undefined {
    const state = this.#states.get(conversationId);
    return state ? structuredClone(state) : undefined;
  }

  save(state: ConversationContextState): ConversationContextWriteResult {
    if (isZeroId(state.conversationId)) {
      return contextWriteFailure("conversation context state missing conversation_id");
    }

    this.#states.set(state.conversationId, structuredClone(state));
    return contextWriteSuccess();
  }

  clear(): void {
    this.#states.clear();
  }

  size(): number {
    return this.#states.size;
  }
}

