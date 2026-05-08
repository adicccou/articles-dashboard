import { callGeminiText, type GeminiMessage } from "./gemini";

export async function callAiText({
  apiKey,
  model,
  maxTokens,
  system,
  messages,
}: {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  messages: GeminiMessage[];
}): Promise<string> {
  return callGeminiText({ apiKey, model, maxTokens, system, messages });
}
