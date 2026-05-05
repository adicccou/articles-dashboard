import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";

type TwitterAccountPayload = {
  username: string;
  api_key: string;
  api_secret: string;
  access_token: string;
  access_secret: string;
};

type TwitterCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
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

async function readSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value?.trim() || null;
}

function oauthEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Base64(key: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function buildTwitterOAuthHeader(
  method: string,
  endpoint: string,
  credentials: TwitterCredentials,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const parameterString = Object.entries(oauthParams)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${oauthEncode(key)}=${oauthEncode(value)}`)
    .join("&");
  const signatureBase = [
    method.toUpperCase(),
    oauthEncode(endpoint),
    oauthEncode(parameterString),
  ].join("&");
  const signingKey = `${oauthEncode(credentials.apiSecret)}&${oauthEncode(credentials.accessSecret)}`;
  oauthParams.oauth_signature = await hmacSha1Base64(signingKey, signatureBase);

  return `OAuth ${Object.entries(oauthParams)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${oauthEncode(key)}="${oauthEncode(value)}"`)
    .join(", ")}`;
}

async function getTwitterCredentials(env: Env): Promise<TwitterCredentials | null> {
  const account = await env.DB.prepare(
    "SELECT id FROM social_accounts WHERE platform = 'twitter' AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT 1",
  ).first<{ id: number }>();

  const scopedPrefix = account ? `social_account:${account.id}:` : "";
  const [apiKey, apiSecret, accessToken, accessSecret] = await Promise.all([
    account ? readSetting(env, `${scopedPrefix}twitter_api_key`) : null,
    account ? readSetting(env, `${scopedPrefix}twitter_api_secret`) : null,
    account ? readSetting(env, `${scopedPrefix}twitter_access_token`) : null,
    account ? readSetting(env, `${scopedPrefix}twitter_access_secret`) : null,
  ]);

  const fallback = await Promise.all([
    readSetting(env, "twitter_api_key"),
    readSetting(env, "twitter_api_secret"),
    readSetting(env, "twitter_access_token"),
    readSetting(env, "twitter_access_secret"),
  ]);

  const credentials = {
    apiKey: apiKey || fallback[0] || "",
    apiSecret: apiSecret || fallback[1] || "",
    accessToken: accessToken || fallback[2] || "",
    accessSecret: accessSecret || fallback[3] || "",
  };

  return Object.values(credentials).every(Boolean) ? credentials : null;
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

export async function publishTwitterPost(env: Env, postId: string): Promise<Response> {
  const id = Number(postId);
  if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);

  try {
    const post = await env.DB.prepare("SELECT id, content, status FROM social_posts WHERE id = ? AND platform = 'twitter'")
      .bind(id)
      .first<{ id: number; content: string; status: string }>();
    if (!post) return errorResponse("Twitter/X post not found", 404);
    if (!post.content?.trim()) return errorResponse("Post content is empty", 400);
    if (post.status === "posted") return errorResponse("Post is already published", 400);

    const credentials = await getTwitterCredentials(env);
    if (!credentials) return errorResponse("No active Twitter/X account with API credentials was found.", 400);

    const endpoint = "https://api.twitter.com/2/tweets";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: await buildTwitterOAuthHeader("POST", endpoint, credentials),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: post.content.trim() }),
    });
    const payload = await response.json() as { data?: { id?: string }; detail?: string; title?: string; errors?: Array<{ message?: string }> };
    if (!response.ok || !payload.data?.id) {
      const message = payload.detail || payload.title || payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || "Twitter/X publish failed";
      throw new Error(message);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE social_posts
       SET status = 'posted', posted_at = ?, external_id = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(now, payload.data.id, now, id)
      .run();

    return jsonResponse({ success: true, external_id: payload.data.id, posted_at: now });
  } catch (error) {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE social_posts SET status = 'failed', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();
    return errorResponse(error instanceof Error ? error.message : "Failed to publish Twitter/X post", 500);
  }
}

// ------------------------------------------------------------------ twitter accounts

export async function listTwitterAccounts(env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      `SELECT
         account.id,
         account.username,
         CASE
           WHEN account.status = 'active'
            AND api_key.value IS NOT NULL AND TRIM(api_key.value) != ''
            AND api_secret.value IS NOT NULL AND TRIM(api_secret.value) != ''
            AND access_token.value IS NOT NULL AND TRIM(access_token.value) != ''
            AND access_secret.value IS NOT NULL AND TRIM(access_secret.value) != ''
           THEN 'active'
           ELSE 'inactive'
         END AS status,
         account.created_at,
         account.updated_at,
         CASE
           WHEN api_key.value IS NOT NULL AND TRIM(api_key.value) != ''
            AND api_secret.value IS NOT NULL AND TRIM(api_secret.value) != ''
            AND access_token.value IS NOT NULL AND TRIM(access_token.value) != ''
            AND access_secret.value IS NOT NULL AND TRIM(access_secret.value) != ''
           THEN 1
           ELSE 0
         END AS credentials_ready
       FROM social_accounts account
       LEFT JOIN app_settings api_key ON api_key.key = 'social_account:' || account.id || ':twitter_api_key'
       LEFT JOIN app_settings api_secret ON api_secret.key = 'social_account:' || account.id || ':twitter_api_secret'
       LEFT JOIN app_settings access_token ON access_token.key = 'social_account:' || account.id || ':twitter_access_token'
       LEFT JOIN app_settings access_secret ON access_secret.key = 'social_account:' || account.id || ':twitter_access_secret'
       WHERE account.platform = 'twitter'
       ORDER BY account.created_at DESC`,
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
