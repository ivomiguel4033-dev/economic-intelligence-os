import type { ModelProvider, ModelRequest, ModelResponse } from "@/ai/model-provider";

export interface OpenAICompatibleConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  constructor(private readonly config: OpenAICompatibleConfig) { this.name = config.name; }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 45_000);
    const started = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, temperature: request.temperature ?? 0.2, messages: [
          { role: "system", content: request.system }, { role: "user", content: request.prompt },
        ] }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${this.name} returned HTTP ${response.status}`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${this.name} returned empty content`);
      return { provider: this.name, model: this.config.model, content, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens, latencyMs: Date.now() - started };
    } finally { clearTimeout(timeout); }
  }
}
