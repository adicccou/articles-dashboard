import { callGeminiText, type GeminiMessage } from "./gemini";

export async function callAiText({
  apiKey,
  model,
  fallbackModel,
  maxTokens,
  system,
  messages,
}: {
  apiKey: string;
  model: string;
  fallbackModel?: string;
  maxTokens: number;
  system?: string;
  messages: GeminiMessage[];
}): Promise<string> {
  try {
    return await callGeminiText({ apiKey, model, maxTokens, system, messages });
  } catch (error) {
    if (
      fallbackModel &&
      fallbackModel !== model &&
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "GeminiRateLimitError"
    ) {
      return callGeminiText({ apiKey, model: fallbackModel, maxTokens, system, messages });
    }
    throw error;
  }
}
