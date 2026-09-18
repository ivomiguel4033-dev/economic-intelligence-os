import { OpenAICompatibleProvider } from "@/ai/providers/openai-compatible-provider";
import { TelemetryProvider } from "@/ai/providers/telemetry-provider";
import type { ModelProvider } from "@/ai/model-provider";
import { assertSafeProviderUrl } from "@/security/provider-url-policy";

export function providersFromEnvironment(): ModelProvider[] {
  const providers: ModelProvider[] = [];
  const entries = [
    { prefix: "AI_PRIMARY", name: "primary" },
    { prefix: "AI_SECONDARY", name: "secondary" },
    { prefix: "AI_TERTIARY", name: "tertiary" },
  ];
  for (const entry of entries) {
    const baseUrl = process.env[`${entry.prefix}_BASE_URL`];
    const apiKey = process.env[`${entry.prefix}_API_KEY`];
    const model = process.env[`${entry.prefix}_MODEL`];
    const configuredValues = [baseUrl, apiKey, model].filter((value) => Boolean(value)).length;
    if (configuredValues === 0) continue;
    if (configuredValues !== 3) {
      throw new Error(`${entry.prefix} provider configuration is incomplete`);
    }
    const safeUrl = assertSafeProviderUrl(baseUrl!);
    const provider = new OpenAICompatibleProvider({ name: entry.name, baseUrl: safeUrl.toString(), apiKey: apiKey!, model: model! });
    providers.push(new TelemetryProvider(provider));
  }
  return providers;
}
