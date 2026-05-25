import { jsonResponse, errorResponse, parseJson } from "../lib/http";
import { DEFAULT_USER_ID, appendScopedFilter, scopedInsertColumns } from "../lib/ownership";
import type { Env } from "../lib/types";

interface PlannerItemPayload {
  title: string;
  description?: string | null;
  image_url?: string | null;
  item_type?: "post" | "campaign";
  platform: string;
  status?: "planned" | "drafting" | "approved" | "published" | "archived";
  scheduled_for?: string | null;
  social_post_id?: number | null;
  account_id?: number | null;
  instruction?: string | null;
  interval_minutes?: number | null;
  duration_start?: string | null;
  duration_end?: string | null;
  related_strategy_id?: number | null;
}

interface TradingNotePayload {
  strategy_id?: number | null;
  title: string;
  content: string;
  note_type?: "analysis" | "idea" | "review" | "risk";
}

export async function plannerHasSocialPostLinks(env: Env): Promise<boolean> {
  try {
    const columns = await env.DB.prepare("PRAGMA table_info(planner_items)").all<{ name: string }>();
    return (columns.results ?? []).some((column) => column.name === "social_post_id");
  } catch {
    return false;
  }
}

export async function plannerHasImageUrl(env: Env): Promise<boolean> {
  try {
    const columns = await env.DB.prepare("PRAGMA table_info(planner_items)").all<{ name: string }>();
    return (columns.results ?? []).some((column) => column.name === "image_url");
  } catch {
    return false;
  }
}

export async function listPlannerItems(env: Env, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const hasSocialPostLinks = await plannerHasSocialPostLinks(env);
    const hasImageUrl = await plannerHasImageUrl(env);
    const filters: string[] = [];
    const values: unknown[] = [];
    await appendScopedFilter(env, "planner_items", filters, values, userId, "pi");
    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const items = await env.DB.prepare(
      `
        SELECT
          pi.id,
          pi.title,
          pi.description,
          ${hasImageUrl ? "pi.image_url" : "NULL AS image_url"},
          pi.item_type,
          pi.platform,
          pi.status,
          pi.scheduled_for,
          ${hasSocialPostLinks ? "pi.social_post_id" : "NULL AS social_post_id"},
          pi.account_id,
          pi.instruction,
          pi.interval_minutes,
          pi.duration_start,
          pi.duration_end,
          pi.related_strategy_id,
          ts.name AS related_strategy_name,
          pi.created_by,
          pi.created_at,
          pi.updated_at
        FROM planner_items pi
        LEFT JOIN trading_strategies ts ON ts.id = pi.related_strategy_id
        ${whereClause}
        ORDER BY
          CASE WHEN pi.scheduled_for IS NULL THEN 1 ELSE 0 END,
          pi.scheduled_for ASC,
          pi.created_at DESC
      `,
    ).bind(...values).all();

    return jsonResponse(items.results ?? []);
  } catch {
    return errorResponse("Failed to fetch planner items", 500);
  }
}

export async function createPlannerItem(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<PlannerItemPayload>(request);
    if (!payload.title?.trim() || !payload.platform?.trim()) {
      return errorResponse("Title and platform are required", 400);
    }

    const now = new Date().toISOString();
    const hasSocialPostLinks = await plannerHasSocialPostLinks(env);
    const hasImageUrl = await plannerHasImageUrl(env);
    const scoped = await scopedInsertColumns(env, "planner_items", userId);
    const item = hasSocialPostLinks
      ? await env.DB.prepare(
        `
        INSERT INTO planner_items (
          ${scoped.columns.length ? "user_id," : ""}
          title,
          description,
          ${hasImageUrl ? "image_url," : ""}
          item_type,
          platform,
          status,
          scheduled_for,
          social_post_id,
          account_id,
          instruction,
          interval_minutes,
          duration_start,
          duration_end,
          related_strategy_id,
          created_by,
          created_at,
          updated_at
        )
        VALUES (${scoped.columns.length ? "?," : ""}?, ?, ${hasImageUrl ? "?, " : ""}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
        RETURNING id, title, description, ${hasImageUrl ? "image_url," : "NULL AS image_url,"} item_type, platform, status, scheduled_for, social_post_id, account_id, instruction, interval_minutes, duration_start, duration_end, related_strategy_id, created_by, created_at, updated_at
      `,
      )
        .bind(
          ...scoped.values,
          payload.title.trim(),
          payload.description?.trim() || null,
          ...(hasImageUrl ? [payload.image_url?.trim() || null] : []),
          payload.item_type ?? "post",
          payload.platform.trim(),
          payload.status ?? "planned",
          payload.scheduled_for ?? null,
          payload.social_post_id ?? null,
          payload.account_id ?? null,
          payload.instruction?.trim() || null,
          payload.interval_minutes ?? null,
          payload.duration_start ?? null,
          payload.duration_end ?? null,
          payload.related_strategy_id ?? null,
          now,
          now,
        )
        .first()
      : await env.DB.prepare(
        `
        INSERT INTO planner_items (
          ${scoped.columns.length ? "user_id," : ""}
          title,
          description,
          ${hasImageUrl ? "image_url," : ""}
          item_type,
          platform,
          status,
          scheduled_for,
          account_id,
          instruction,
          interval_minutes,
          duration_start,
          duration_end,
          related_strategy_id,
          created_by,
          created_at,
          updated_at
        )
        VALUES (${scoped.columns.length ? "?," : ""}?, ?, ${hasImageUrl ? "?, " : ""}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
        RETURNING id, title, description, ${hasImageUrl ? "image_url," : "NULL AS image_url,"} item_type, platform, status, scheduled_for, NULL AS social_post_id, account_id, instruction, interval_minutes, duration_start, duration_end, related_strategy_id, created_by, created_at, updated_at
      `,
      )
        .bind(
          ...scoped.values,
          payload.title.trim(),
          payload.description?.trim() || null,
          ...(hasImageUrl ? [payload.image_url?.trim() || null] : []),
          payload.item_type ?? "post",
          payload.platform.trim(),
          payload.status ?? "planned",
          payload.scheduled_for ?? null,
          payload.account_id ?? null,
          payload.instruction?.trim() || null,
          payload.interval_minutes ?? null,
          payload.duration_start ?? null,
          payload.duration_end ?? null,
          payload.related_strategy_id ?? null,
          now,
          now,
        )
        .first();

    return jsonResponse(item, { status: 201 });
  } catch {
    return errorResponse("Failed to create planner item", 500);
  }
}

export async function updatePlannerItem(
  env: Env,
  plannerItemId: string,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(plannerItemId);
    if (Number.isNaN(id)) {
      return errorResponse("Invalid planner item ID", 400);
    }

    const payload = await parseJson<Partial<PlannerItemPayload>>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    const hasSocialPostLinks = await plannerHasSocialPostLinks(env);
    const hasImageUrl = await plannerHasImageUrl(env);

    if (payload.title !== undefined) {
      updates.push("title = ?");
      values.push(payload.title.trim());
    }
    if (payload.description !== undefined) {
      updates.push("description = ?");
      values.push(payload.description?.trim() || null);
    }
    if (payload.image_url !== undefined && hasImageUrl) {
      updates.push("image_url = ?");
      values.push(payload.image_url?.trim() || null);
    }
    if (payload.item_type !== undefined) {
      updates.push("item_type = ?");
      values.push(payload.item_type);
    }
    if (payload.platform !== undefined) {
      updates.push("platform = ?");
      values.push(payload.platform.trim());
    }
    if (payload.status !== undefined) {
      updates.push("status = ?");
      values.push(payload.status);
    }
    if (payload.scheduled_for !== undefined) {
      updates.push("scheduled_for = ?");
      values.push(payload.scheduled_for);
    }
    if (payload.social_post_id !== undefined && hasSocialPostLinks) {
      updates.push("social_post_id = ?");
      values.push(payload.social_post_id);
    }
    if (payload.account_id !== undefined) {
      updates.push("account_id = ?");
      values.push(payload.account_id);
    }
    if (payload.instruction !== undefined) {
      updates.push("instruction = ?");
      values.push(payload.instruction?.trim() || null);
    }
    if (payload.interval_minutes !== undefined) {
      updates.push("interval_minutes = ?");
      values.push(payload.interval_minutes);
    }
    if (payload.duration_start !== undefined) {
      updates.push("duration_start = ?");
      values.push(payload.duration_start);
    }
    if (payload.duration_end !== undefined) {
      updates.push("duration_end = ?");
      values.push(payload.duration_end);
    }
    if (payload.related_strategy_id !== undefined) {
      updates.push("related_strategy_id = ?");
      values.push(payload.related_strategy_id);
    }

    if (updates.length === 0) {
      return errorResponse("No planner item fields to update", 400);
    }

    const now = new Date().toISOString();
    updates.push("updated_at = ?");
    values.push(now);
    const filters = ["id = ?"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "planner_items", filters, filterValues, userId);

    await env.DB.prepare(
      `UPDATE planner_items SET ${updates.join(", ")} WHERE ${filters.join(" AND ")}`,
    )
      .bind(...values, ...filterValues)
      .run();

    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update planner item", 500);
  }
}

export async function deletePlannerItem(env: Env, plannerItemId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(plannerItemId);
    if (Number.isNaN(id)) {
      return errorResponse("Invalid planner item ID", 400);
    }

    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "planner_items", filters, values, userId);
    await env.DB.prepare(`DELETE FROM planner_items WHERE ${filters.join(" AND ")}`).bind(...values).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete planner item", 500);
  }
}

export async function listTradingNotes(env: Env): Promise<Response> {
  try {
    const notes = await env.DB.prepare(
      `
        SELECT
          tn.id,
          tn.strategy_id,
          ts.name AS strategy_name,
          tn.title,
          tn.content,
          tn.note_type,
          tn.created_by,
          tn.created_at,
          tn.updated_at
        FROM trading_notes tn
        LEFT JOIN trading_strategies ts ON ts.id = tn.strategy_id
        ORDER BY tn.created_at DESC
        LIMIT 50
      `,
    ).all();

    return jsonResponse(notes.results ?? []);
  } catch {
    return errorResponse("Failed to fetch trading notes", 500);
  }
}

export async function createTradingNote(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<TradingNotePayload>(request);
    if (!payload.title?.trim() || !payload.content?.trim()) {
      return errorResponse("Title and content are required", 400);
    }

    const now = new Date().toISOString();
    const note = await env.DB.prepare(
      `
        INSERT INTO trading_notes (
          strategy_id,
          title,
          content,
          note_type,
          created_by,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, 'manual', ?, ?)
        RETURNING id, strategy_id, title, content, note_type, created_by, created_at, updated_at
      `,
    )
      .bind(
        payload.strategy_id ?? null,
        payload.title.trim(),
        payload.content.trim(),
        payload.note_type ?? "analysis",
        now,
        now,
      )
      .first();

    return jsonResponse(note, { status: 201 });
  } catch {
    return errorResponse("Failed to create trading note", 500);
  }
}

export async function updateTradingNote(
  env: Env,
  tradingNoteId: string,
  request: Request,
): Promise<Response> {
  try {
    const id = Number(tradingNoteId);
    if (Number.isNaN(id)) {
      return errorResponse("Invalid trading note ID", 400);
    }

    const payload = await parseJson<Partial<TradingNotePayload>>(request);
    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.strategy_id !== undefined) {
      updates.push("strategy_id = ?");
      values.push(payload.strategy_id);
    }
    if (payload.title !== undefined) {
      updates.push("title = ?");
      values.push(payload.title.trim());
    }
    if (payload.content !== undefined) {
      updates.push("content = ?");
      values.push(payload.content.trim());
    }
    if (payload.note_type !== undefined) {
      updates.push("note_type = ?");
      values.push(payload.note_type);
    }

    if (updates.length === 0) {
      return errorResponse("No trading note fields to update", 400);
    }

    const now = new Date().toISOString();
    updates.push("updated_at = ?");
    values.push(now, id);

    await env.DB.prepare(
      `UPDATE trading_notes SET ${updates.join(", ")} WHERE id = ?`,
    )
      .bind(...values)
      .run();

    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update trading note", 500);
  }
}

export async function deleteTradingNote(env: Env, tradingNoteId: string): Promise<Response> {
  try {
    const id = Number(tradingNoteId);
    if (Number.isNaN(id)) {
      return errorResponse("Invalid trading note ID", 400);
    }

    await env.DB.prepare("DELETE FROM trading_notes WHERE id = ?").bind(id).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete trading note", 500);
  }
}
