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
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new Error("AI provider returned invalid Content-Length");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("AI provider returned invalid Content-Length");
  return parsed;
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
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RESPONSE_BYTES) {
    throw new Error(`AI provider maxResponseBytes must be a positive safe integer no greater than ${MAX_RESPONSE_BYTES}`);
  }
  return value;
}

function isJsonMediaType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}

function parseOptionalTokenCount(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`AI provider returned invalid ${field}`);
  }
  return value as number;
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
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, temperature: request.temperature ?? 0.2, messages: [
          { role: "system", content: request.system }, { role: "user", content: request.prompt },
        ] }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        controller.abort();
        throw new Error(`${this.name} returned HTTP ${response.status}`);
      }
      if (!isJsonMediaType(response.headers.get("content-type"))) {
        controller.abort();
        throw new Error(`${this.name} returned a non-JSON response`);
      }

      const maxResponseBytes = resolveMaxResponseBytes(this.config.maxResponseBytes);
      let contentLength: number | null;
      try {
        contentLength = parseContentLength(response.headers.get("content-length"));
      } catch (error) {
        controller.abort();
        throw error;
      }
      if (contentLength !== null && contentLength > maxResponseBytes) {
        controller.abort();
        throw new Error(`${this.name} response exceeded size limit`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        controller.abort();
        throw new Error(`${this.name} returned an unreadable response`);
      }
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maxResponseBytes) {
            throw new Error(`${this.name} response exceeded size limit`);
          }
          chunks.push(value);
        }
      } catch (error) {
        // Any failed or oversized stream invalidates the provider attempt. Abort the
        // request first so the transport is signalled even if reader cancellation
        // itself fails, then release the body resources on a best-effort basis.
        controller.abort();
        try { await reader.cancel(); } catch { /* best-effort cleanup */ }
        throw error;
      } finally {
        reader.releaseLock();
      }
      const body = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }

      let data: { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      try {
        data = JSON.parse(new TextDecoder().decode(body)) as typeof data;
      } catch (error) {
        controller.abort();
        throw error;
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        controller.abort();
        throw new Error(`${this.name} returned invalid content`);
      }
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      try {
        inputTokens = parseOptionalTokenCount(data.usage?.prompt_tokens, "prompt token count");
        outputTokens = parseOptionalTokenCount(data.usage?.completion_tokens, "completion token count");
      } catch (error) {
        controller.abort();
        throw error;
      }
      return { provider: this.name, model: this.config.model, content, inputTokens, outputTokens, latencyMs: Date.now() - started };
    } finally { clearTimeout(timeout); }
  }
}
