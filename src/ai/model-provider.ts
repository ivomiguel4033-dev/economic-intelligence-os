export interface ModelRequest {
  system: string;
  prompt: string;
  temperature?: number;
  metadata?: Record<string, string>;
}

export interface ModelResponse {
  provider: string;
  model: string;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface ModelProvider {
  readonly name: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelRouter {
  route(capability: "reasoning" | "research" | "fast" | "safety"): ModelProvider;
}
