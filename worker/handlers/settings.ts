import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import type { Env } from "../lib/types";

type StoredSettings = {
  gemini_api_key: string;
  gemini_flash_model: string;
  gemini_pro_model: string;
  global_ai_rules: string;
  social_agent_rules: string;
  workspace_timezone: string;
  trading_agent_url: string;
  trading_agent_token: string;
  ctrader_client_id: string;
  ctrader_client_secret: string;
  ctrader_access_token: string;
  ctrader_account_id: string;
  ctrader_demo_account_id: string;
  ctrader_live_account_id: string;
  // Twitter/X
  twitter_api_key: string;
  twitter_api_secret: string;
  twitter_access_token: string;
  twitter_access_secret: string;
  // Threads
  threads_access_token: string;
  threads_user_id: string;
  updated_at?: string;
};

type SettingsPayload = Partial<StoredSettings>;

const DEFAULTS: StoredSettings = {
  gemini_api_key: "",
  gemini_flash_model: "gemini-3.1-flash-lite",
  gemini_pro_model: "gemini-3.1-pro-preview",
  global_ai_rules: "",
  social_agent_rules: "",
  workspace_timezone: "Asia/Kuala_Lumpur",
  trading_agent_url: "",
  trading_agent_token: "",
  ctrader_client_id: "",
  ctrader_client_secret: "",
  ctrader_access_token: "",
  ctrader_account_id: "",
  ctrader_demo_account_id: "",
  ctrader_live_account_id: "",
  twitter_api_key: "",
  twitter_api_secret: "",
  twitter_access_token: "",
  twitter_access_secret: "",
  threads_access_token: "",
  threads_user_id: "",
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
    ai_api_connected: Boolean(settings.gemini_api_key),
    gemini_api_connected: Boolean(settings.gemini_api_key),
    gemini_flash_model: settings.gemini_flash_model,
    gemini_pro_model: settings.gemini_pro_model,
    global_ai_rules: settings.global_ai_rules,
    social_agent_rules: settings.social_agent_rules,
    workspace_timezone: settings.workspace_timezone,
    trading_agent_url: settings.trading_agent_url,
    trading_agent_connected: Boolean(settings.trading_agent_url && settings.trading_agent_token),
    trading_agent_token_saved: Boolean(settings.trading_agent_token),
    ctrader_client_id: settings.ctrader_client_id,
    ctrader_account_id: settings.ctrader_account_id,
    ctrader_demo_account_id: settings.ctrader_demo_account_id,
    ctrader_live_account_id: settings.ctrader_live_account_id,
    ctrader_connected: Boolean(
      settings.ctrader_client_id &&
      settings.ctrader_client_secret &&
      settings.ctrader_access_token &&
      (settings.ctrader_demo_account_id || settings.ctrader_live_account_id || settings.ctrader_account_id),
    ),
    ctrader_client_secret_saved: Boolean(settings.ctrader_client_secret),
    ctrader_access_token_saved: Boolean(settings.ctrader_access_token),
    // Twitter/X
    twitter_api_key_saved: Boolean(settings.twitter_api_key),
    twitter_api_secret_saved: Boolean(settings.twitter_api_secret),
    twitter_access_token_saved: Boolean(settings.twitter_access_token),
    twitter_access_secret_saved: Boolean(settings.twitter_access_secret),
    twitter_connected: Boolean(
      settings.twitter_api_key &&
      settings.twitter_api_secret &&
      settings.twitter_access_token &&
      settings.twitter_access_secret,
    ),
    // Threads
    threads_access_token_saved: Boolean(settings.threads_access_token),
    threads_user_id: settings.threads_user_id,
    threads_connected: Boolean(settings.threads_access_token && settings.threads_user_id),
    updated_at: settings.updated_at ?? null,
  };
}

function resolveCtraderAccountId(
  settings: Pick<StoredSettings, "ctrader_account_id" | "ctrader_demo_account_id" | "ctrader_live_account_id">,
  executionMode?: string,
): string {
  const mode = (executionMode || "demo").toLowerCase();
  if (mode === "live") {
    return settings.ctrader_live_account_id || settings.ctrader_account_id || settings.ctrader_demo_account_id || "";
  }
  return settings.ctrader_demo_account_id || settings.ctrader_account_id || settings.ctrader_live_account_id || "";
}

type ActiveStrategy = {
  name: string;
  strategy_text: string;
  assets: string;
  daily_max_trade_signals: number;
  rr_min: number;
  rr_max: number;
  risk_usd_min: number;
  risk_usd_max: number;
  max_open_positions: number;
  execution_mode: string;
  trading_hours: string;
  parsed_strategy: string | null;
};

async function syncTradingAgent(
  settings: StoredSettings,
  strategy?: ActiveStrategy,
  dashboardOrigin?: string,
): Promise<{ ok: boolean; message: string }> {
  if (!settings.trading_agent_url || !settings.trading_agent_token) {
    console.warn("trading.agent_sync.skipped", {
      reason: "bridge_missing",
      has_url: Boolean(settings.trading_agent_url),
      has_token: Boolean(settings.trading_agent_token),
      active_strategy: strategy?.name ?? null,
    });
    return { ok: false, message: "Trading agent URL and token are not configured yet." };
  }
  if (!settings.gemini_api_key) {
    console.warn("trading.agent_sync.skipped", {
      reason: "ai_key_missing",
      active_strategy: strategy?.name ?? null,
    });
    return { ok: false, message: "AI API key is missing, so there is nothing to sync." };
  }

  const payload: Record<string, unknown> = {
    dashboard_api_url: dashboardOrigin ?? "",
    gemini_api_key: settings.gemini_api_key,
    gemini_flash_model: settings.gemini_flash_model,
    gemini_pro_model: settings.gemini_pro_model,
    strategy_active: Boolean(strategy),
    strategy_name: "",
    timezone: settings.workspace_timezone,
    ctrader_connected: Boolean(
      settings.ctrader_client_id &&
      settings.ctrader_client_secret &&
      settings.ctrader_access_token &&
      (settings.ctrader_demo_account_id || settings.ctrader_live_account_id || settings.ctrader_account_id),
    ),
    ctrader_client_id: settings.ctrader_client_id,
    ctrader_client_secret: settings.ctrader_client_secret,
    ctrader_access_token: settings.ctrader_access_token,
    ctrader_account_id: resolveCtraderAccountId(settings, strategy?.execution_mode),
    ctrader_demo_account_id: settings.ctrader_demo_account_id,
    ctrader_live_account_id: settings.ctrader_live_account_id,
    twitter_api_key: settings.twitter_api_key,
    twitter_api_secret: settings.twitter_api_secret,
    twitter_access_token: settings.twitter_access_token,
    twitter_access_secret: settings.twitter_access_secret,
    threads_access_token: settings.threads_access_token,
    threads_user_id: settings.threads_user_id,
  };

  // Push active strategy's trading params if available
  if (strategy) {
    let assets: string[] = [];
    try { assets = JSON.parse(strategy.assets) as string[]; } catch { assets = []; }

    payload.strategy_text = strategy.strategy_text ?? "";
    payload.strategy_name = strategy.name ?? "";
    payload.symbols = assets;
    payload.risk_usd_min = strategy.risk_usd_min;
    payload.risk_usd_max = strategy.risk_usd_max;
    payload.default_rr_ratio = strategy.rr_max;
    payload.max_open_trades = strategy.max_open_positions;
    payload.max_daily_signals = strategy.daily_max_trade_signals;
    payload.demo_mode = strategy.execution_mode !== "live";
    payload.trading_hours = strategy.trading_hours ?? "[]";
    try {
      payload.parsed_strategy = strategy.parsed_strategy ? JSON.parse(strategy.parsed_strategy) : null;
    } catch {
      payload.parsed_strategy = null;
    }
  }

  console.info("trading.agent_sync.request", {
    active: Boolean(strategy),
    strategy_name: strategy?.name ?? null,
    mode: strategy?.execution_mode ?? null,
    symbols: strategy ? (() => {
      try { return JSON.parse(strategy.assets) as string[]; } catch { return []; }
    })() : [],
    daily_max_trade_signals: strategy?.daily_max_trade_signals ?? null,
  });

  const response = await fetch(`${settings.trading_agent_url.replace(/\/$/, "")}/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.trading_agent_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    console.error("trading.agent_sync.failed", {
      status: response.status,
      active: Boolean(strategy),
      strategy_name: strategy?.name ?? null,
    });
    throw new Error(message || `Agent sync failed with ${response.status}`);
  }

  const strategyNote = strategy ? " + active strategy settings" : "";
  console.info("trading.agent_sync.success", {
    active: Boolean(strategy),
    strategy_name: strategy?.name ?? null,
  });
  return { ok: true, message: `Synced AI API${strategyNote} to the trading agent.` };
}

async function getActiveStrategy(env: Env): Promise<ActiveStrategy | undefined> {
  try {
    const row = await env.DB.prepare(
      `SELECT name, strategy_text, assets, daily_max_trade_signals, rr_min, rr_max, risk_usd_min, risk_usd_max,
              max_open_positions, execution_mode, trading_hours, parsed_strategy
       FROM trading_strategies WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`,
    ).first<ActiveStrategy>();
    return row ?? undefined;
  } catch {
    return undefined;
  }
}

export async function getAppSettings(env: Env): Promise<Response> {
  try {
    const settings = await readSettings(env);
    return jsonResponse(publicSettings(settings));
  } catch {
    return errorResponse("Failed to load app settings", 500);
  }
}

export async function updateAppSettings(env: Env, request: Request, dashboardOrigin?: string): Promise<Response> {
  try {
    const payload = await parseJson<SettingsPayload>(request);
    const current = await readSettings(env);
    const savedActiveStrategy = await getActiveStrategy(env);
    const next: StoredSettings = {
      ...current,
      ...Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)),
    };
    const updatedAt = new Date().toISOString();

    await upsertSetting(env, "gemini_api_key", next.gemini_api_key, updatedAt);
    await upsertSetting(env, "gemini_flash_model", next.gemini_flash_model, updatedAt);
    await upsertSetting(env, "gemini_pro_model", next.gemini_pro_model, updatedAt);
    await upsertSetting(env, "global_ai_rules", next.global_ai_rules, updatedAt);
    await upsertSetting(env, "social_agent_rules", next.social_agent_rules, updatedAt);
    await upsertSetting(env, "workspace_timezone", next.workspace_timezone, updatedAt);
    await upsertSetting(env, "trading_agent_url", next.trading_agent_url, updatedAt);
    await upsertSetting(env, "trading_agent_token", next.trading_agent_token, updatedAt);
    await upsertSetting(env, "ctrader_client_id", next.ctrader_client_id, updatedAt);
    await upsertSetting(env, "ctrader_client_secret", next.ctrader_client_secret, updatedAt);
    await upsertSetting(env, "ctrader_access_token", next.ctrader_access_token, updatedAt);
    await upsertSetting(env, "ctrader_demo_account_id", next.ctrader_demo_account_id, updatedAt);
    await upsertSetting(env, "ctrader_live_account_id", next.ctrader_live_account_id, updatedAt);
    next.ctrader_account_id = resolveCtraderAccountId(next, savedActiveStrategy?.execution_mode);
    await upsertSetting(env, "ctrader_account_id", next.ctrader_account_id, updatedAt);
    await upsertSetting(env, "twitter_api_key", next.twitter_api_key, updatedAt);
    await upsertSetting(env, "twitter_api_secret", next.twitter_api_secret, updatedAt);
    await upsertSetting(env, "twitter_access_token", next.twitter_access_token, updatedAt);
    await upsertSetting(env, "twitter_access_secret", next.twitter_access_secret, updatedAt);
    await upsertSetting(env, "threads_access_token", next.threads_access_token, updatedAt);
    await upsertSetting(env, "threads_user_id", next.threads_user_id, updatedAt);

    let syncResult: { ok: boolean; message: string } | null = null;
    if (
      payload.gemini_api_key !== undefined ||
      payload.gemini_flash_model !== undefined ||
      payload.gemini_pro_model !== undefined ||
      payload.workspace_timezone !== undefined ||
      payload.trading_agent_url !== undefined ||
      payload.trading_agent_token !== undefined ||
      payload.ctrader_client_id !== undefined ||
      payload.ctrader_client_secret !== undefined ||
      payload.ctrader_access_token !== undefined ||
      payload.ctrader_demo_account_id !== undefined ||
      payload.ctrader_live_account_id !== undefined ||
      payload.ctrader_account_id !== undefined ||
      payload.twitter_api_key !== undefined ||
      payload.twitter_api_secret !== undefined ||
      payload.twitter_access_token !== undefined ||
      payload.twitter_access_secret !== undefined ||
      payload.threads_access_token !== undefined ||
      payload.threads_user_id !== undefined
    ) {
      try {
        syncResult = await syncTradingAgent(next, savedActiveStrategy, dashboardOrigin);
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

export async function syncAgentFromSettings(env: Env, dashboardOrigin?: string): Promise<Response> {
  try {
    const settings = await readSettings(env);
    const activeStrategy = await getActiveStrategy(env);
    const result = await syncTradingAgent(settings, activeStrategy, dashboardOrigin);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to sync trading agent", 500);
  }
}

export async function completeCtraderConnectionFromAgent(
  env: Env,
  request: Request,
  dashboardOrigin?: string,
): Promise<Response> {
  try {
    const payload = await parseJson<{
      ctrader_client_id?: string;
      ctrader_client_secret?: string;
      ctrader_access_token?: string;
      ctrader_account_id?: string;
      ctrader_demo_account_id?: string;
      ctrader_live_account_id?: string;
    }>(request);

    if (!payload.ctrader_access_token?.trim()) {
      return errorResponse("Missing cTrader access token", 400);
    }
    if (
      !payload.ctrader_account_id?.trim() &&
      !payload.ctrader_demo_account_id?.trim() &&
      !payload.ctrader_live_account_id?.trim()
    ) {
      return errorResponse("Missing cTrader account ID", 400);
    }

    const current = await readSettings(env);
    const nextDemoAccountId = payload.ctrader_demo_account_id?.trim() || current.ctrader_demo_account_id;
    const nextLiveAccountId = payload.ctrader_live_account_id?.trim() || current.ctrader_live_account_id;
    const next: StoredSettings = {
      ...current,
      ctrader_client_id: payload.ctrader_client_id?.trim() || current.ctrader_client_id,
      ctrader_client_secret: payload.ctrader_client_secret?.trim() || current.ctrader_client_secret,
      ctrader_access_token: payload.ctrader_access_token.trim(),
      ctrader_demo_account_id: nextDemoAccountId,
      ctrader_live_account_id: nextLiveAccountId,
      ctrader_account_id:
        payload.ctrader_account_id?.trim() ||
        resolveCtraderAccountId(
          {
            ctrader_account_id: current.ctrader_account_id,
            ctrader_demo_account_id: nextDemoAccountId,
            ctrader_live_account_id: nextLiveAccountId,
          },
          (await getActiveStrategy(env))?.execution_mode,
        ),
    };
    const updatedAt = new Date().toISOString();

    await upsertSetting(env, "ctrader_client_id", next.ctrader_client_id, updatedAt);
    await upsertSetting(env, "ctrader_client_secret", next.ctrader_client_secret, updatedAt);
    await upsertSetting(env, "ctrader_access_token", next.ctrader_access_token, updatedAt);
    await upsertSetting(env, "ctrader_demo_account_id", next.ctrader_demo_account_id, updatedAt);
    await upsertSetting(env, "ctrader_live_account_id", next.ctrader_live_account_id, updatedAt);
    await upsertSetting(env, "ctrader_account_id", next.ctrader_account_id, updatedAt);

    let syncResult: { ok: boolean; message: string } | null = null;
    try {
      const activeStrategy = await getActiveStrategy(env);
      syncResult = await syncTradingAgent(next, activeStrategy, dashboardOrigin);
    } catch (error) {
      syncResult = {
        ok: false,
        message: error instanceof Error ? error.message : "Trading agent sync failed.",
      };
    }

    return jsonResponse({
      ...publicSettings({ ...next, updated_at: updatedAt }),
      sync_result: syncResult,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to complete cTrader connection", 500);
  }
}
