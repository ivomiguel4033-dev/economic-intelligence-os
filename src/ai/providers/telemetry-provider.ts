import type { ModelProvider, ModelRequest, ModelResponse } from "@/ai/model-provider";
import { db } from "@/infrastructure/database/postgres";

const TELEMETRY_QUERY_TIMEOUT_MS = 2_000;

async function recordTelemetry(query: string, values: unknown[]): Promise<void> {
  try {
    // node-postgres supports per-query `query_timeout` at runtime, but the
    // installed @types/pg QueryConfig declaration does not currently expose it.
    // Keep this narrow suppression next to the option so a future type update
    // fails CI and prompts removal instead of weakening db.query globally.
    // @ts-expect-error runtime-supported node-postgres query timeout option
    await db.query({
      text: query,
      values,
      query_timeout: TELEMETRY_QUERY_TIMEOUT_MS,
    });
  } catch {
    // Telemetry is best-effort and must never change the model call outcome.
  }
}

export class TelemetryProvider implements ModelProvider {
  readonly name: string;
  constructor(private readonly inner: ModelProvider) { this.name = inner.name; }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    let response: ModelResponse;
    try {
      response = await this.inner.generate(request);
    } catch (error) {
      await recordTelemetry(
        `INSERT INTO model_performance_events (
          organization_id, provider, model, capability, task_type, success, latency_ms
        ) VALUES ($1,$2,$3,$4,$5,false,$6)`,
        [
          request.metadata?.organizationId ?? null,
          this.inner.name,
          "unknown",
          request.metadata?.capability ?? "unknown",
          request.metadata?.taskType ?? request.metadata?.boardRole ?? "general",
          Date.now() - started,
        ],
      );
      throw error;
    }

    await recordTelemetry(
      `INSERT INTO model_performance_events (
        organization_id, provider, model, capability, task_type, success, latency_ms, input_tokens, output_tokens
      ) VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)`,
      [
        request.metadata?.organizationId ?? null,
        response.provider,
        response.model,
        request.metadata?.capability ?? "unknown",
        request.metadata?.taskType ?? request.metadata?.boardRole ?? "general",
        response.latencyMs ?? Date.now() - started,
        response.inputTokens ?? null,
        response.outputTokens ?? null,
      ],
    );
    return response;
  }
}
