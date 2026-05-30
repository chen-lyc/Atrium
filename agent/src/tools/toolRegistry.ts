export interface ToolSpec {
  name: string;
  description: string;
  inputSchemaJson: string;
}

export interface ToolCall {
  name: string;
  argumentsJson: string;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  error: string;
}

export type ToolHandler = (call: ToolCall) => ToolResult | Promise<ToolResult>;

interface ToolEntry {
  spec: ToolSpec;
  handler: ToolHandler;
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolEntry>();

  registerTool(spec: ToolSpec, handler: ToolHandler): boolean {
    if (spec.name.length === 0) {
      return false;
    }
    if (this.#tools.has(spec.name)) {
      return false;
    }

    this.#tools.set(spec.name, { spec: structuredClone(spec), handler });
    return true;
  }

  contains(name: string): boolean {
    return this.#tools.has(name);
  }

  async call(call: ToolCall): Promise<ToolResult> {
    const entry = this.#tools.get(call.name);
    if (!entry) {
      return { ok: false, content: "", error: `tool not registered: ${call.name}` };
    }
    return entry.handler(call);
  }

  list(): ToolSpec[] {
    return Array.from(this.#tools.values(), (entry) => structuredClone(entry.spec));
  }
}

