import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { listSocialPosts, createSocialPost, updateSocialPost, deleteSocialPost } from "./twitter";

// Re-export post handlers using the 'threads' platform
export { listSocialPosts, createSocialPost, updateSocialPost, deleteSocialPost };

// ------------------------------------------------------------------ threads accounts

type ThreadsAccountPayload = {
  username: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  scopes: string;
  access_token: string;
  user_id: string;
};

type PendingThreadsOAuth = Omit<ThreadsAccountPayload, "access_token" | "user_id">;

const THREADS_AUTHORIZE_URL = "https://threads.net/oauth/authorize";
const THREADS_TOKEN_URL = "https://graph.threads.net/oauth/access_token";
const THREADS_LONG_LIVED_TOKEN_URL = "https://graph.threads.net/access_token";
const THREADS_GRAPH_BASE = "https://graph.threads.net/v1.0";

async function upsertSetting(env: Env, key: string, value: string, updatedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, updatedAt)
    .run();
}

async function createThreadsAccount(env: Env, payload: ThreadsAccountPayload): Promise<{
  id: number;
  platform: "threads";
  username: string;
  status: "active";
  created_at: string;
  updated_at: string;
}> {
  const username = payload.username.trim().replace(/^@+/, "");
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO social_accounts (platform, username, status, created_at, updated_at)
     VALUES ('threads', ?, 'active', ?, ?)`,
  )
    .bind(username, now, now)
    .run() as { meta: { last_row_id: number } };

  const accountId = result.meta.last_row_id;
  await Promise.all([
    upsertSetting(env, `social_account:${accountId}:threads_client_id`, payload.client_id.trim(), now),
    upsertSetting(env, `social_account:${accountId}:threads_client_secret`, payload.client_secret.trim(), now),
    upsertSetting(env, `social_account:${accountId}:threads_redirect_uri`, payload.redirect_uri.trim(), now),
    upsertSetting(env, `social_account:${accountId}:threads_scopes`, payload.scopes.trim(), now),
    upsertSetting(env, `social_account:${accountId}:threads_access_token`, payload.access_token.trim(), now),
    upsertSetting(env, `social_account:${accountId}:threads_user_id`, payload.user_id.trim(), now),
    upsertSetting(env, "threads_access_token", payload.access_token.trim(), now),
    upsertSetting(env, "threads_user_id", payload.user_id.trim(), now),
  ]);

  return { id: accountId, platform: "threads", username, status: "active", created_at: now, updated_at: now };
}

function validateThreadsAppPayload(payload: PendingThreadsOAuth): string | null {
  if (!payload.username?.trim()) return "username is required";
  if (!payload.client_id?.trim()) return "Threads App ID / Client ID is required";
  if (!payload.client_secret?.trim()) return "Threads App Secret is required";
  if (!payload.redirect_uri?.trim()) return "Redirect URI is required";
  if (!payload.scopes?.trim()) return "Scopes are required";
  return null;
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
    const appError = validateThreadsAppPayload(payload);
    if (appError) return errorResponse(appError, 400);
    if (!payload.access_token?.trim()) return errorResponse("Access token is required", 400);
    if (!payload.user_id?.trim()) return errorResponse("User ID is required", 400);

    return jsonResponse(await createThreadsAccount(env, payload), { status: 201 });
  } catch {
    return errorResponse("Failed to add Threads account", 500);
  }
}

export async function authorizeThreadsAccount(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<PendingThreadsOAuth>(request);
    const appError = validateThreadsAppPayload(payload);
    if (appError) return errorResponse(appError, 400);

    const state = crypto.randomUUID();
    const now = new Date().toISOString();
    await upsertSetting(env, `threads_oauth_state:${state}`, JSON.stringify({
      username: payload.username.trim().replace(/^@+/, ""),
      client_id: payload.client_id.trim(),
      client_secret: payload.client_secret.trim(),
      redirect_uri: payload.redirect_uri.trim(),
      scopes: payload.scopes.trim(),
      created_at: now,
    }), now);

    const authUrl = new URL(THREADS_AUTHORIZE_URL);
    authUrl.searchParams.set("client_id", payload.client_id.trim());
    authUrl.searchParams.set("redirect_uri", payload.redirect_uri.trim());
    authUrl.searchParams.set("scope", payload.scopes.trim());
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);

    return jsonResponse({ auth_url: authUrl.toString() });
  } catch {
    return errorResponse("Failed to start Threads authorization", 500);
  }
}

export async function handleThreadsOAuthCallback(env: Env, url: URL): Promise<Response> {
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      return new Response(`<html><body><h1>Threads authorization failed</h1><p>${oauthError}</p></body></html>`, {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (!code || !state) {
      return new Response("<html><body><h1>Invalid Threads OAuth callback</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const stateKey = `threads_oauth_state:${state}`;
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(stateKey).first<{ value: string }>();
    if (!row?.value) {
      return new Response("<html><body><h1>Threads OAuth state expired</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const pending = JSON.parse(row.value) as PendingThreadsOAuth & { created_at?: string };

    const shortTokenResponse = await fetch(THREADS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: pending.client_id,
        client_secret: pending.client_secret,
        grant_type: "authorization_code",
        redirect_uri: pending.redirect_uri,
        code,
      }).toString(),
    });

    if (!shortTokenResponse.ok) {
      return new Response(`<html><body><h1>Threads token exchange failed</h1><p>${await shortTokenResponse.text()}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const shortToken = await shortTokenResponse.json() as { access_token: string };
    const longLivedUrl = new URL(THREADS_LONG_LIVED_TOKEN_URL);
    longLivedUrl.searchParams.set("grant_type", "th_exchange_token");
    longLivedUrl.searchParams.set("client_secret", pending.client_secret);
    longLivedUrl.searchParams.set("access_token", shortToken.access_token);
    const longTokenResponse = await fetch(longLivedUrl.toString());

    if (!longTokenResponse.ok) {
      return new Response(`<html><body><h1>Threads long-lived token exchange failed</h1><p>${await longTokenResponse.text()}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const longToken = await longTokenResponse.json() as { access_token: string };
    const profileUrl = new URL(`${THREADS_GRAPH_BASE}/me`);
    profileUrl.searchParams.set("fields", "id,username");
    profileUrl.searchParams.set("access_token", longToken.access_token);
    const profileResponse = await fetch(profileUrl.toString());

    if (!profileResponse.ok) {
      return new Response(`<html><body><h1>Threads profile lookup failed</h1><p>${await profileResponse.text()}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const profile = await profileResponse.json() as { id: string; username?: string };
    await createThreadsAccount(env, {
      username: profile.username || pending.username,
      client_id: pending.client_id,
      client_secret: pending.client_secret,
      redirect_uri: pending.redirect_uri,
      scopes: pending.scopes,
      access_token: longToken.access_token,
      user_id: profile.id,
    });
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(stateKey).run();

    return new Response(
      `<html>
        <body>
          <h1>Threads account connected</h1>
          <p>You can return to the dashboard now.</p>
          <script>window.location.href = "/";</script>
        </body>
      </html>`,
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  } catch (error) {
    return new Response("<html><body><h1>Error processing Threads OAuth callback</h1></body></html>", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
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
