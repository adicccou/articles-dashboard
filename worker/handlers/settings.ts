import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import type { Env } from "../lib/types";

type StoredSettings = {
  anthropic_api_key: string;
  claude_model: string;
  trading_agent_url: string;
  trading_agent_token: string;
  updated_at?: string;
};

type SettingsPayload = Partial<StoredSettings>;

const DEFAULTS: StoredSettings = {
  anthropic_api_key: "",
  claude_model: "claude-sonnet-4-20250514",
  trading_agent_url: "",
  trading_agent_token: "",
};

async function readSettings(env: Env): Promise<StoredSettings> {
  const rows = await env.DB.prepare("SELECT key, value, updated_at FROM app_settings").all<{
    key: string;
    value: string;
    updated_at: string;
  }>();

  const merged: StoredSettings = { ...DEFAULTS };
  for (const row of rows.results ?? []) {
    if (row.key in merged) {
      (merged as Record<string, string>)[row.key] = row.value;
      merged.updated_at = row.updated_at;
    }
  }
  return merged;
}

async function upsertSetting(env: Env, key: keyof StoredSettings, value: string, updatedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, updatedAt)
    .run();
}

function publicSettings(settings: StoredSettings) {
  return {
    ai_api_connected: Boolean(settings.anthropic_api_key),
    claude_model: settings.claude_model,
    trading_agent_url: settings.trading_agent_url,
    trading_agent_connected: Boolean(settings.trading_agent_url && settings.trading_agent_token),
    trading_agent_token_saved: Boolean(settings.trading_agent_token),
    updated_at: settings.updated_at ?? null,
  };
}

async function syncTradingAgent(settings: StoredSettings): Promise<{ ok: boolean; message: string }> {
  if (!settings.trading_agent_url || !settings.trading_agent_token) {
    return { ok: false, message: "Trading agent URL and token are not configured yet." };
  }
  if (!settings.anthropic_api_key) {
    return { ok: false, message: "AI API key is missing, so there is nothing to sync." };
  }

  const response = await fetch(`${settings.trading_agent_url.replace(/\/$/, "")}/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.trading_agent_token}`,
    },
    body: JSON.stringify({
      anthropic_api_key: settings.anthropic_api_key,
      claude_model: settings.claude_model,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Agent sync failed with ${response.status}`);
  }

  return { ok: true, message: "Shared AI API settings synced to the trading agent." };
}

export async function getAppSettings(env: Env): Promise<Response> {
  try {
    const settings = await readSettings(env);
    return jsonResponse(publicSettings(settings));
  } catch {
    return errorResponse("Failed to load app settings", 500);
  }
}

export async function updateAppSettings(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<SettingsPayload>(request);
    const current = await readSettings(env);
    const next: StoredSettings = {
      ...current,
      ...Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)),
    };
    const updatedAt = new Date().toISOString();

    await upsertSetting(env, "anthropic_api_key", next.anthropic_api_key, updatedAt);
    await upsertSetting(env, "claude_model", next.claude_model, updatedAt);
    await upsertSetting(env, "trading_agent_url", next.trading_agent_url, updatedAt);
    await upsertSetting(env, "trading_agent_token", next.trading_agent_token, updatedAt);

    let syncResult: { ok: boolean; message: string } | null = null;
    if (
      payload.anthropic_api_key !== undefined ||
      payload.claude_model !== undefined ||
      payload.trading_agent_url !== undefined ||
      payload.trading_agent_token !== undefined
    ) {
      try {
        syncResult = await syncTradingAgent(next);
      } catch (error) {
        syncResult = {
          ok: false,
          message: error instanceof Error ? error.message : "Trading agent sync failed.",
        };
      }
    }

    return jsonResponse({
      ...publicSettings({ ...next, updated_at: updatedAt }),
      sync_result: syncResult,
    });
  } catch {
    return errorResponse("Failed to update app settings", 500);
  }
}

export async function syncAgentFromSettings(env: Env): Promise<Response> {
  try {
    const settings = await readSettings(env);
    const result = await syncTradingAgent(settings);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to sync trading agent", 500);
  }
}
