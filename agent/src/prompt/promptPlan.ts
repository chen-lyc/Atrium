export const PromptRole = {
  System: "system",
  User: "user",
  Assistant: "assistant",
  Tool: "tool",
} as const;

export type PromptRole = (typeof PromptRole)[keyof typeof PromptRole];

export interface PromptFragment {
  role: PromptRole;
  name: string;
  content: string;
  required: boolean;
}

export class PromptPlan {
  readonly #fragments: PromptFragment[] = [];

  add(fragment: PromptFragment): void {
    this.#fragments.push(fragment);
  }

  addSystem(name: string, content: string): void {
    this.add({ role: PromptRole.System, name, content, required: true });
  }

  addUser(name: string, content: string): void {
    this.add({ role: PromptRole.User, name, content, required: true });
  }

  addAssistant(name: string, content: string): void {
    this.add({ role: PromptRole.Assistant, name, content, required: true });
  }

  fragments(): readonly PromptFragment[] {
    return this.#fragments;
  }

  empty(): boolean {
    return this.#fragments.length === 0;
  }
}

