export const PromptRole = {
  System: "system",
  User: "user",
  Assistant: "assistant",
  Tool: "tool",
} as const;

export type PromptRole = (typeof PromptRole)[keyof typeof PromptRole];

export const PromptSegment = {
  StaticPrefix: 1,
  ConfirmedWhiteboard: 2,
  ContextMessages: 3,
  PrivateEvidence: 4,
  TriggerMessages: 5,
} as const;

export type PromptSegment = (typeof PromptSegment)[keyof typeof PromptSegment];

export interface PromptFragment {
  readonly segment: PromptSegment;
  readonly role: PromptRole;
  readonly name: string;
  readonly content: string;
  readonly required: boolean;
}

export class PromptPlan {
  readonly #fragments: PromptFragment[] = [];
  #lastSegment: PromptSegment = PromptSegment.StaticPrefix;

  add(fragment: PromptFragment): void {
    if (fragment.segment < this.#lastSegment) {
      throw new Error(`prompt segment order violation: ${fragment.segment} after ${this.#lastSegment}`);
    }
    this.#lastSegment = fragment.segment;
    this.#fragments.push(fragment);
  }

  addSystem(segment: PromptSegment, name: string, content: string): void {
    this.add({ segment, role: PromptRole.System, name, content, required: true });
  }

  addUser(segment: PromptSegment, name: string, content: string): void {
    this.add({ segment, role: PromptRole.User, name, content, required: true });
  }

  addAssistant(segment: PromptSegment, name: string, content: string): void {
    this.add({ segment, role: PromptRole.Assistant, name, content, required: true });
  }

  fragments(): readonly PromptFragment[] {
    return this.#fragments;
  }

  fragmentsFor(segment: PromptSegment): readonly PromptFragment[] {
    return this.#fragments.filter((fragment) => fragment.segment === segment);
  }

  segments(): readonly PromptSegment[] {
    return [...new Set(this.#fragments.map((fragment) => fragment.segment))];
  }

  empty(): boolean {
    return this.#fragments.length === 0;
  }
}
