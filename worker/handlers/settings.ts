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
  custom_lean_active: string;
  custom_lean_risk_usd_min: string;
  custom_lean_risk_usd_max: string;
  custom_lean_max_open_trades_per_worker: string;
  custom_lean_execution_mode: string;
  custom_lean_disabled_worker_ids: string;
  custom_lean_deleted_worker_ids: string;
  ml_trading_active: string;
  ml_trading_risk_usd_min: string;
  ml_trading_risk_usd_max: string;
  ml_trading_enabled_assets: string;
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
  custom_lean_active: "true",
  custom_lean_risk_usd_min: "8",
  custom_lean_risk_usd_max: "17",
  custom_lean_max_open_trades_per_worker: "1",
  custom_lean_execution_mode: "demo",
  custom_lean_disabled_worker_ids: "",
  custom_lean_deleted_worker_ids: "",
  ml_trading_active: "false",
  ml_trading_risk_usd_min: "8",
  ml_trading_risk_usd_max: "17",
  ml_trading_enabled_assets: "XAUUSD,US500,SOLUSD",
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
    custom_lean_settings: publicCustomLeanSettings(settings),
    ml_trading_settings: publicMlTradingSettings(settings),
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

function internalAgentSettings(
  settings: StoredSettings,
  strategy?: Pick<ActiveStrategy, "execution_mode">,
) {
  const customLean = publicCustomLeanSettings(settings);
  const mlTrading = publicMlTradingSettings(settings);
  return {
    gemini_api_key: settings.gemini_api_key,
    gemini_flash_model: settings.gemini_flash_model,
    gemini_pro_model: settings.gemini_pro_model,
    global_ai_rules: settings.global_ai_rules,
    social_agent_rules: settings.social_agent_rules,
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
    ctrader_account_id: customLean.selected_account_id,
    ctrader_demo_account_id: settings.ctrader_demo_account_id,
    ctrader_live_account_id: settings.ctrader_live_account_id,
    demo_mode: customLean.execution_mode !== "live",
    auto_execute_demo_signals: customLean.active,
    risk_usd_min: customLean.risk_usd_min,
    risk_usd_max: customLean.risk_usd_max,
    custom_lean_active: customLean.active,
    custom_lean_max_open_trades_per_worker: customLean.max_open_trades_per_worker,
    custom_lean_disabled_worker_ids: customLean.disabled_worker_ids,
    ml_trading_active: mlTrading.active,
    ml_trading_risk_usd_min: mlTrading.risk_usd_min,
    ml_trading_risk_usd_max: mlTrading.risk_usd_max,
    ml_trading_enabled_assets: mlTrading.enabled_assets,
    ml_trading_execution_mode: "demo",
    ml_trading_selected_account_id: mlTrading.selected_account_id,
    trading_agent_url: settings.trading_agent_url,
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

function parseBool(value: string, fallback = false): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeExecutionMode(value: string | undefined): "demo" | "live" {
  return String(value || "").trim().toLowerCase() === "live" ? "live" : "demo";
}

function publicCustomLeanSettings(settings: StoredSettings) {
  const executionMode = normalizeExecutionMode(settings.custom_lean_execution_mode);
  const disabledWorkerIds = String(settings.custom_lean_disabled_worker_ids || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const deletedWorkerIds = String(settings.custom_lean_deleted_worker_ids || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    active: parseBool(settings.custom_lean_active, true),
    risk_usd_min: parseNumber(settings.custom_lean_risk_usd_min, 8),
    risk_usd_max: parseNumber(settings.custom_lean_risk_usd_max, 17),
    max_open_trades_per_worker: Math.max(1, Math.trunc(parseNumber(settings.custom_lean_max_open_trades_per_worker, 1))),
    execution_mode: executionMode,
    disabled_worker_ids: disabledWorkerIds,
    deleted_worker_ids: deletedWorkerIds,
    demo_account_id: settings.ctrader_demo_account_id,
    live_account_id: settings.ctrader_live_account_id,
    selected_account_id: resolveCtraderAccountId(settings, executionMode),
  };
}

function publicMlTradingSettings(settings: StoredSettings) {
  const enabledAssets = String(settings.ml_trading_enabled_assets || "XAUUSD,US500,SOLUSD")
    .split(",")
    .map((value) => value.trim().toUpperCase().replaceAll("/", ""))
    .filter(Boolean);
  return {
    active: parseBool(settings.ml_trading_active, false),
    risk_usd_min: parseNumber(settings.ml_trading_risk_usd_min, 8),
    risk_usd_max: parseNumber(settings.ml_trading_risk_usd_max, 17),
    execution_mode: "demo" as const,
    demo_account_id: settings.ctrader_demo_account_id,
    selected_account_id: settings.ctrader_demo_account_id || settings.ctrader_account_id || "",
    enabled_assets: Array.from(new Set(enabledAssets.length ? enabledAssets : ["XAUUSD", "US500", "SOLUSD"])),
  };
}

type ActiveStrategy = {
  name: string;
  strategy_text: string;
  assets: string;
  daily_max_trade_signals: number;
  rr_min: number;
  rr_max: number;
  breakeven_rr: number;
  risk_usd_min: number;
  risk_usd_max: number;
  max_open_positions: number;
  execution_mode: string;
  confidence_threshold: number;
  self_learning_mode: string;
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
  const customLean = publicCustomLeanSettings(settings);
  const mlTrading = publicMlTradingSettings(settings);

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
    ctrader_account_id: customLean.selected_account_id,
    ctrader_demo_account_id: settings.ctrader_demo_account_id,
    ctrader_live_account_id: settings.ctrader_live_account_id,
    demo_mode: customLean.execution_mode !== "live",
    auto_execute_demo_signals: customLean.active,
    risk_usd_min: customLean.risk_usd_min,
    risk_usd_max: customLean.risk_usd_max,
    custom_lean_active: customLean.active,
    custom_lean_max_open_trades_per_worker: customLean.max_open_trades_per_worker,
    custom_lean_disabled_worker_ids: customLean.disabled_worker_ids,
    custom_lean_deleted_worker_ids: customLean.deleted_worker_ids,
    ml_trading_active: mlTrading.active,
    ml_trading_risk_usd_min: mlTrading.risk_usd_min,
    ml_trading_risk_usd_max: mlTrading.risk_usd_max,
    ml_trading_enabled_assets: mlTrading.enabled_assets,
    ml_trading_execution_mode: "demo",
    ml_trading_selected_account_id: mlTrading.selected_account_id,
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
    payload.risk_usd_min = customLean.risk_usd_min;
    payload.risk_usd_max = customLean.risk_usd_max;
    payload.rr_min = strategy.rr_min;
    payload.default_rr_ratio = strategy.rr_max;
    payload.sl_to_breakeven_at = strategy.breakeven_rr;
    payload.confidence_threshold = strategy.confidence_threshold;
    payload.self_learning_mode = strategy.self_learning_mode;
    payload.max_open_trades = strategy.max_open_positions;
    payload.max_daily_signals = strategy.daily_max_trade_signals;
    payload.demo_mode = customLean.execution_mode !== "live";
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
    mode: customLean.execution_mode,
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
  return { ok: true, message: `Synced Nautilus settings${strategyNote} to the trading agent.` };
}

async function getActiveStrategy(env: Env): Promise<ActiveStrategy | undefined> {
  try {
    const row = await env.DB.prepare(
      `SELECT name, strategy_text, assets, daily_max_trade_signals, rr_min, rr_max, breakeven_rr,
              risk_usd_min, risk_usd_max, max_open_positions, execution_mode, confidence_threshold,
              self_learning_mode, trading_hours, parsed_strategy
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

export async function getInternalAgentSettings(env: Env): Promise<Response> {
  try {
    const settings = await readSettings(env);
    const activeStrategy = await getActiveStrategy(env);
    return jsonResponse(internalAgentSettings(settings, activeStrategy));
  } catch {
    return errorResponse("Failed to load internal agent settings", 500);
  }
}

export async function updateAppSettings(env: Env, request: Request, dashboardOrigin?: string): Promise<Response> {
  try {
    const payload = await parseJson<SettingsPayload>(request);
    const current = await readSettings(env);
    const savedActiveStrategy = await getActiveStrategy(env);
    const normalizedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined && value !== null),
    ) as Record<string, unknown>;
    const next: StoredSettings = {
      ...current,
      ...(normalizedPayload as Partial<StoredSettings>),
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
    await upsertSetting(env, "custom_lean_active", next.custom_lean_active, updatedAt);
    await upsertSetting(env, "custom_lean_risk_usd_min", next.custom_lean_risk_usd_min, updatedAt);
    await upsertSetting(env, "custom_lean_risk_usd_max", next.custom_lean_risk_usd_max, updatedAt);
    await upsertSetting(env, "custom_lean_max_open_trades_per_worker", next.custom_lean_max_open_trades_per_worker, updatedAt);
    await upsertSetting(env, "custom_lean_execution_mode", next.custom_lean_execution_mode, updatedAt);
    await upsertSetting(env, "ml_trading_active", next.ml_trading_active, updatedAt);
    await upsertSetting(env, "ml_trading_risk_usd_min", next.ml_trading_risk_usd_min, updatedAt);
    await upsertSetting(env, "ml_trading_risk_usd_max", next.ml_trading_risk_usd_max, updatedAt);
    await upsertSetting(env, "ml_trading_enabled_assets", next.ml_trading_enabled_assets, updatedAt);
    next.ctrader_account_id = resolveCtraderAccountId(next, normalizeExecutionMode(next.custom_lean_execution_mode));
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
      payload.custom_lean_active !== undefined ||
      payload.custom_lean_risk_usd_min !== undefined ||
      payload.custom_lean_risk_usd_max !== undefined ||
      payload.custom_lean_max_open_trades_per_worker !== undefined ||
      payload.custom_lean_execution_mode !== undefined ||
      payload.custom_lean_deleted_worker_ids !== undefined ||
      payload.ml_trading_active !== undefined ||
      payload.ml_trading_risk_usd_min !== undefined ||
      payload.ml_trading_risk_usd_max !== undefined ||
      payload.ml_trading_enabled_assets !== undefined ||
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

function cleanCustomLeanSettingsPayload(payload: Record<string, unknown>, current: StoredSettings): StoredSettings {
  const active = typeof payload.active === "boolean"
    ? payload.active
    : parseBool(String(payload.active ?? current.custom_lean_active), true);
  const riskMin = Number(payload.risk_usd_min ?? current.custom_lean_risk_usd_min);
  const riskMax = Number(payload.risk_usd_max ?? current.custom_lean_risk_usd_max);
  const workerCap = Number(payload.max_open_trades_per_worker ?? current.custom_lean_max_open_trades_per_worker);
  const executionMode = normalizeExecutionMode(String(payload.execution_mode ?? current.custom_lean_execution_mode));
  const disabledWorkerIds = Array.isArray(payload.disabled_worker_ids)
    ? payload.disabled_worker_ids.map((value) => String(value || "").trim()).filter(Boolean)
    : String(payload.disabled_worker_ids ?? current.custom_lean_disabled_worker_ids)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const deletedWorkerIds = Array.isArray(payload.deleted_worker_ids)
    ? payload.deleted_worker_ids.map((value) => String(value || "").trim()).filter(Boolean)
    : String(payload.deleted_worker_ids ?? current.custom_lean_deleted_worker_ids)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  if (!Number.isFinite(riskMin) || riskMin <= 0) {
    throw new Error("Min risk must be greater than 0.");
  }
  if (!Number.isFinite(riskMax) || riskMax <= 0) {
    throw new Error("Max risk must be greater than 0.");
  }
  if (riskMax < riskMin) {
    throw new Error("Max risk must be greater than or equal to min risk.");
  }
  if (!Number.isFinite(workerCap) || workerCap < 1) {
    throw new Error("Each worker max open trades must be at least 1.");
  }

  const next: StoredSettings = {
    ...current,
    custom_lean_active: active ? "true" : "false",
    custom_lean_risk_usd_min: String(riskMin),
    custom_lean_risk_usd_max: String(riskMax),
    custom_lean_max_open_trades_per_worker: String(Math.max(1, Math.trunc(workerCap))),
    custom_lean_execution_mode: executionMode,
    custom_lean_disabled_worker_ids: Array.from(new Set(disabledWorkerIds)).join(","),
    custom_lean_deleted_worker_ids: Array.from(new Set(deletedWorkerIds)).join(","),
  };
  next.ctrader_account_id = resolveCtraderAccountId(next, executionMode);
  return next;
}

function cleanMlTradingSettingsPayload(payload: Record<string, unknown>, current: StoredSettings): StoredSettings {
  const active = typeof payload.active === "boolean"
    ? payload.active
    : parseBool(String(payload.active ?? current.ml_trading_active), false);
  const riskMin = Number(payload.risk_usd_min ?? current.ml_trading_risk_usd_min);
  const riskMax = Number(payload.risk_usd_max ?? current.ml_trading_risk_usd_max);
  const enabledAssets = Array.isArray(payload.enabled_assets)
    ? payload.enabled_assets.map((value) => String(value || "").trim().toUpperCase().replaceAll("/", "")).filter(Boolean)
    : String(payload.enabled_assets ?? current.ml_trading_enabled_assets)
      .split(",")
      .map((value) => value.trim().toUpperCase().replaceAll("/", ""))
      .filter(Boolean);

  if (!Number.isFinite(riskMin) || riskMin <= 0) {
    throw new Error("ML Trading min risk must be greater than 0.");
  }
  if (!Number.isFinite(riskMax) || riskMax <= 0) {
    throw new Error("ML Trading max risk must be greater than 0.");
  }
  if (riskMax < riskMin) {
    throw new Error("ML Trading max risk must be greater than or equal to min risk.");
  }

  return {
    ...current,
    ml_trading_active: active ? "true" : "false",
    ml_trading_risk_usd_min: String(riskMin),
    ml_trading_risk_usd_max: String(riskMax),
    ml_trading_enabled_assets: Array.from(new Set(enabledAssets.length ? enabledAssets : ["XAUUSD", "US500", "SOLUSD"])).join(","),
  };
}

export async function getCustomLeanSettings(env: Env): Promise<Response> {
  try {
    const settings = await readSettings(env);
    return jsonResponse(publicCustomLeanSettings(settings));
  } catch {
    return errorResponse("Failed to load Nautilus settings", 500);
  }
}

export async function getMlTradingSettings(env: Env): Promise<Response> {
  try {
    const settings = await readSettings(env);
    return jsonResponse(publicMlTradingSettings(settings));
  } catch {
    return errorResponse("Failed to load ML Trading settings", 500);
  }
}

export async function updateCustomLeanSettings(
  env: Env,
  request: Request,
  dashboardOrigin?: string,
): Promise<Response> {
  try {
    const payload = await parseJson<Record<string, unknown>>(request);
    const current = await readSettings(env);
    const next = cleanCustomLeanSettingsPayload(payload, current);
    const activeStrategy = await getActiveStrategy(env);
    const updatedAt = new Date().toISOString();

    await upsertSetting(env, "custom_lean_active", next.custom_lean_active, updatedAt);
    await upsertSetting(env, "custom_lean_risk_usd_min", next.custom_lean_risk_usd_min, updatedAt);
    await upsertSetting(env, "custom_lean_risk_usd_max", next.custom_lean_risk_usd_max, updatedAt);
    await upsertSetting(env, "custom_lean_max_open_trades_per_worker", next.custom_lean_max_open_trades_per_worker, updatedAt);
    await upsertSetting(env, "custom_lean_execution_mode", next.custom_lean_execution_mode, updatedAt);
    await upsertSetting(env, "custom_lean_disabled_worker_ids", next.custom_lean_disabled_worker_ids, updatedAt);
    await upsertSetting(env, "custom_lean_deleted_worker_ids", next.custom_lean_deleted_worker_ids, updatedAt);
    await upsertSetting(env, "ctrader_account_id", next.ctrader_account_id, updatedAt);

    let syncResult: { ok: boolean; message: string } | null = null;
    try {
      syncResult = await syncTradingAgent(next, activeStrategy, dashboardOrigin);
    } catch (error) {
      syncResult = {
        ok: false,
        message: error instanceof Error ? error.message : "Trading agent sync failed.",
      };
    }

    return jsonResponse({
      ...publicCustomLeanSettings({ ...next, updated_at: updatedAt }),
      sync_result: syncResult,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to update Nautilus settings", 400);
  }
}

export async function updateMlTradingSettings(
  env: Env,
  request: Request,
  dashboardOrigin?: string,
): Promise<Response> {
  try {
    const payload = await parseJson<Record<string, unknown>>(request);
    const current = await readSettings(env);
    const next = cleanMlTradingSettingsPayload(payload, current);
    const activeStrategy = await getActiveStrategy(env);
    const updatedAt = new Date().toISOString();

    await upsertSetting(env, "ml_trading_active", next.ml_trading_active, updatedAt);
    await upsertSetting(env, "ml_trading_risk_usd_min", next.ml_trading_risk_usd_min, updatedAt);
    await upsertSetting(env, "ml_trading_risk_usd_max", next.ml_trading_risk_usd_max, updatedAt);
    await upsertSetting(env, "ml_trading_enabled_assets", next.ml_trading_enabled_assets, updatedAt);

    let syncResult: { ok: boolean; message: string } | null = null;
    try {
      syncResult = await syncTradingAgent(next, activeStrategy, dashboardOrigin);
    } catch (error) {
      syncResult = {
        ok: false,
        message: error instanceof Error ? error.message : "Trading agent sync failed.",
      };
    }

    return jsonResponse({
      ...publicMlTradingSettings({ ...next, updated_at: updatedAt }),
      sync_result: syncResult,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to update ML Trading settings", 400);
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
          normalizeExecutionMode(current.custom_lean_execution_mode),
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

async function fetchTradingAgentJson(
  settings: StoredSettings,
  path: string,
  timeoutMs = 10000,
): Promise<Record<string, unknown> | unknown[]> {
  if (!settings.trading_agent_url || !settings.trading_agent_token) {
    throw new Error("Trading agent not configured");
  }

  const baseUrl = settings.trading_agent_url.replace(/\/$/, "");
  const url = `${baseUrl}${path}`;
  console.info("trading.agent_fetch.request", { path, has_token: Boolean(settings.trading_agent_token) });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${settings.trading_agent_token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    console.error("trading.agent_fetch.failed", { path, status: response.status, body });
    throw new Error(`Trading agent returned ${response.status}${body ? `: ${body}` : ""}`);
  }

  const payload = await response.json() as Record<string, unknown> | unknown[];
  console.info("trading.agent_fetch.success", { path, status: response.status });
  return payload;
}

export async function getLeanStatus(env: Env): Promise<Response> {
  const settings = await readSettings(env);
  if (!settings.trading_agent_url || !settings.trading_agent_token) {
    return jsonResponse({ connected: false, error: "Trading agent not configured" });
  }
  try {
    const response = await fetch(
      `${settings.trading_agent_url.replace(/\/$/, "")}/lean-status`,
      {
        headers: { Authorization: `Bearer ${settings.trading_agent_token}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) {
      return jsonResponse({ connected: false, error: `Agent returned ${response.status}` });
    }
    const data = await response.json() as Record<string, unknown>;
    return jsonResponse({ connected: true, ...data });
  } catch (error) {
    return jsonResponse({
      connected: false,
      error: error instanceof Error ? error.message : "Could not reach trading agent",
    });
  }
}

export async function getLearningReport(env: Env): Promise<Response> {
  const settings = await readSettings(env);
  if (!settings.trading_agent_url || !settings.trading_agent_token) {
    return jsonResponse({ connected: false, error: "Trading agent not configured" });
  }
  try {
    const response = await fetch(
      `${settings.trading_agent_url.replace(/\/$/, "")}/learning-report`,
      {
        headers: { Authorization: `Bearer ${settings.trading_agent_token}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) {
      return jsonResponse({ connected: false, error: `Agent returned ${response.status}` });
    }
    const data = await response.json() as Record<string, unknown>;
    return jsonResponse({ connected: true, ...data });
  } catch (error) {
    return jsonResponse({
      connected: false,
      error: error instanceof Error ? error.message : "Could not reach trading agent",
    });
  }
}

export async function getCustomLeanWorkers(env: Env): Promise<Response> {
  const settings = await readSettings(env);
  try {
    const data = await fetchTradingAgentJson(settings, "/nautilus/workers");
    const assets = Array.isArray(data)
      ? data
      : Array.isArray(data.assets)
        ? data.assets
        : [];
    const customLeanSettings = publicCustomLeanSettings(settings);
    const disabledWorkerIds = new Set(customLeanSettings.disabled_worker_ids);
    const deletedWorkerIds = new Set(customLeanSettings.deleted_worker_ids);
    const isMlTradingWorker = (worker: unknown) => {
      if (!worker || typeof worker !== "object") return false;
      const probe = [
        String((worker as { id?: unknown }).id || "").trim().toLowerCase(),
        String((worker as { name?: unknown }).name || "").trim().toLowerCase(),
        String((worker as { role?: unknown }).role || "").trim().toLowerCase(),
      ].join(" ");
      return probe.includes("ml trading") || probe.includes("ml_trading") || probe.includes("ml_liquidity_fvg");
    };
    const normalizedAssets = assets.map((asset) => {
      if (!asset || typeof asset !== "object") return asset;
      const rawWorkers = (asset as { workers?: unknown }).workers;
      const workers = Array.isArray(rawWorkers) ? rawWorkers : [];
      return {
        ...asset,
        workers: workers
          .filter((worker) => !isMlTradingWorker(worker))
          .map((worker) => {
            if (!worker || typeof worker !== "object") return worker;
            const workerId = String((worker as { id?: unknown }).id || "").trim();
            const enabled = workerId ? !disabledWorkerIds.has(workerId) : true;
            return {
              ...worker,
              enabled,
              status: enabled ? String((worker as { status?: unknown }).status || "ready") : "paused",
            };
          })
          .filter((worker) => {
            if (!worker || typeof worker !== "object") return false;
            const workerId = String((worker as { id?: unknown }).id || "").trim();
            return workerId ? !deletedWorkerIds.has(workerId) : true;
          }),
      };
    }).filter((asset) => {
      if (!asset || typeof asset !== "object") return false;
      const workers = (asset as { workers?: unknown }).workers;
      return Array.isArray(workers) && workers.length > 0;
    });
    const workerCount = assets.reduce((count, asset) => {
      if (!asset || typeof asset !== "object") return count;
      const workers = (asset as { workers?: unknown }).workers;
      return count + (Array.isArray(workers) ? workers.length : 0);
    }, 0);
    console.info("trading.nautilus.workers.loaded", { assets: assets.length, worker_count: workerCount });
    return jsonResponse(normalizedAssets);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Could not reach trading agent", 502);
  }
}

export async function getCustomLeanDiagnostics(env: Env): Promise<Response> {
  const settings = await readSettings(env);
  try {
    const data = await fetchTradingAgentJson(settings, "/nautilus/diagnostics");
    return jsonResponse(data);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Could not reach trading agent", 502);
  }
}

export async function getMlTradingAssets(env: Env): Promise<Response> {
  const settings = await readSettings(env);
  try {
    const data = await fetchTradingAgentJson(settings, "/ml-trading/assets");
    const assets = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>).assets)
        ? (data as Record<string, unknown>).assets as unknown[]
        : [];
    const mlSettings = publicMlTradingSettings(settings);
    const enabledAssets = new Set(mlSettings.enabled_assets);
    const normalizedAssets = assets.map((asset) => {
      if (!asset || typeof asset !== "object") return asset;
      const symbol = String((asset as { asset?: unknown }).asset || "").trim().toUpperCase();
      return {
        ...asset,
        enabled: symbol ? enabledAssets.has(symbol) : false,
      };
    });
    return jsonResponse(normalizedAssets);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Could not reach trading agent", 502);
  }
}
