import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import type { Env } from "../lib/types";

type ThreadsCampaignResultPayload = {
  campaign_id: number;
  account_id?: number | null;
  search_query: string;
  results: Array<{
    media_id: string;
    username?: string | null;
    media_text?: string | null;
    permalink?: string | null;
    media_type?: string | null;
    published_at?: string | null;
    suggested_reply?: string | null;
    suggested_post?: string | null;
    suggestion_reason?: string | null;
  }>;
};

type ThreadsCampaignResultUpdatePayload = {
  review_status?: "new" | "reviewed" | "dismissed" | "replied" | "drafted";
  suggested_reply?: string | null;
  suggested_post?: string | null;
  suggestion_reason?: string | null;
};

export async function listThreadsCampaignResults(env: Env, url: URL): Promise<Response> {
  try {
    const campaignId = url.searchParams.get("campaign_id");
    const status = url.searchParams.get("status");
    const filters: string[] = [];
    const values: unknown[] = [];

    if (campaignId) {
      const id = Number(campaignId);
      if (Number.isNaN(id)) return errorResponse("Invalid campaign ID", 400);
      filters.push("tcr.campaign_id = ?");
      values.push(id);
    }

    if (status) {
      filters.push("tcr.review_status = ?");
      values.push(status);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await env.DB.prepare(
      `
        SELECT
          tcr.id,
          tcr.campaign_id,
          tcr.account_id,
          pi.title AS campaign_title,
          tcr.search_query,
          tcr.media_id,
          tcr.username,
          tcr.media_text,
          tcr.permalink,
          tcr.media_type,
          tcr.published_at,
          tcr.review_status,
          tcr.suggested_reply,
          tcr.suggested_post,
          tcr.suggestion_reason,
          tcr.created_at,
          tcr.updated_at
        FROM threads_campaign_results tcr
        LEFT JOIN planner_items pi ON pi.id = tcr.campaign_id
        ${whereClause}
        ORDER BY tcr.created_at DESC
        LIMIT 100
      `,
    )
      .bind(...values)
      .all();

    return jsonResponse(rows.results ?? []);
  } catch {
    return errorResponse("Failed to load Threads campaign results", 500);
  }
}

export async function upsertThreadsCampaignResults(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<ThreadsCampaignResultPayload>(request);
    const campaignId = Number(payload.campaign_id);
    if (Number.isNaN(campaignId)) return errorResponse("campaign_id is required", 400);
    if (!payload.search_query?.trim()) return errorResponse("search_query is required", 400);
    if (!Array.isArray(payload.results) || payload.results.length === 0) {
      return errorResponse("At least one result is required", 400);
    }

    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;

    for (const result of payload.results) {
      const mediaId = result.media_id?.trim();
      if (!mediaId) continue;

      const existing = await env.DB.prepare(
        "SELECT id FROM threads_campaign_results WHERE campaign_id = ? AND media_id = ?",
      )
        .bind(campaignId, mediaId)
        .first<{ id: number }>();

      if (existing?.id) {
        await env.DB.prepare(
          `
            UPDATE threads_campaign_results
            SET
              account_id = ?,
              search_query = ?,
              username = ?,
              media_text = ?,
              permalink = ?,
              media_type = ?,
              published_at = ?,
              suggested_reply = COALESCE(?, suggested_reply),
              suggested_post = COALESCE(?, suggested_post),
              suggestion_reason = COALESCE(?, suggestion_reason),
              updated_at = ?
            WHERE id = ?
          `,
        )
          .bind(
            payload.account_id ?? null,
            payload.search_query.trim(),
            result.username?.trim() || null,
            result.media_text?.trim() || null,
            result.permalink?.trim() || null,
            result.media_type?.trim() || null,
            result.published_at?.trim() || null,
            result.suggested_reply?.trim() || null,
            result.suggested_post?.trim() || null,
            result.suggestion_reason?.trim() || null,
            now,
            existing.id,
          )
          .run();
        updated += 1;
      } else {
        await env.DB.prepare(
          `
            INSERT INTO threads_campaign_results (
              campaign_id,
              account_id,
              search_query,
              media_id,
              username,
              media_text,
              permalink,
              media_type,
              published_at,
              suggested_reply,
              suggested_post,
              suggestion_reason,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
          .bind(
            campaignId,
            payload.account_id ?? null,
            payload.search_query.trim(),
            mediaId,
            result.username?.trim() || null,
            result.media_text?.trim() || null,
            result.permalink?.trim() || null,
            result.media_type?.trim() || null,
            result.published_at?.trim() || null,
            result.suggested_reply?.trim() || null,
            result.suggested_post?.trim() || null,
            result.suggestion_reason?.trim() || null,
            now,
            now,
          )
          .run();
        inserted += 1;
      }
    }

    return jsonResponse({ success: true, inserted, updated, updated_at: now });
  } catch {
    return errorResponse("Failed to save Threads campaign results", 500);
  }
}

export async function updateThreadsCampaignResult(
  env: Env,
  resultId: string,
  request: Request,
): Promise<Response> {
  try {
    const id = Number(resultId);
    if (Number.isNaN(id)) return errorResponse("Invalid result ID", 400);

    const payload = await parseJson<ThreadsCampaignResultUpdatePayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.review_status !== undefined) {
      updates.push("review_status = ?");
      values.push(payload.review_status);
    }
    if (payload.suggested_reply !== undefined) {
      updates.push("suggested_reply = ?");
      values.push(payload.suggested_reply?.trim() || null);
    }
    if (payload.suggested_post !== undefined) {
      updates.push("suggested_post = ?");
      values.push(payload.suggested_post?.trim() || null);
    }
    if (payload.suggestion_reason !== undefined) {
      updates.push("suggestion_reason = ?");
      values.push(payload.suggestion_reason?.trim() || null);
    }

    if (updates.length === 0) return errorResponse("No result fields to update", 400);

    const now = new Date().toISOString();
    updates.push("updated_at = ?");
    values.push(now, id);

    await env.DB.prepare(
      `UPDATE threads_campaign_results SET ${updates.join(", ")} WHERE id = ?`,
    )
      .bind(...values)
      .run();

    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Threads campaign result", 500);
  }
}
