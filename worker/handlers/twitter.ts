import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";

type TwitterAccountPayload = {
  username: string;
  api_key: string;
  api_secret: string;
  access_token: string;
  access_secret: string;
};

async function upsertSetting(env: Env, key: string, value: string, updatedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, updatedAt)
    .run();
}

// ------------------------------------------------------------------ social posts

export async function listSocialPosts(env: Env, platform: string): Promise<Response> {
  try {
    const posts = await env.DB.prepare(
      "SELECT * FROM social_posts WHERE platform = ? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(platform)
      .all();
    return jsonResponse(posts.results ?? []);
  } catch {
    return errorResponse("Failed to list posts", 500);
  }
}

export async function createSocialPost(env: Env, platform: string, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<{ content: string; scheduled_at?: string }>(request);
    if (!payload.content?.trim()) {
      return errorResponse("content is required", 400);
    }
    const now = new Date().toISOString();
    const status = payload.scheduled_at ? "scheduled" : "draft";
    const result = await env.DB.prepare(
      `INSERT INTO social_posts (platform, content, status, scheduled_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'dashboard', ?, ?)`,
    )
      .bind(platform, payload.content.trim(), status, payload.scheduled_at ?? null, now, now)
      .run() as { meta: { last_row_id: number } };

    return jsonResponse({
      id: result.meta.last_row_id,
      platform,
      content: payload.content.trim(),
      status,
      scheduled_at: payload.scheduled_at ?? null,
      posted_at: null,
      external_id: null,
      created_by: "dashboard",
      created_at: now,
      updated_at: now,
    }, { status: 201 });
  } catch {
    return errorResponse("Failed to create post", 500);
  }
}

export async function updateSocialPost(env: Env, postId: string, request: Request): Promise<Response> {
  try {
    const id = Number(postId);
    if (isNaN(id)) return errorResponse("Invalid post ID", 400);
    const payload = await parseJson<{ content?: string; status?: string; scheduled_at?: string }>(request);
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.content !== undefined) { updates.push("content = ?"); values.push(payload.content); }
    if (payload.status !== undefined) { updates.push("status = ?"); values.push(payload.status); }
    if (payload.scheduled_at !== undefined) { updates.push("scheduled_at = ?"); values.push(payload.scheduled_at); }

    if (updates.length === 0) return errorResponse("No fields to update", 400);
    updates.push("updated_at = ?");
    values.push(now, id);

    await env.DB.prepare(`UPDATE social_posts SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update post", 500);
  }
}

export async function deleteSocialPost(env: Env, postId: string): Promise<Response> {
  try {
    const id = Number(postId);
    if (isNaN(id)) return errorResponse("Invalid post ID", 400);
    await env.DB.prepare("DELETE FROM social_posts WHERE id = ?").bind(id).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete post", 500);
  }
}

// ------------------------------------------------------------------ twitter accounts

export async function listTwitterAccounts(env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      "SELECT id, username, status, created_at FROM social_accounts WHERE platform = 'twitter'",
    ).all();
    return jsonResponse(rows.results ?? []);
  } catch {
    return errorResponse("Failed to list accounts", 500);
  }
}

export async function addTwitterAccount(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<TwitterAccountPayload>(request);
    const username = payload.username?.trim().replace(/^@+/, "");
    if (!username) return errorResponse("username is required", 400);
    if (!payload.api_key?.trim()) return errorResponse("API key is required", 400);
    if (!payload.api_secret?.trim()) return errorResponse("API secret is required", 400);
    if (!payload.access_token?.trim()) return errorResponse("Access token is required", 400);
    if (!payload.access_secret?.trim()) return errorResponse("Access secret is required", 400);

    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (platform, username, status, created_at, updated_at)
       VALUES ('twitter', ?, 'active', ?, ?)`,
    )
      .bind(username, now, now)
      .run() as { meta: { last_row_id: number } };

    const accountId = result.meta.last_row_id;
    await Promise.all([
      upsertSetting(env, `social_account:${accountId}:twitter_api_key`, payload.api_key.trim(), now),
      upsertSetting(env, `social_account:${accountId}:twitter_api_secret`, payload.api_secret.trim(), now),
      upsertSetting(env, `social_account:${accountId}:twitter_access_token`, payload.access_token.trim(), now),
      upsertSetting(env, `social_account:${accountId}:twitter_access_secret`, payload.access_secret.trim(), now),
      upsertSetting(env, "twitter_api_key", payload.api_key.trim(), now),
      upsertSetting(env, "twitter_api_secret", payload.api_secret.trim(), now),
      upsertSetting(env, "twitter_access_token", payload.access_token.trim(), now),
      upsertSetting(env, "twitter_access_secret", payload.access_secret.trim(), now),
    ]);

    return jsonResponse(
      { id: accountId, platform: "twitter", username, status: "active", created_at: now, updated_at: now },
      { status: 201 },
    );
  } catch {
    return errorResponse("Failed to add account", 500);
  }
}

export async function deleteTwitterAccount(env: Env, accountId: string): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) return errorResponse("Invalid account ID", 400);
    await env.DB.prepare("DELETE FROM social_accounts WHERE id = ? AND platform = 'twitter'").bind(id).run();
    await env.DB.prepare("DELETE FROM app_settings WHERE key LIKE ?").bind(`social_account:${id}:%`).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete account", 500);
  }
}
