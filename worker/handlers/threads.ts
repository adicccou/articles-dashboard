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
const THREADS_MEDIA_FIELDS = [
  "id",
  "media_product_type",
  "media_type",
  "media_url",
  "permalink",
  "username",
  "text",
  "timestamp",
  "shortcode",
  "thumbnail_url",
  "has_replies",
  "is_quote_post",
  "root_post",
  "replied_to",
  "is_reply",
  "is_reply_owned_by_me",
  "reply_audience",
].join(",");

type ThreadsCredentials = {
  accountId: number;
  accessToken: string;
  userId: string;
};

type ThreadsGraphError = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
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

function getGraphErrorMessage(payload: unknown, fallback: string): string {
  const graphError = payload as ThreadsGraphError;
  return graphError.error?.message || fallback;
}

async function readSetting(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? "";
}

async function getThreadsCredentials(env: Env, requestedAccountId?: number): Promise<ThreadsCredentials | null> {
  const account = requestedAccountId
    ? await env.DB.prepare("SELECT id FROM social_accounts WHERE id = ? AND platform = 'threads' AND status = 'active'")
      .bind(requestedAccountId)
      .first<{ id: number }>()
    : await env.DB.prepare(
      "SELECT id FROM social_accounts WHERE platform = 'threads' AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT 1",
    ).first<{ id: number }>();

  if (!account?.id) return null;

  const [accessToken, userId] = await Promise.all([
    readSetting(env, `social_account:${account.id}:threads_access_token`),
    readSetting(env, `social_account:${account.id}:threads_user_id`),
  ]);

  if (!accessToken || !userId) return null;
  return { accountId: account.id, accessToken, userId };
}

async function postThreadsContainer(
  env: Env,
  payload: { text: string; imageUrl?: string; replyToId?: string; accountId?: number },
): Promise<{ containerId: string; credentials: ThreadsCredentials }> {
  const credentials = await getThreadsCredentials(env, payload.accountId);
  if (!credentials) throw new Error("No active Threads account with access token was found.");

  const containerBody = new URLSearchParams({
    media_type: payload.imageUrl ? "IMAGE" : "TEXT",
    access_token: credentials.accessToken,
  });
  if (payload.imageUrl) {
    containerBody.set("image_url", payload.imageUrl);
    if (payload.text) containerBody.set("text", payload.text);
  } else {
    containerBody.set("text", payload.text);
  }
  if (payload.replyToId) containerBody.set("reply_to_id", payload.replyToId);

  const containerResponse = await fetch(`${THREADS_GRAPH_BASE}/me/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: containerBody.toString(),
  });
  const containerPayload = await containerResponse.json() as { id?: string } & ThreadsGraphError;
  if (!containerResponse.ok || !containerPayload.id) {
    throw new Error(getGraphErrorMessage(containerPayload, "Threads media container creation failed."));
  }

  return { containerId: containerPayload.id, credentials };
}

async function publishThreadsContainer(credentials: ThreadsCredentials, containerId: string): Promise<string> {
  let lastError = "Threads publish failed.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2500));
    const publishBody = new URLSearchParams({
      creation_id: containerId,
      access_token: credentials.accessToken,
    });
    const publishResponse = await fetch(`${THREADS_GRAPH_BASE}/${credentials.userId}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishBody.toString(),
    });
    const publishPayload = await publishResponse.json() as { id?: string } & ThreadsGraphError;
    if (publishResponse.ok && publishPayload.id) return publishPayload.id;
    lastError = getGraphErrorMessage(publishPayload, lastError);
  }
  throw new Error(lastError);
}

async function publishThreadsText(
  env: Env,
  payload: { text: string; imageUrl?: string; replyToId?: string; accountId?: number },
): Promise<{ externalId: string; accountId: number }> {
  const { containerId, credentials } = await postThreadsContainer(env, payload);
  const externalId = await publishThreadsContainer(credentials, containerId);
  return { externalId, accountId: credentials.accountId };
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
  const existing = await env.DB.prepare("SELECT id, created_at FROM social_accounts WHERE platform = 'threads' AND username = ? ORDER BY id DESC LIMIT 1")
    .bind(username)
    .first<{ id: number; created_at: string }>();
  let accountId = existing?.id;
  let createdAt = existing?.created_at ?? now;

  if (accountId) {
    await env.DB.prepare("UPDATE social_accounts SET status = 'active', updated_at = ? WHERE id = ?")
      .bind(now, accountId)
      .run();
  } else {
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (platform, username, status, created_at, updated_at)
       VALUES ('threads', ?, 'active', ?, ?)`,
    )
      .bind(username, now, now)
      .run() as { meta: { last_row_id: number } };
    accountId = result.meta.last_row_id;
    createdAt = now;
  }

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

  return { id: accountId, platform: "threads", username, status: "active", created_at: createdAt, updated_at: now };
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

export async function publishThreadsPost(env: Env, postId: string): Promise<Response> {
  try {
    const id = Number(postId);
    if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);

    const post = await env.DB.prepare("SELECT id, content, image_url, status FROM social_posts WHERE id = ? AND platform = 'threads'")
      .bind(id)
      .first<{ id: number; content: string; image_url: string | null; status: string }>();
    if (!post) return errorResponse("Threads post not found", 404);
    if (!post.content?.trim() && !post.image_url?.trim()) return errorResponse("Post content is empty", 400);
    if (post.status === "posted") return errorResponse("Post is already published", 400);

    const now = new Date().toISOString();
    const published = await publishThreadsText(env, {
      text: post.content.trim(),
      imageUrl: post.image_url?.trim() || undefined,
    });
    await env.DB.prepare(
      `UPDATE social_posts
       SET status = 'posted', posted_at = ?, external_id = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(now, published.externalId, now, id)
      .run();

    return jsonResponse({ success: true, external_id: published.externalId, posted_at: now });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to publish Threads post", 500);
  }
}

export async function searchThreads(env: Env, url: URL): Promise<Response> {
  try {
    const q = url.searchParams.get("q")?.trim();
    if (!q) return errorResponse("Search query is required", 400);
    const credentials = await getThreadsCredentials(env);
    if (!credentials) return errorResponse("No active Threads account with access token was found.", 400);

    const searchUrl = new URL(`${THREADS_GRAPH_BASE}/keyword_search`);
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("search_type", url.searchParams.get("search_type") || "TOP");
    searchUrl.searchParams.set("search_mode", url.searchParams.get("search_mode") || "KEYWORD");
    searchUrl.searchParams.set("fields", THREADS_MEDIA_FIELDS);
    searchUrl.searchParams.set("limit", url.searchParams.get("limit") || "20");
    searchUrl.searchParams.set("access_token", credentials.accessToken);

    const response = await fetch(searchUrl.toString());
    const payload = await response.json();
    if (!response.ok) {
      return errorResponse(getGraphErrorMessage(payload, "Threads search failed"), response.status);
    }
    return jsonResponse(payload);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to search Threads", 500);
  }
}

export async function listThreadsReplies(env: Env, url: URL): Promise<Response> {
  try {
    const credentials = await getThreadsCredentials(env);
    if (!credentials) return errorResponse("No active Threads account with access token was found.", 400);

    const mediaId = url.searchParams.get("media_id")?.trim();
    const endpoint = mediaId
      ? `${THREADS_GRAPH_BASE}/${mediaId}/conversation`
      : `${THREADS_GRAPH_BASE}/me/replies`;
    const repliesUrl = new URL(endpoint);
    repliesUrl.searchParams.set("fields", THREADS_MEDIA_FIELDS);
    repliesUrl.searchParams.set("reverse", url.searchParams.get("reverse") || "false");
    repliesUrl.searchParams.set("limit", url.searchParams.get("limit") || "20");
    repliesUrl.searchParams.set("access_token", credentials.accessToken);

    const response = await fetch(repliesUrl.toString());
    const payload = await response.json();
    if (!response.ok) {
      return errorResponse(getGraphErrorMessage(payload, "Threads replies lookup failed"), response.status);
    }
    return jsonResponse(payload);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load Threads replies", 500);
  }
}

export async function createThreadsReply(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<{ reply_to_id: string; text: string; account_id?: number }>(request);
    const replyToId = payload.reply_to_id?.trim();
    const text = payload.text?.trim();
    if (!replyToId) return errorResponse("Reply target ID is required", 400);
    if (!text) return errorResponse("Reply text is required", 400);
    if (text.length > 500) return errorResponse("Threads replies must be 500 characters or fewer", 400);

    const published = await publishThreadsText(env, {
      text,
      replyToId,
      accountId: payload.account_id,
    });

    return jsonResponse({ success: true, external_id: published.externalId, account_id: published.accountId });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to publish Threads reply", 500);
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
