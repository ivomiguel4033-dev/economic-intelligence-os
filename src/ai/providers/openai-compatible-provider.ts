import type { ModelProvider, ModelRequest, ModelResponse } from "@/ai/model-provider";

export interface OpenAICompatibleConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function resolveTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new Error(`AI provider timeoutMs must be a positive safe integer no greater than ${MAX_TIMEOUT_MS}`);
  }
  return value;
}

function resolveMaxResponseBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("AI provider maxResponseBytes must be a positive safe integer");
  }
  return value;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  constructor(private readonly config: OpenAICompatibleConfig) { this.name = config.name; }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs(this.config.timeoutMs));
    const started = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, temperature: request.temperature ?? 0.2, messages: [
          { role: "system", content: request.system }, { role: "user", content: request.prompt },
        ] }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${this.name} returned HTTP ${response.status}`);

      const maxResponseBytes = resolveMaxResponseBytes(this.config.maxResponseBytes);
      const contentLength = parseContentLength(response.headers.get("content-length"));
      if (contentLength !== null && contentLength > maxResponseBytes) {
        controller.abort();
        throw new Error(`${this.name} response exceeded size limit`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error(`${this.name} returned an unreadable response`);
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxResponseBytes) {
          await reader.cancel();
          throw new Error(`${this.name} response exceeded size limit`);
        }
        chunks.push(value);
      }
      const body = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const data = JSON.parse(new TextDecoder().decode(body)) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${this.name} returned empty content`);
      return { provider: this.name, model: this.config.model, content, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens, latencyMs: Date.now() - started };
    } finally { clearTimeout(timeout); }
  }
}
