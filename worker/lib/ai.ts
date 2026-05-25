import { callGeminiText, GeminiApiError, GeminiBillingError, type GeminiMessage } from "./gemini";

function shouldUseFallbackModel(error: unknown, model: string, fallbackModel?: string): boolean {
  if (!fallbackModel || fallbackModel === model) return false;
  if (error instanceof GeminiBillingError) return false;
  if (error instanceof GeminiApiError) {
    return error.statusCode !== 401 && error.statusCode !== 403;
  }
  return false;
}

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
    if (shouldUseFallbackModel(error, model, fallbackModel)) {
      return callGeminiText({ apiKey, model: fallbackModel as string, maxTokens, system, messages });
    }
    throw error;
  }
}
