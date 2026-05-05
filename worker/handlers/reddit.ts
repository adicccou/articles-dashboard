import type { Env } from "../lib/types";
import type { RedditCampaign } from "../../src/lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";

interface CreateCampaignPayload {
  name: string;
  description?: string;
  reddit_account_id: number;
  subreddit: string;
  search_query: string;
  search_criteria: Record<string, unknown>;
  agent_instructions: string;
  batch_size?: number;
  batch_window_hours?: number;
  throttle_enabled?: boolean;
  throttle_interval_minutes?: number;
  start_at?: string | null;
  end_at?: string | null;
  telegram_chat_id?: string;
}

export async function listCampaigns(env: Env): Promise<Response> {
  try {
    const campaigns = await env.DB.prepare(
      "SELECT * FROM reddit_campaigns ORDER BY created_at DESC",
    ).all();

    return jsonResponse(campaigns.results || []);
  } catch (error) {
    return errorResponse("Failed to fetch campaigns", 500);
  }
}

export async function createCampaign(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<CreateCampaignPayload>(request);

    // Validate required fields
    if (!payload.name || !payload.subreddit || !payload.search_query) {
      return errorResponse("Missing required fields", 400);
    }

    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO reddit_campaigns (
        reddit_account_id,
        name,
        description,
        subreddit,
        search_query,
        search_criteria,
        agent_instructions,
        batch_size,
        batch_window_hours,
        throttle_enabled,
        throttle_interval_minutes,
        start_at,
        end_at,
        telegram_chat_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
      .bind(
        payload.reddit_account_id,
        payload.name,
        payload.description || "",
        payload.subreddit,
        payload.search_query,
        JSON.stringify(payload.search_criteria),
        payload.agent_instructions,
        payload.batch_size || 10,
        payload.batch_window_hours || 24,
        payload.throttle_enabled ? 1 : 0,
        payload.throttle_interval_minutes || 60,
        payload.start_at || null,
        payload.end_at || null,
        payload.telegram_chat_id || "",
        now,
        now,
      )
      .run() as { meta: { last_row_id: number } };

    return jsonResponse(
      {
        id: result.meta.last_row_id,
        ...payload,
        status: "active",
        created_at: now,
        updated_at: now,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse("Failed to create campaign", 500);
  }
}

export async function updateCampaign(
  env: Env,
  campaignId: string,
  request: Request,
): Promise<Response> {
  try {
    const id = Number(campaignId);
    if (isNaN(id)) {
      return errorResponse("Invalid campaign ID", 400);
    }

    const payload = await parseJson<Partial<CreateCampaignPayload>>(request);
    const now = new Date().toISOString();

    // Build dynamic update query
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
    if (payload.subreddit !== undefined) {
      updates.push("subreddit = ?");
      values.push(payload.subreddit);
    }
    if (payload.search_query !== undefined) {
      updates.push("search_query = ?");
      values.push(payload.search_query);
    }
    if (payload.agent_instructions !== undefined) {
      updates.push("agent_instructions = ?");
      values.push(payload.agent_instructions);
    }
    if (payload.reddit_account_id !== undefined) {
      updates.push("reddit_account_id = ?");
      values.push(payload.reddit_account_id);
    }
    if (payload.batch_size !== undefined) {
      updates.push("batch_size = ?");
      values.push(payload.batch_size);
    }
    if (payload.batch_window_hours !== undefined) {
      updates.push("batch_window_hours = ?");
      values.push(payload.batch_window_hours);
    }
    if (payload.throttle_enabled !== undefined) {
      updates.push("throttle_enabled = ?");
      values.push(payload.throttle_enabled ? 1 : 0);
    }
    if (payload.throttle_interval_minutes !== undefined) {
      updates.push("throttle_interval_minutes = ?");
      values.push(payload.throttle_interval_minutes);
    }
    if (payload.start_at !== undefined) {
      updates.push("start_at = ?");
      values.push(payload.start_at);
    }
    if (payload.end_at !== undefined) {
      updates.push("end_at = ?");
      values.push(payload.end_at);
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

    const query = `UPDATE reddit_campaigns SET ${updates.join(", ")} WHERE id = ?`;
    await env.DB.prepare(query).bind(...values).run();

    return jsonResponse({ success: true, updated_at: now });
  } catch (error) {
    return errorResponse("Failed to update campaign", 500);
  }
}

export async function deleteCampaign(env: Env, campaignId: string): Promise<Response> {
  try {
    const id = Number(campaignId);
    if (isNaN(id)) {
      return errorResponse("Invalid campaign ID", 400);
    }

    await env.DB.prepare("DELETE FROM reddit_campaigns WHERE id = ?").bind(id).run();

    return jsonResponse({ success: true });
  } catch (error) {
    return errorResponse("Failed to delete campaign", 500);
  }
}

export async function getCampaignStats(env: Env, campaignId: string): Promise<Response> {
  try {
    const id = Number(campaignId);
    if (isNaN(id)) {
      return errorResponse("Invalid campaign ID", 400);
    }

    const stats = await env.DB.prepare(
      `SELECT
        COUNT(*) as total_found,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied
      FROM reddit_comments WHERE campaign_id = ?`,
    )
      .bind(id)
      .first();

    return jsonResponse(stats || { total_found: 0, approved: 0, replied: 0 });
  } catch (error) {
    return errorResponse("Failed to fetch campaign stats", 500);
  }
}
