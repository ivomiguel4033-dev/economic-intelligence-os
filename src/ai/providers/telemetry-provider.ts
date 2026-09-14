import type { ModelProvider, ModelRequest, ModelResponse } from "@/ai/model-provider";
import { db } from "@/infrastructure/database/postgres";

async function recordTelemetry(query: string, values: unknown[]): Promise<void> {
  try {
    await db.query(query, values);
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
