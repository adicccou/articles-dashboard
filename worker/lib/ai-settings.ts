import { DEFAULT_USER_ID, ownerId, tableHasUserId, tableHasWorkspaceId, workspaceId } from "./ownership";
import type { Env } from "./types";

export type AiApiMode = "oilor_default" | "custom";

export type StoredAiSettings = {
  ai_api_mode?: string;
  ai_model?: string;
  custom_ai_api_key?: string;
  gemini_api_key?: string;
  gemini_flash_model?: string;
  gemini_pro_model?: string;
  global_ai_rules?: string;
  social_agent_rules?: string;
};

export type ResolvedAiSettings = {
  aiApiMode: AiApiMode;
  aiModel: string;
  geminiApiKey: string;
  geminiFlashModel: string;
  geminiProModel: string;
  globalAiRules: string;
  socialAgentRules: string;
  defaultApiAvailable: boolean;
  customApiKeySaved: boolean;
};

type AiRulesSource = Pick<ResolvedAiSettings, "globalAiRules" | "socialAgentRules">;
type AiRuleTextOptions = {
  includeSocial?: boolean;
  globalHeading?: string;
  socialHeading?: string;
};

export const DEFAULT_AI_API_MODE: AiApiMode = "oilor_default";
export const CUSTOM_AI_API_MODE: AiApiMode = "custom";
export const DEFAULT_AI_MODEL = "gemini-3.1-flash-preview";

export const AI_SETTING_KEYS = [
  "ai_api_mode",
  "ai_model",
  "custom_ai_api_key",
  "gemini_api_key",
  "gemini_flash_model",
  "gemini_pro_model",
  "global_ai_rules",
  "social_agent_rules",
] as const;

const AI_SETTING_KEY_SQL = AI_SETTING_KEYS.map((key) => `'${key}'`).join(", ");

export function normalizeAiApiMode(value: unknown): AiApiMode {
  return String(value ?? "").trim() === CUSTOM_AI_API_MODE ? CUSTOM_AI_API_MODE : DEFAULT_AI_API_MODE;
}

export function resolveAiModel(settings: StoredAiSettings): string {
  return (
    settings.ai_model?.trim() ||
    settings.gemini_flash_model?.trim() ||
    settings.gemini_pro_model?.trim() ||
    DEFAULT_AI_MODEL
  );
}

export function resolveDefaultAiApiKey(env: Env, settings: StoredAiSettings): string {
  return (
    env.OILOR_AI_API_KEY?.trim() ||
    env.GEMINI_API_KEY?.trim() ||
    env.GOOGLE_AI_API_KEY?.trim() ||
    env.AI_API_KEY?.trim() ||
    settings.gemini_api_key?.trim() ||
    ""
  );
}

function normalizeRuleText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function buildAiRuleSections(
  settings: AiRulesSource,
  options: AiRuleTextOptions = {},
): string[] {
  const sections: string[] = [];
  const globalRules = normalizeRuleText(settings.globalAiRules);
  const socialRules = normalizeRuleText(settings.socialAgentRules);

  if (globalRules) {
    sections.push(`${options.globalHeading ?? "Global AI rules"}:\n${globalRules}`);
  }

  if (options.includeSocial && socialRules) {
    sections.push(`${options.socialHeading ?? "Social/content rules"}:\n${socialRules}`);
  }

  return sections;
}

export function buildAiRulesText(
  settings: AiRulesSource,
  options: AiRuleTextOptions = {},
): string {
  return buildAiRuleSections(settings, options).join("\n\n");
}

export function resolveAiSettings(env: Env, settings: StoredAiSettings): ResolvedAiSettings {
  const aiApiMode = normalizeAiApiMode(settings.ai_api_mode);
  const aiModel = resolveAiModel(settings);
  const customApiKey = settings.custom_ai_api_key?.trim() || "";
  const defaultApiKey = resolveDefaultAiApiKey(env, settings);
  const geminiApiKey = aiApiMode === CUSTOM_AI_API_MODE ? customApiKey : defaultApiKey;

  return {
    aiApiMode,
    aiModel,
    geminiApiKey,
    geminiFlashModel: aiModel,
    geminiProModel: aiModel,
    globalAiRules: settings.global_ai_rules ?? "",
    socialAgentRules: settings.social_agent_rules ?? "",
    defaultApiAvailable: Boolean(defaultApiKey),
    customApiKeySaved: Boolean(customApiKey),
  };
}

export async function readResolvedAiSettings(env: Env, userId = DEFAULT_USER_ID): Promise<ResolvedAiSettings> {
  const hasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
  const hasUserId = await tableHasUserId(env, "app_settings");
  const rows = await env.DB.prepare(
    hasWorkspaceId
      ? `SELECT key, value FROM app_settings WHERE workspace_id = ? AND key IN (${AI_SETTING_KEY_SQL})`
      : hasUserId
      ? `SELECT key, value FROM app_settings WHERE user_id = ? AND key IN (${AI_SETTING_KEY_SQL})`
      : `SELECT key, value FROM app_settings WHERE key IN (${AI_SETTING_KEY_SQL})`,
  ).bind(...(hasWorkspaceId ? [workspaceId(userId)] : hasUserId ? [ownerId(userId)] : [])).all<{
    key: keyof StoredAiSettings;
    value: string;
  }>();

  const stored: StoredAiSettings = {};
  for (const row of rows.results ?? []) {
    stored[row.key] = row.value;
  }

  return resolveAiSettings(env, stored);
}
