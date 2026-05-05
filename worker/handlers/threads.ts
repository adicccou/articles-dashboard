import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { listSocialPosts, createSocialPost, updateSocialPost, deleteSocialPost } from "./twitter";

// Re-export post handlers using the 'threads' platform
export { listSocialPosts, createSocialPost, updateSocialPost, deleteSocialPost };

// ------------------------------------------------------------------ threads accounts

type ThreadsAccountPayload = {
  username: string;
  access_token: string;
  user_id: string;
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

export async function listThreadsAccounts(env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      "SELECT id, username, status, created_at FROM social_accounts WHERE platform = 'threads'",
    ).all();
    return jsonResponse(rows.results ?? []);
  } catch {
    return errorResponse("Failed to list Threads accounts", 500);
  }
}

export async function addThreadsAccount(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<ThreadsAccountPayload>(request);
    const username = payload.username?.trim().replace(/^@+/, "");
    if (!username) return errorResponse("username is required", 400);
    if (!payload.access_token?.trim()) return errorResponse("Access token is required", 400);
    if (!payload.user_id?.trim()) return errorResponse("User ID is required", 400);

    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (platform, username, status, created_at, updated_at)
       VALUES ('threads', ?, 'active', ?, ?)`,
    )
      .bind(username, now, now)
      .run() as { meta: { last_row_id: number } };

    const accountId = result.meta.last_row_id;
    await Promise.all([
      upsertSetting(env, `social_account:${accountId}:threads_access_token`, payload.access_token.trim(), now),
      upsertSetting(env, `social_account:${accountId}:threads_user_id`, payload.user_id.trim(), now),
      upsertSetting(env, "threads_access_token", payload.access_token.trim(), now),
      upsertSetting(env, "threads_user_id", payload.user_id.trim(), now),
    ]);

    return jsonResponse(
      { id: accountId, platform: "threads", username, status: "active", created_at: now, updated_at: now },
      { status: 201 },
    );
  } catch {
    return errorResponse("Failed to add Threads account", 500);
  }
}

export async function deleteThreadsAccount(env: Env, accountId: string): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) return errorResponse("Invalid account ID", 400);
    await env.DB.prepare("DELETE FROM social_accounts WHERE id = ? AND platform = 'threads'").bind(id).run();
    await env.DB.prepare("DELETE FROM app_settings WHERE key LIKE ?").bind(`social_account:${id}:%`).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete Threads account", 500);
  }
}
