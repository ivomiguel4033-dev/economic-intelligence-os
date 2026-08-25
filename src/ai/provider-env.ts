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
    if (!baseUrl || !apiKey || !model) continue;
    const safeUrl = assertSafeProviderUrl(baseUrl);
    const provider = new OpenAICompatibleProvider({ name: entry.name, baseUrl: safeUrl.toString(), apiKey, model });
    providers.push(new TelemetryProvider(provider));
  }
  return providers;
}
