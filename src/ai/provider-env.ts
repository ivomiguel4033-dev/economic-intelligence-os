import { OpenAICompatibleProvider } from "@/ai/providers/openai-compatible-provider";
import type { ModelProvider } from "@/ai/model-provider";

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
    providers.push(new OpenAICompatibleProvider({ name: entry.name, baseUrl, apiKey, model }));
  }
  return providers;
}
