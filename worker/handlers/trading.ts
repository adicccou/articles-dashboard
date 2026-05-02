import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";

interface CreateStrategyPayload {
  name: string;
  description?: string;
  ctrader_login: string;
  ctrader_password: string;
  ctrader_account_id: string;
  ctrader_server?: string;
  symbol: string;
  strategy_type: "scalping" | "daytrading" | "swing" | "position";
  lot_size?: number;
  stop_loss_pips?: number;
  take_profit_pips?: number;
  max_open_positions?: number;
  claude_instructions?: string;
  telegram_chat_id?: string;
}

export async function listStrategies(env: Env): Promise<Response> {
  try {
    const strategies = await env.DB.prepare(
      "SELECT * FROM trading_strategies ORDER BY created_at DESC",
    ).all();

    return jsonResponse(strategies.results || []);
  } catch (error) {
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
      .first();

    if (!strategy) {
      return errorResponse("Strategy not found", 404);
    }

    return jsonResponse(strategy);
  } catch (error) {
    return errorResponse("Failed to fetch strategy", 500);
  }
}

export async function createStrategy(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<CreateStrategyPayload>(request);

    if (!payload.name || !payload.ctrader_login || !payload.symbol) {
      return errorResponse("Missing required fields", 400);
    }

    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO trading_strategies (
        name,
        description,
        ctrader_login,
        ctrader_password,
        ctrader_account_id,
        ctrader_server,
        symbol,
        strategy_type,
        lot_size,
        stop_loss_pips,
        take_profit_pips,
        max_open_positions,
        claude_instructions,
        telegram_chat_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', ?, ?)`,
    )
      .bind(
        payload.name,
        payload.description || "",
        payload.ctrader_login,
        payload.ctrader_password,
        payload.ctrader_account_id,
        payload.ctrader_server || "",
        payload.symbol,
        payload.strategy_type,
        payload.lot_size || 0.1,
        payload.stop_loss_pips || null,
        payload.take_profit_pips || null,
        payload.max_open_positions || 1,
        payload.claude_instructions || "",
        payload.telegram_chat_id || "",
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
        ...payload,
        status: "inactive",
        created_at: now,
        updated_at: now,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse("Failed to create strategy", 500);
  }
}

export async function updateStrategy(
  env: Env,
  strategyId: string,
  request: Request,
): Promise<Response> {
  try {
    const id = Number(strategyId);
    if (isNaN(id)) {
      return errorResponse("Invalid strategy ID", 400);
    }

    const payload = await parseJson<Partial<CreateStrategyPayload>>(request);
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.name !== undefined) {
      updates.push("name = ?");
      values.push(payload.name);
    }
    if (payload.description !== undefined) {
      updates.push("description = ?");
      values.push(payload.description);
    }
    if (payload.symbol !== undefined) {
      updates.push("symbol = ?");
      values.push(payload.symbol);
    }
    if (payload.strategy_type !== undefined) {
      updates.push("strategy_type = ?");
      values.push(payload.strategy_type);
    }
    if (payload.lot_size !== undefined) {
      updates.push("lot_size = ?");
      values.push(payload.lot_size);
    }
    if (payload.stop_loss_pips !== undefined) {
      updates.push("stop_loss_pips = ?");
      values.push(payload.stop_loss_pips);
    }
    if (payload.take_profit_pips !== undefined) {
      updates.push("take_profit_pips = ?");
      values.push(payload.take_profit_pips);
    }
    if (payload.max_open_positions !== undefined) {
      updates.push("max_open_positions = ?");
      values.push(payload.max_open_positions);
    }
    if (payload.claude_instructions !== undefined) {
      updates.push("claude_instructions = ?");
      values.push(payload.claude_instructions);
    }
    if (payload.telegram_chat_id !== undefined) {
      updates.push("telegram_chat_id = ?");
      values.push(payload.telegram_chat_id);
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
    return errorResponse("Failed to update strategy", 500);
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
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
    return errorResponse("Failed to fetch executions", 500);
  }
}
