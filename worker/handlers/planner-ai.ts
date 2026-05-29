import { callAiText } from "../lib/ai";
import { buildAiRuleSections, readResolvedAiSettings } from "../lib/ai-settings";
import { formatGeminiUserError } from "../lib/gemini";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { DEFAULT_USER_ID } from "../lib/ownership";
import type { Env } from "../lib/types";

function cleanImprovedText(value: string): string {
  return value.trim().replace(/^```(?:text)?/i, "").replace(/```$/i, "").trim();
}

export async function improvePlannerDescription(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<{ description?: string; platform?: string | null }>(request);
    const description = String(payload.description ?? "").trim();
    if (!description) return errorResponse("Description is required", 400);

    const settings = await readResolvedAiSettings(env, userId);
    if (!settings.geminiApiKey) return errorResponse("No Gemini API key is configured", 500);

    const improved = await callAiText({
      apiKey: settings.geminiApiKey,
      model: settings.geminiProModel,
      fallbackModel: settings.geminiFlashModel,
      maxTokens: 420,
      system: [
        "Improve a social media post draft. Return only the improved post text.",
        "Preserve the author's intent and voice while making it clearer, stronger, and more publishable.",
        "No notes, labels, markdown, or multiple options.",
        ...buildAiRuleSections(settings, {
          includeSocial: true,
          globalHeading: "Global AI rules to obey",
          socialHeading: "Social/content rules to obey",
        }),
      ].filter(Boolean).join("\n\n"),
      messages: [{ role: "user", content: `Platform: ${payload.platform || "social"}\n\nDraft:\n${description}` }],
    });

    return jsonResponse({ value: cleanImprovedText(improved) });
  } catch (error) {
    return jsonResponse({ error: formatGeminiUserError(error) }, { status: 500 });
  }
}
