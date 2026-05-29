import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { readResolvedAiSettings } from "../lib/ai-settings";
import { parseTradingStrategyToJSON, type ParsedStrategy } from "../lib/gemini";
import { DEFAULT_USER_ID } from "../lib/ownership";

interface CreateStrategyPayload {
  name: string;
  strategy_text?: string;
  assets: string[];
  daily_max_trade_signals?: number;
  strategy_type: "scalping" | "daytrading" | "swing" | "position";
  risk_usd_min?: number;
  risk_usd_max?: number;
  rr_min?: number;
  rr_max?: number;
  breakeven_rr?: number;
  max_open_positions?: number;
  execution_mode?: "demo" | "live";
  confidence_threshold?: number;
  self_learning_mode?: "off" | "suggest_only";
  trading_hours?: unknown;
}

type TradingStrategyRow = {
  id: number;
  name: string;
  knowledge_base_id: number | null;
  strategy_text: string;
  parsed_strategy: string | null;
  assets: string;
  daily_max_trade_signals: number;
  strategy_type: "scalping" | "daytrading" | "swing" | "position";
  risk_usd_min: number;
  risk_usd_max: number;
  rr_min: number;
  rr_max: number;
  breakeven_rr: number;
  max_open_positions: number;
  execution_mode: "demo" | "live";
  confidence_threshold: number;
  self_learning_mode: "off" | "suggest_only";
  trading_hours: string;
  status: "active" | "inactive" | "paused" | "testing";
  created_at: string;
  updated_at: string;
};

export function normalizeTradingStrategyForInternal(row: TradingStrategyRow | null) {
  return normalizeTradingStrategy(row);
}

function normalizeAssets(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => String(value).trim().toUpperCase().replaceAll("/", ""))
      .filter(Boolean);
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeAssets(parsed);
      }
    } catch {
      return input
        .split(/[,\n]/)
        .map((value) => value.trim().toUpperCase().replaceAll("/", ""))
        .filter(Boolean);
    }
  }

  return [];
}

function logStrategyEvent(event: string, strategy: TradingStrategyRow | null, extra: Record<string, unknown> = {}) {
  const assets = normalizeAssets(strategy?.assets ?? "[]");
  console.info("trading.strategy", {
    event,
    id: strategy?.id ?? null,
    name: strategy?.name ?? null,
    status: strategy?.status ?? null,
    mode: strategy?.execution_mode ?? null,
    assets,
    daily_max_trade_signals: strategy?.daily_max_trade_signals ?? null,
    ...extra,
  });
}

function normalizeTradingStrategy(row: TradingStrategyRow | null) {
  if (!row) {
    return null;
  }

  let trading_hours: unknown[] = [];
  try {
    const parsed = JSON.parse(row.trading_hours || "[]") as unknown;
    if (Array.isArray(parsed)) trading_hours = parsed;
  } catch {
    trading_hours = [];
  }

  let parsed_strategy: ParsedStrategy | null = null;
  try {
    if (row.parsed_strategy) {
      parsed_strategy = JSON.parse(row.parsed_strategy);
    }
  } catch {
    parsed_strategy = null;
  }

  return {
    ...row,
    strategy_text: row.strategy_text || "",
    parsed_strategy,
    assets: normalizeAssets(row.assets),
    trading_hours,
  };
}

function validateRiskFields(payload: Partial<CreateStrategyPayload>): string | null {
  const rrMin = payload.rr_min ?? 1.5;
  const rrMax = payload.rr_max ?? 2.5;
  const breakevenRr = payload.breakeven_rr ?? 1.0;
  const dailyMaxTradeSignals = payload.daily_max_trade_signals ?? 8;
  const confidenceThreshold = payload.confidence_threshold ?? 85;

  if (payload.risk_usd_min !== undefined && payload.risk_usd_max !== undefined) {
    if (payload.risk_usd_max < payload.risk_usd_min) {
      return "Maximum risk cannot be less than minimum risk.";
    }
  }

  if (rrMin < 1.5) {
    return "Minimum RR must be at least 1.5R.";
  }

  if (rrMax > 2.5) {
    return "Maximum RR cannot be above 2.5R.";
  }

  if (rrMax < rrMin) {
    return "Maximum RR must be greater than or equal to minimum RR.";
  }

  if (breakevenRr < 0) {
    return "Breakeven RR cannot be negative.";
  }

  if (!Number.isFinite(dailyMaxTradeSignals) || dailyMaxTradeSignals < 1) {
    return "Daily max trade signals must be at least 1.";
  }

  if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 50 || confidenceThreshold > 100) {
    return "Confidence threshold must be between 50 and 100.";
  }

  if (
    payload.self_learning_mode !== undefined &&
    !["off", "suggest_only"].includes(payload.self_learning_mode)
  ) {
    return "Self-learning mode must be off or suggest_only.";
  }

  return null;
}

function validateAssets(assets: string[]): string | null {
  if (assets.length === 0) {
    return "Name and at least one trading asset are required.";
  }
  const invalid = assets.filter((asset) => !/^[A-Z0-9._/-]{2,20}$/.test(asset));
  if (invalid.length > 0) {
    return "Trading assets must be symbols like XAUUSD, US500, BTCUSD, AUDUSD, AUDNZD, or EURUSD.";
  }
  return null;
}

export async function listStrategies(env: Env): Promise<Response> {
  try {
    const strategies = await env.DB.prepare(
      "SELECT * FROM trading_strategies ORDER BY created_at DESC",
    ).all<TradingStrategyRow>();

    return jsonResponse((strategies.results || []).map((row) => normalizeTradingStrategy(row)));
  } catch {
    return errorResponse("Failed to fetch strategies", 500);
  }
}

export async function getStrategy(env: Env, strategyId: string): Promise<Response> {
  try {
    const id = Number(strategyId);
    if (isNaN(id)) {
      return errorResponse("Invalid strategy ID", 400);
    }

    const strategy = await env.DB.prepare(
      "SELECT * FROM trading_strategies WHERE id = ?",
    )
      .bind(id)
      .first<TradingStrategyRow>();

    if (!strategy) {
      return errorResponse("Strategy not found", 404);
    }

    return jsonResponse(normalizeTradingStrategy(strategy));
  } catch {
    return errorResponse("Failed to fetch strategy", 500);
  }
}

export async function createStrategy(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<CreateStrategyPayload>(request);
    const assets = normalizeAssets(payload.assets);
    const assetsError = validateAssets(assets);
    const validationError = validateRiskFields(payload);

    if (!payload.name || !String(payload.strategy_text || "").trim() || assets.length === 0) {
      return errorResponse("Name, strategy instructions, and at least one trading asset are required.", 400);
    }
    if (assetsError) {
      return errorResponse(assetsError, 400);
    }

    if (validationError) {
      return errorResponse(validationError, 400);
    }

    const tradingHours = Array.isArray(payload.trading_hours)
      ? JSON.stringify(payload.trading_hours)
      : "[]";

    let parsedStrategyStr: string | null = null;
    if (String(payload.strategy_text || "").trim()) {
      try {
        const aiSettings = await readResolvedAiSettings(env, userId);
        if (aiSettings.geminiApiKey) {
          const parsed = await parseTradingStrategyToJSON(
            payload.strategy_text!,
            aiSettings.geminiApiKey,
            aiSettings.geminiProModel,
            aiSettings.globalAiRules,
          );
          parsedStrategyStr = JSON.stringify(parsed);
        }
      } catch (err) {
        console.error("Failed to parse strategy", err);
        parsedStrategyStr = null;
      }
    }

    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO trading_strategies (
        name,
        knowledge_base_id,
        strategy_text,
        assets,
        daily_max_trade_signals,
        strategy_type,
        risk_usd_min,
        risk_usd_max,
        rr_min,
        rr_max,
        breakeven_rr,
        max_open_positions,
        execution_mode,
        confidence_threshold,
        self_learning_mode,
        trading_hours,
        status,
        parsed_strategy,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', ?, ?, ?)`,
    )
      .bind(
        payload.name,
        null,
        String(payload.strategy_text || "").trim(),
        JSON.stringify(assets),
        payload.daily_max_trade_signals ?? 8,
        payload.strategy_type,
        payload.risk_usd_min ?? 8,
        payload.risk_usd_max ?? 17,
        payload.rr_min ?? 1.5,
        payload.rr_max ?? 2.5,
        payload.breakeven_rr ?? 1.0,
        payload.max_open_positions ?? 1,
        payload.execution_mode ?? "demo",
        payload.confidence_threshold ?? 85,
        payload.self_learning_mode ?? "suggest_only",
        tradingHours,
        parsedStrategyStr,
        now,
        now,
      )
      .run() as { meta: { last_row_id: number } };

    await env.DB.prepare(
      `INSERT INTO trading_stats (strategy_id, updated_at) VALUES (?, ?)`,
    )
      .bind(result.meta.last_row_id, now)
      .run();

    return jsonResponse(
      {
        id: result.meta.last_row_id,
        name: payload.name,
        knowledge_base_id: null,
        strategy_text: String(payload.strategy_text || "").trim(),
        assets,
        daily_max_trade_signals: payload.daily_max_trade_signals ?? 8,
        strategy_type: payload.strategy_type,
        risk_usd_min: payload.risk_usd_min ?? 8,
        risk_usd_max: payload.risk_usd_max ?? 17,
        rr_min: payload.rr_min ?? 1.5,
        rr_max: payload.rr_max ?? 2.5,
        breakeven_rr: payload.breakeven_rr ?? 1.0,
        max_open_positions: payload.max_open_positions ?? 1,
        execution_mode: payload.execution_mode ?? "demo",
        confidence_threshold: payload.confidence_threshold ?? 85,
        self_learning_mode: payload.self_learning_mode ?? "suggest_only",
        trading_hours: Array.isArray(payload.trading_hours) ? payload.trading_hours : [],
        status: "inactive",
        parsed_strategy: parsedStrategyStr ? JSON.parse(parsedStrategyStr) : null,
        created_at: now,
        updated_at: now,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to create strategy", error);
    return errorResponse(`Failed to create strategy: ${message}`, 500);
  }
}

export async function updateStrategy(
  env: Env,
  strategyId: string,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(strategyId);
    if (isNaN(id)) {
      return errorResponse("Invalid strategy ID", 400);
    }

    const payload = await parseJson<Partial<CreateStrategyPayload>>(request);
    const validationError = validateRiskFields(payload);

    if (validationError) {
      return errorResponse(validationError, 400);
    }

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.name !== undefined) {
      updates.push("name = ?");
      values.push(payload.name);
    }
    if (payload.strategy_text !== undefined) {
      const text = String(payload.strategy_text || "").trim();
      if (!text) {
        return errorResponse("Strategy instructions cannot be empty.", 400);
      }
      updates.push("strategy_text = ?");
      values.push(text);

      let parsedStrategyStr: string | null = null;
      try {
        const aiSettings = await readResolvedAiSettings(env, userId);
        if (aiSettings.geminiApiKey) {
          const parsed = await parseTradingStrategyToJSON(
            text,
            aiSettings.geminiApiKey,
            aiSettings.geminiProModel,
            aiSettings.globalAiRules,
          );
          parsedStrategyStr = JSON.stringify(parsed);
        }
      } catch (err) {
        console.error("Failed to parse strategy", err);
        parsedStrategyStr = null;
      }
      updates.push("parsed_strategy = ?");
      values.push(parsedStrategyStr);
    }
    if (payload.assets !== undefined) {
      const assets = normalizeAssets(payload.assets);
      const assetsError = validateAssets(assets);
      if (assetsError) {
        return errorResponse(assetsError, 400);
      }
      updates.push("assets = ?");
      values.push(JSON.stringify(assets));
    }
    if (payload.daily_max_trade_signals !== undefined) {
      if (!Number.isFinite(payload.daily_max_trade_signals) || payload.daily_max_trade_signals < 1) {
        return errorResponse("Daily max trade signals must be at least 1.", 400);
      }
      updates.push("daily_max_trade_signals = ?");
      values.push(payload.daily_max_trade_signals);
    }
    if (payload.strategy_type !== undefined) {
      updates.push("strategy_type = ?");
      values.push(payload.strategy_type);
    }
    if (payload.risk_usd_min !== undefined) {
      updates.push("risk_usd_min = ?");
      values.push(payload.risk_usd_min);
    }
    if (payload.risk_usd_max !== undefined) {
      updates.push("risk_usd_max = ?");
      values.push(payload.risk_usd_max);
    }
    if (payload.rr_min !== undefined) {
      updates.push("rr_min = ?");
      values.push(payload.rr_min);
    }
    if (payload.rr_max !== undefined) {
      updates.push("rr_max = ?");
      values.push(payload.rr_max);
    }
    if (payload.breakeven_rr !== undefined) {
      updates.push("breakeven_rr = ?");
      values.push(payload.breakeven_rr);
    }
    if (payload.max_open_positions !== undefined) {
      updates.push("max_open_positions = ?");
      values.push(payload.max_open_positions);
    }
    if (payload.execution_mode !== undefined) {
      updates.push("execution_mode = ?");
      values.push(payload.execution_mode);
    }
    if (payload.confidence_threshold !== undefined) {
      updates.push("confidence_threshold = ?");
      values.push(payload.confidence_threshold);
    }
    if (payload.self_learning_mode !== undefined) {
      updates.push("self_learning_mode = ?");
      values.push(payload.self_learning_mode);
    }
    if (payload.trading_hours !== undefined) {
      updates.push("trading_hours = ?");
      values.push(Array.isArray(payload.trading_hours) ? JSON.stringify(payload.trading_hours) : "[]");
    }

    if (updates.length === 0) {
      return errorResponse("No fields to update", 400);
    }

    updates.push("updated_at = ?");
    values.push(now);
    values.push(id);

    const query = `UPDATE trading_strategies SET ${updates.join(", ")} WHERE id = ?`;
    await env.DB.prepare(query).bind(...values).run();

    return jsonResponse({ success: true, updated_at: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to update strategy", error);
    return errorResponse(`Failed to update strategy: ${message}`, 500);
  }
}

export async function activateStrategy(env: Env, strategyId: string): Promise<Response> {
  try {
    const id = Number(strategyId);
    if (isNaN(id)) {
      return errorResponse("Invalid strategy ID", 400);
    }

    const existing = await env.DB.prepare("SELECT id FROM trading_strategies WHERE id = ?").bind(id).first<{ id: number }>();
    if (!existing) {
      return errorResponse("Strategy not found", 404);
    }

    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE trading_strategies SET status = 'inactive', updated_at = ? WHERE status = 'active'")
      .bind(now)
      .run();
    await env.DB.prepare("UPDATE trading_strategies SET status = 'active', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();

    const strategy = await env.DB.prepare("SELECT * FROM trading_strategies WHERE id = ?").bind(id).first<TradingStrategyRow>();
    logStrategyEvent("activated", strategy);
    return jsonResponse(normalizeTradingStrategy(strategy));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(`Failed to activate strategy: ${message}`, 500);
  }
}

export async function deactivateStrategy(env: Env, strategyId: string): Promise<Response> {
  try {
    const id = Number(strategyId);
    if (isNaN(id)) {
      return errorResponse("Invalid strategy ID", 400);
    }

    const strategy = await env.DB.prepare("SELECT * FROM trading_strategies WHERE id = ?").bind(id).first<TradingStrategyRow>();
    if (!strategy) {
      return errorResponse("Strategy not found", 404);
    }

    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE trading_strategies SET status = 'inactive', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();

    const updated = await env.DB.prepare("SELECT * FROM trading_strategies WHERE id = ?").bind(id).first<TradingStrategyRow>();
    logStrategyEvent("deactivated", updated);
    return jsonResponse(normalizeTradingStrategy(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(`Failed to deactivate strategy: ${message}`, 500);
  }
}

export async function getActiveStrategyInternal(env: Env): Promise<Response> {
  try {
    const strategy = await env.DB.prepare(
      "SELECT * FROM trading_strategies WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1",
    ).first<TradingStrategyRow>();
    logStrategyEvent("internal_active_strategy_read", strategy);
    return jsonResponse(normalizeTradingStrategyForInternal(strategy));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(`Failed to fetch active strategy: ${message}`, 500);
  }
}

export async function deleteStrategy(env: Env, strategyId: string): Promise<Response> {
  try {
    const id = Number(strategyId);
    if (isNaN(id)) {
      return errorResponse("Invalid strategy ID", 400);
    }

    await env.DB.prepare("DELETE FROM trading_strategies WHERE id = ?").bind(id).run();

    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete strategy", 500);
  }
}

export async function getStrategyStats(env: Env, strategyId: string): Promise<Response> {
  try {
    const id = Number(strategyId);
    if (isNaN(id)) {
      return errorResponse("Invalid strategy ID", 400);
    }

    const stats = await env.DB.prepare(
      "SELECT * FROM trading_stats WHERE strategy_id = ?",
    )
      .bind(id)
      .first();

    if (!stats) {
      return jsonResponse({
        strategy_id: id,
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        win_rate: 0,
        total_pips: 0,
        avg_pips_per_trade: 0,
        max_consecutive_wins: 0,
        max_consecutive_losses: 0,
        largest_win_pips: 0,
        largest_loss_pips: 0,
      });
    }

    return jsonResponse(stats);
  } catch {
    return errorResponse("Failed to fetch strategy stats", 500);
  }
}

export async function getStrategyExecutions(
  env: Env,
  strategyId: string,
): Promise<Response> {
  try {
    const id = Number(strategyId);
    if (isNaN(id)) {
      return errorResponse("Invalid strategy ID", 400);
    }

    const executions = await env.DB.prepare(
      "SELECT * FROM trading_executions WHERE strategy_id = ? ORDER BY entry_time DESC LIMIT 50",
    )
      .bind(id)
      .all();

    return jsonResponse(executions.results || []);
  } catch {
    return errorResponse("Failed to fetch executions", 500);
  }
}
