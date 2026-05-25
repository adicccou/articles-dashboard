import { callAiText } from "../lib/ai";
import { formatGeminiUserError } from "../lib/gemini";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { DEFAULT_USER_ID, ownerId, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import type { Env } from "../lib/types";

type PlannerAiSettings = {
  geminiApiKey: string;
  geminiFlashModel: string;
  geminiProModel: string;
  globalAiRules: string;
};

async function readPlannerAiSettings(env: Env, userId = DEFAULT_USER_ID): Promise<PlannerAiSettings> {
  const hasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
  const hasUserId = await tableHasUserId(env, "app_settings");
  const rows = await env.DB.prepare(
    hasWorkspaceId
      ? "SELECT key, value FROM app_settings WHERE workspace_id = ? AND key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')"
      : hasUserId
      ? "SELECT key, value FROM app_settings WHERE user_id = ? AND key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')"
      : "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')",
  ).bind(...(hasWorkspaceId ? [workspaceId(userId)] : hasUserId ? [ownerId(userId)] : [])).all<{ key: string; value: string }>();

  const settings: PlannerAiSettings = {
    geminiApiKey: "",
    geminiFlashModel: "gemini-3.1-flash-preview",
    geminiProModel: "gemini-3.1-pro-preview",
    globalAiRules: "",
  };

  for (const row of rows.results ?? []) {
    if (row.key === "gemini_api_key" && row.value) settings.geminiApiKey = row.value;
    if (row.key === "gemini_flash_model" && row.value) settings.geminiFlashModel = row.value;
    if (row.key === "gemini_pro_model" && row.value) settings.geminiProModel = row.value;
    if (row.key === "global_ai_rules" && row.value) settings.globalAiRules = row.value;
  }

  return settings;
}

function cleanImprovedText(value: string): string {
  return value.trim().replace(/^```(?:text)?/i, "").replace(/```$/i, "").trim();
}

export async function improvePlannerDescription(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<{ description?: string; platform?: string | null }>(request);
    const description = String(payload.description ?? "").trim();
    if (!description) return errorResponse("Description is required", 400);

    const settings = await readPlannerAiSettings(env, userId);
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
        settings.globalAiRules ? `Global AI rules to obey:\n${settings.globalAiRules}` : "",
      ].filter(Boolean).join("\n\n"),
      messages: [{ role: "user", content: `Platform: ${payload.platform || "social"}\n\nDraft:\n${description}` }],
    });

    return jsonResponse({ value: cleanImprovedText(improved) });
  } catch (error) {
    return jsonResponse({ error: formatGeminiUserError(error) }, { status: 500 });
  }
}
