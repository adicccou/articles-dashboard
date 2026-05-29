import type { Env } from "../lib/types";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";

type ExperimentStatus = "observing" | "applied" | "rejected" | "expired";

type LearningExperimentRow = {
  id: number;
  suggestion_key: string;
  factor: string;
  current_value: string;
  recommended_value: string;
  impact: string;
  evidence: string;
  expected_winrate: string;
  status: ExperimentStatus;
  baseline_win_rate: number | null;
  candidate_win_rate: number | null;
  baseline_profit_factor: number | null;
  candidate_profit_factor: number | null;
  baseline_trades: number;
  candidate_trades: number;
  avoided_losers: number;
  skipped_winners: number;
  notes: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

type CreateExperimentPayload = {
  factor?: string;
  current?: string;
  recommended?: string;
  impact?: string;
  evidence?: string;
  expected_winrate?: string;
  baseline_win_rate?: number;
  baseline_profit_factor?: number;
  baseline_trades?: number;
};

type UpdateExperimentPayload = {
  status?: ExperimentStatus;
  candidate_win_rate?: number | null;
  candidate_profit_factor?: number | null;
  candidate_trades?: number;
  avoided_losers?: number;
  skipped_winners?: number;
  notes?: string;
};

function normalizeKey(factor: string, current: string, recommended: string) {
  return [factor, current, recommended]
    .map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .join(":");
}

function isMissingTable(error: unknown) {
  return error instanceof Error && /no such table: ml_learning_experiments/i.test(error.message);
}

export async function listLearningExperiments(env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      `SELECT * FROM ml_learning_experiments
       ORDER BY CASE status WHEN 'observing' THEN 0 WHEN 'applied' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
                updated_at DESC
       LIMIT 25`,
    ).all<LearningExperimentRow>();

    return jsonResponse(rows.results || []);
  } catch (error) {
    if (isMissingTable(error)) return jsonResponse([]);
    return errorResponse("Failed to fetch ML learning experiments", 500);
  }
}

export async function createLearningExperiment(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<CreateExperimentPayload>(request);
    const factor = String(payload.factor || "").trim();
    const current = String(payload.current || "").trim();
    const recommended = String(payload.recommended || "").trim();

    if (!factor || !current || !recommended) {
      return errorResponse("Factor, current value, and recommended value are required.", 400);
    }

    const now = new Date().toISOString();
    const suggestionKey = normalizeKey(factor, current, recommended);

    await env.DB.prepare(
      `INSERT INTO ml_learning_experiments (
        suggestion_key, factor, current_value, recommended_value, impact, evidence, expected_winrate,
        status, baseline_win_rate, baseline_profit_factor, baseline_trades, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'observing', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(suggestion_key) DO UPDATE SET
        impact = excluded.impact,
        evidence = excluded.evidence,
        expected_winrate = excluded.expected_winrate,
        baseline_win_rate = COALESCE(ml_learning_experiments.baseline_win_rate, excluded.baseline_win_rate),
        baseline_profit_factor = COALESCE(ml_learning_experiments.baseline_profit_factor, excluded.baseline_profit_factor),
        baseline_trades = CASE WHEN ml_learning_experiments.baseline_trades > 0 THEN ml_learning_experiments.baseline_trades ELSE excluded.baseline_trades END,
        updated_at = excluded.updated_at`,
    )
      .bind(
        suggestionKey,
        factor,
        current,
        recommended,
        String(payload.impact || "LOW").trim().toUpperCase(),
        String(payload.evidence || "").trim(),
        String(payload.expected_winrate || "").trim(),
        Number.isFinite(payload.baseline_win_rate) ? payload.baseline_win_rate : null,
        Number.isFinite(payload.baseline_profit_factor) ? payload.baseline_profit_factor : null,
        Number.isFinite(payload.baseline_trades) ? Math.max(0, Math.trunc(payload.baseline_trades || 0)) : 0,
        now,
        now,
        now,
      )
      .run();

    const row = await env.DB.prepare("SELECT * FROM ml_learning_experiments WHERE suggestion_key = ?")
      .bind(suggestionKey)
      .first<LearningExperimentRow>();

    return jsonResponse(row, { status: 201 });
  } catch (error) {
    if (isMissingTable(error)) return errorResponse("Run migrations before tracking ML learning experiments.", 409);
    return errorResponse("Failed to create ML learning experiment", 500);
  }
}

export async function updateLearningExperiment(env: Env, experimentId: string, request: Request): Promise<Response> {
  try {
    const id = Number(experimentId);
    if (!Number.isFinite(id)) return errorResponse("Invalid experiment ID", 400);

    const payload = await parseJson<UpdateExperimentPayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    const now = new Date().toISOString();

    if (payload.status !== undefined) {
      if (!["observing", "applied", "rejected", "expired"].includes(payload.status)) {
        return errorResponse("Invalid experiment status", 400);
      }
      updates.push("status = ?");
      values.push(payload.status);
      updates.push("ended_at = ?");
      values.push(payload.status === "observing" ? null : now);
    }
    for (const [field, value] of [
      ["candidate_win_rate", payload.candidate_win_rate],
      ["candidate_profit_factor", payload.candidate_profit_factor],
      ["candidate_trades", payload.candidate_trades],
      ["avoided_losers", payload.avoided_losers],
      ["skipped_winners", payload.skipped_winners],
    ] as const) {
      if (value !== undefined) {
        updates.push(`${field} = ?`);
        values.push(value === null ? null : Number(value));
      }
    }
    if (payload.notes !== undefined) {
      updates.push("notes = ?");
      values.push(String(payload.notes || "").trim());
    }

    if (updates.length === 0) return errorResponse("No experiment fields to update", 400);

    updates.push("updated_at = ?");
    values.push(now, id);

    await env.DB.prepare(`UPDATE ml_learning_experiments SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    const row = await env.DB.prepare("SELECT * FROM ml_learning_experiments WHERE id = ?")
      .bind(id)
      .first<LearningExperimentRow>();

    if (!row) return errorResponse("Experiment not found", 404);
    return jsonResponse(row);
  } catch (error) {
    if (isMissingTable(error)) return errorResponse("Run migrations before updating ML learning experiments.", 409);
    return errorResponse("Failed to update ML learning experiment", 500);
  }
}
