import type { AgentProfile, AgentResponse } from "../core/agentTypes.ts";
import type { PromptPlan } from "../prompt/promptPlan.ts";

export interface ModelRequest {
  agent: AgentProfile;
  prompt: PromptPlan;
  stream: boolean;
}

export interface ModelChunk {
  content: string;
  done: boolean;
}

export type ModelChunkHandler = (chunk: ModelChunk) => void | Promise<void>;

export interface ModelGateway {
  complete(request: ModelRequest, onChunk?: ModelChunkHandler): AgentResponse | Promise<AgentResponse>;
}

