import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { listSocialPosts, createSocialPost, updateSocialPost, deleteSocialPost } from "./twitter";

// Re-export post handlers using the 'threads' platform
export { listSocialPosts, createSocialPost, updateSocialPost, deleteSocialPost };

// ------------------------------------------------------------------ threads accounts

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
    const payload = await parseJson<{ username: string }>(request);
    if (!payload.username) return errorResponse("username is required", 400);
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (platform, username, status, created_at, updated_at)
       VALUES ('threads', ?, 'active', ?, ?)`,
    )
      .bind(payload.username, now, now)
      .run() as { meta: { last_row_id: number } };
    return jsonResponse({ id: result.meta.last_row_id, platform: "threads", username: payload.username, status: "active", created_at: now }, { status: 201 });
  } catch {
    return errorResponse("Failed to add Threads account", 500);
  }
}

export async function deleteThreadsAccount(env: Env, accountId: string): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) return errorResponse("Invalid account ID", 400);
    await env.DB.prepare("DELETE FROM social_accounts WHERE id = ? AND platform = 'threads'").bind(id).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete Threads account", 500);
  }
}
