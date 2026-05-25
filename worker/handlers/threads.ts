import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { DEFAULT_USER_ID, appendScopedFilter, ownerId, scopedInsertColumns, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import { defaultPlaywrightProfileKey, playwrightUserSettingKey } from "../lib/playwright-accounts";
import { listSocialPosts, createSocialPost, updateSocialPost, deleteSocialPost, getSocialPostSchemaCapabilities } from "./twitter";

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
  connection_mode?: "official_api" | "playwright";
  status?: "active" | "inactive";
  playwright_login?: string;
  playwright_password?: string;
};

type ThreadsAccountUpdatePayload = Partial<ThreadsAccountPayload> & {
  status?: "active" | "inactive";
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

async function upsertSetting(env: Env, key: string, value: string, updatedAt: string, userId = DEFAULT_USER_ID): Promise<void> {
  if (await tableHasWorkspaceId(env, "app_settings")) {
    await env.DB.prepare(
      `INSERT INTO app_settings (workspace_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(workspaceId(userId), key, value, updatedAt)
      .run();
    return;
  }

  if (await tableHasUserId(env, "app_settings")) {
    await env.DB.prepare(
      `INSERT INTO app_settings (user_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(ownerId(userId), key, value, updatedAt)
      .run();
    return;
  }

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

async function readSetting(env: Env, key: string, userId = DEFAULT_USER_ID): Promise<string> {
  const hasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
  const hasUserId = await tableHasUserId(env, "app_settings");
  const row = await env.DB.prepare(hasWorkspaceId
    ? "SELECT value FROM app_settings WHERE workspace_id = ? AND key = ?"
    : hasUserId
    ? "SELECT value FROM app_settings WHERE user_id = ? AND key = ?"
    : "SELECT value FROM app_settings WHERE key = ?")
    .bind(...(hasWorkspaceId ? [workspaceId(userId), key] : hasUserId ? [ownerId(userId), key] : [key]))
    .first<{ value: string }>();
  return row?.value ?? "";
}

async function readPlaywrightSettings(
  env: Env,
  accountId: number,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<{ login: string; password: string; profileKey: string }> {
  const [login, password, profileKey] = await Promise.all([
    readSetting(env, playwrightUserSettingKey("social_account", accountId, dashboardUserId, "login"), scopeId),
    readSetting(env, playwrightUserSettingKey("social_account", accountId, dashboardUserId, "password"), scopeId),
    readSetting(env, playwrightUserSettingKey("social_account", accountId, dashboardUserId, "profile_key"), scopeId),
  ]);
  return { login, password, profileKey };
}

async function getThreadsCredentials(
  env: Env,
  requestedAccountId?: number,
  userId = DEFAULT_USER_ID,
): Promise<ThreadsCredentials | null> {
  const filters = ["platform = 'threads'", "status = 'active'"];
  const values: unknown[] = [];
  if (requestedAccountId) filters.push("id = ?"), values.push(requestedAccountId);
  await appendScopedFilter(env, "social_accounts", filters, values, userId);
  const requestedAccount = requestedAccountId
    ? await env.DB.prepare(`SELECT id FROM social_accounts WHERE ${filters.join(" AND ")}`)
      .bind(...values)
      .first<{ id: number }>()
    : null;

  const account = requestedAccount ?? await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
  ).bind(...values).first<{ id: number }>();

  if (!account?.id) return null;

  const [accessToken, threadsUserId] = await Promise.all([
    readSetting(env, `social_account:${account.id}:threads_access_token`, userId),
    readSetting(env, `social_account:${account.id}:threads_user_id`, userId),
  ]);

  if (!accessToken || !threadsUserId) return null;
  return { accountId: account.id, accessToken, userId: threadsUserId };
}

async function postThreadsContainer(
  env: Env,
  payload: { text: string; imageUrl?: string; replyToId?: string; accountId?: number; userId?: number },
): Promise<{ containerId: string; credentials: ThreadsCredentials }> {
  const credentials = await getThreadsCredentials(env, payload.accountId, payload.userId);
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
  payload: { text: string; imageUrl?: string; replyToId?: string; accountId?: number; userId?: number },
): Promise<{ externalId: string; accountId: number; credentials: ThreadsCredentials }> {
  const { containerId, credentials } = await postThreadsContainer(env, payload);
  const externalId = await publishThreadsContainer(credentials, containerId);
  return { externalId, accountId: credentials.accountId, credentials };
}

async function fetchThreadsMediaDetails(
  credentials: ThreadsCredentials,
  mediaId: string,
): Promise<Record<string, unknown> | null> {
  const mediaUrl = new URL(`${THREADS_GRAPH_BASE}/${mediaId}`);
  mediaUrl.searchParams.set("fields", THREADS_MEDIA_FIELDS);
  mediaUrl.searchParams.set("access_token", credentials.accessToken);

  const response = await fetch(mediaUrl.toString());
  const payload = await response.json() as Record<string, unknown> & ThreadsGraphError;
  if (!response.ok || payload.error) {
    console.error("Threads media verification failed:", getGraphErrorMessage(payload, "unknown error"));
    return null;
  }
  return payload;
}

async function createThreadsAccount(
  env: Env,
  payload: ThreadsAccountPayload,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<{
  id: number;
  platform: "threads";
  username: string;
  status: "active" | "inactive";
  connection_mode: "official_api" | "playwright";
  playwright_login?: string;
  playwright_profile_key?: string;
  playwright_ready?: boolean;
  created_at: string;
  updated_at: string;
}> {
  const username = payload.username.trim().replace(/^@+/, "");
  const connectionMode = payload.connection_mode === "playwright" ? "playwright" : "official_api";
  const status = payload.status === "inactive" ? "inactive" : "active";
  const playwrightLogin = payload.playwright_login?.trim() ?? "";
  const playwrightPassword = payload.playwright_password?.trim() ?? "";
  const now = new Date().toISOString();
  const existingFilters = ["platform = 'threads'", "username = ?"];
  const existingValues: unknown[] = [username];
  await appendScopedFilter(env, "social_accounts", existingFilters, existingValues, scopeId);
  const existing = await env.DB.prepare(`SELECT id, created_at FROM social_accounts WHERE ${existingFilters.join(" AND ")} ORDER BY id DESC LIMIT 1`)
    .bind(...existingValues)
    .first<{ id: number; created_at: string }>();
  let accountId = existing?.id;
  let createdAt = existing?.created_at ?? now;

  if (accountId) {
    const filters = ["id = ?"];
    const values: unknown[] = [accountId];
    await appendScopedFilter(env, "social_accounts", filters, values, scopeId);
    await env.DB.prepare(`UPDATE social_accounts SET status = ?, updated_at = ? WHERE ${filters.join(" AND ")}`)
      .bind(status, now, ...values)
      .run();
  } else {
    const scoped = await scopedInsertColumns(env, "social_accounts", scopeId);
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (${[...scoped.columns, "platform", "username", "status", "created_at", "updated_at"].join(", ")})
       VALUES (${[...scoped.columns.map(() => "?"), "?", "?", "?", "?", "?"].join(", ")})`,
    )
      .bind(...scoped.values, "threads", username, status, now, now)
      .run() as { meta: { last_row_id: number } };
    accountId = result.meta.last_row_id;
    createdAt = now;
  }

  await Promise.all([
    upsertSetting(env, `social_account:${accountId}:connection_mode`, connectionMode, now, scopeId),
    ...(connectionMode === "official_api"
      ? [
          upsertSetting(env, `social_account:${accountId}:threads_client_id`, payload.client_id.trim(), now, scopeId),
          upsertSetting(env, `social_account:${accountId}:threads_client_secret`, payload.client_secret.trim(), now, scopeId),
          upsertSetting(env, `social_account:${accountId}:threads_redirect_uri`, payload.redirect_uri.trim(), now, scopeId),
          upsertSetting(env, `social_account:${accountId}:threads_scopes`, payload.scopes.trim(), now, scopeId),
          upsertSetting(env, `social_account:${accountId}:threads_access_token`, payload.access_token.trim(), now, scopeId),
          upsertSetting(env, `social_account:${accountId}:threads_user_id`, payload.user_id.trim(), now, scopeId),
          upsertSetting(env, "threads_access_token", payload.access_token.trim(), now, scopeId),
          upsertSetting(env, "threads_user_id", payload.user_id.trim(), now, scopeId),
        ]
      : [
          upsertSetting(env, playwrightUserSettingKey("social_account", accountId, dashboardUserId, "login"), playwrightLogin, now, scopeId),
          upsertSetting(env, playwrightUserSettingKey("social_account", accountId, dashboardUserId, "password"), playwrightPassword, now, scopeId),
          upsertSetting(
            env,
            playwrightUserSettingKey("social_account", accountId, dashboardUserId, "profile_key"),
            defaultPlaywrightProfileKey("threads", accountId, dashboardUserId),
            now,
            scopeId,
          ),
        ]),
  ]);

  return {
    id: accountId,
    platform: "threads",
    username,
    status,
    connection_mode: connectionMode,
    playwright_login: connectionMode === "playwright" ? playwrightLogin : undefined,
    playwright_profile_key: connectionMode === "playwright" ? defaultPlaywrightProfileKey("threads", accountId, dashboardUserId) : undefined,
    playwright_ready: connectionMode === "playwright",
    created_at: createdAt,
    updated_at: now,
  };
}

function validateThreadsAppPayload(payload: PendingThreadsOAuth): string | null {
  if (!payload.username?.trim()) return "username is required";
  if (!payload.client_id?.trim()) return "Threads App ID / Client ID is required";
  if (!payload.client_secret?.trim()) return "Threads App Secret is required";
  if (!payload.redirect_uri?.trim()) return "Redirect URI is required";
  if (!payload.scopes?.trim()) return "Scopes are required";
  return null;
}

export async function listThreadsAccounts(
  env: Env,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const filters = ["platform = 'threads'"];
    const values: unknown[] = [];
    await appendScopedFilter(env, "social_accounts", filters, values, scopeId);
    const rows = await env.DB.prepare(
      `SELECT id, username, status, created_at, updated_at FROM social_accounts WHERE ${filters.join(" AND ")} ORDER BY created_at DESC`,
    ).bind(...values).all();
    const results = await Promise.all((rows.results ?? []).map(async (row) => {
      const accountId = Number((row as { id: number }).id);
      const [connectionMode, playwright] = await Promise.all([
        readSetting(env, `social_account:${accountId}:connection_mode`, scopeId),
        readPlaywrightSettings(env, accountId, scopeId, dashboardUserId),
      ]);
      return {
        ...row,
        connection_mode: connectionMode === "playwright" ? "playwright" : "official_api",
        playwright_login: playwright.login || undefined,
        playwright_profile_key: playwright.profileKey || defaultPlaywrightProfileKey("threads", accountId, dashboardUserId),
        playwright_ready: Boolean(playwright.login && playwright.password),
      };
    }));
    return jsonResponse(results);
  } catch {
    return errorResponse("Failed to list Threads accounts", 500);
  }
}

export async function addThreadsAccount(
  env: Env,
  request: Request,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const payload = await parseJson<ThreadsAccountPayload>(request);
    const connectionMode = payload.connection_mode === "playwright" ? "playwright" : "official_api";
    if (connectionMode === "official_api") {
      const appError = validateThreadsAppPayload(payload);
      if (appError) return errorResponse(appError, 400);
      if (!payload.access_token?.trim()) return errorResponse("Access token is required", 400);
      if (!payload.user_id?.trim()) return errorResponse("User ID is required", 400);
    } else if (!payload.username?.trim()) {
      return errorResponse("username is required", 400);
    } else if (!payload.playwright_login?.trim()) {
      return errorResponse("Playwright login is required", 400);
    } else if (!payload.playwright_password?.trim()) {
      return errorResponse("Playwright password is required", 400);
    }

    return jsonResponse(await createThreadsAccount(env, payload, scopeId, dashboardUserId), { status: 201 });
  } catch {
    return errorResponse("Failed to add Threads account", 500);
  }
}

export async function authorizeThreadsAccount(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
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
      user_id: ownerId(userId),
      created_at: now,
    }), now, userId);

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

export async function publishThreadsPost(env: Env, postId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(postId);
    if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);

    const capabilities = await getSocialPostSchemaCapabilities(env);
    const accountSelect = capabilities.hasAccountId ? "account_id" : "NULL AS account_id";
    const replySelect = capabilities.hasReplyToId ? "reply_to_id" : "NULL AS reply_to_id";
    const filters = ["id = ?", "platform = 'threads'"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "social_posts", filters, values, userId);
    const post = await env.DB.prepare(
      `SELECT id, content, image_url, status, ${accountSelect}, ${replySelect} FROM social_posts WHERE ${filters.join(" AND ")}`,
    )
      .bind(...values)
      .first<{ id: number; content: string; image_url: string | null; status: string; account_id: number | null; reply_to_id: string | null }>();
    if (!post) return errorResponse("Threads post not found", 404);
    if (!post.content?.trim() && !post.image_url?.trim()) return errorResponse("Post content is empty", 400);
    if (post.status === "posted") return errorResponse("Post is already published", 400);
    if (post.account_id) {
      const connectionMode = await readSetting(env, `social_account:${post.account_id}:connection_mode`, userId);
      if (connectionMode === "playwright") {
        const playwright = await readPlaywrightSettings(env, post.account_id, userId);
        const profileKey = playwright.profileKey || defaultPlaywrightProfileKey("threads", post.account_id, userId);
        return errorResponse(
          `This Threads account is set to Playwright. Browser publishing must run through profile ${profileKey}; the Worker will not use official API credentials for it.`,
          501,
        );
      }
    }

    const now = new Date().toISOString();
    const published = await publishThreadsText(env, {
      text: post.content.trim(),
      imageUrl: post.image_url?.trim() || undefined,
      replyToId: post.reply_to_id?.trim() || undefined,
      accountId: post.account_id ?? undefined,
      userId,
    });
    await env.DB.prepare(
      `UPDATE social_posts
       SET status = 'posted', posted_at = ?, external_id = ?, updated_at = ?
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(now, published.externalId, now, ...values)
      .run();

    return jsonResponse({ success: true, external_id: published.externalId, posted_at: now });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to publish Threads post", 500);
  }
}

export async function fetchThreadsRepliesData(
  env: Env,
  options?: {
    mediaId?: string | null;
    reverse?: string | null;
    limit?: string | null;
    userId?: number | null;
  },
): Promise<Array<Record<string, unknown>>> {
  const credentials = await getThreadsCredentials(env, undefined, options?.userId ?? DEFAULT_USER_ID);
  if (!credentials) return [];

  const mediaId = options?.mediaId?.trim();
  const endpoint = mediaId
    ? `${THREADS_GRAPH_BASE}/${mediaId}/conversation`
    : `${THREADS_GRAPH_BASE}/me/replies`;
  const repliesUrl = new URL(endpoint);
  repliesUrl.searchParams.set("fields", THREADS_MEDIA_FIELDS);
  repliesUrl.searchParams.set("reverse", options?.reverse || "false");
  repliesUrl.searchParams.set("limit", options?.limit || "20");
  repliesUrl.searchParams.set("access_token", credentials.accessToken);

  const response = await fetch(repliesUrl.toString());
  const payload = await response.json() as { data?: Array<Record<string, unknown>> } & ThreadsGraphError;
  if (!response.ok) {
    throw new Error(getGraphErrorMessage(payload, "Threads replies lookup failed"));
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

function isThreadsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function readThreadsReplyParentId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  return id || null;
}

function selectLatestThreadsReply(
  current: Record<string, unknown> | undefined,
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  const currentTimestamp = String(current?.timestamp ?? "");
  const candidateTimestamp = String(candidate.timestamp ?? "");
  return candidateTimestamp.localeCompare(currentTimestamp) > 0 ? candidate : (current ?? candidate);
}

export async function searchThreads(env: Env, url: URL, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const q = url.searchParams.get("q")?.trim();
    if (!q) return errorResponse("Search query is required", 400);
    const requestedAccountId = Number(url.searchParams.get("account_id") || 0) || undefined;
    const credentials = await getThreadsCredentials(env, requestedAccountId, userId);
    if (!credentials) return errorResponse("No active Threads account with access token was found.", 400);
    const baseParams: Record<string, string> = {
      q,
      search_type: url.searchParams.get("search_type") || "TOP",
      fields: "id,permalink,username,text,timestamp,media_type,has_replies,is_quote_post",
      limit: url.searchParams.get("limit") || "20",
    };

    const apiUrl = new URL(`${THREADS_GRAPH_BASE}/keyword_search`);
    Object.entries(baseParams).forEach(([key, value]) => apiUrl.searchParams.set(key, value));
    apiUrl.searchParams.set("access_token", credentials.accessToken);

    const response = await fetch(apiUrl.toString());
    const payload = await response.json() as { data?: unknown[]; error?: { message?: string; code?: number; type?: string } };

    if (!response.ok || payload.error) {
      const msg = payload.error?.message || getGraphErrorMessage(payload, "Threads search failed");
      console.error("Threads keyword_search error:", JSON.stringify(payload));
      return errorResponse(`Threads API: ${msg}`, response.ok ? 502 : response.status);
    }

    const data = Array.isArray(payload.data) ? payload.data : [];
    console.log(`Threads keyword_search q="${q}" returned ${data.length} results`);
    return jsonResponse({ data });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to search Threads", 500);
  }
}

export async function listThreadsReplies(env: Env, url: URL, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const replies = await fetchThreadsRepliesData(env, {
      mediaId: url.searchParams.get("media_id"),
      reverse: url.searchParams.get("reverse"),
      limit: url.searchParams.get("limit"),
      userId,
    });
    return jsonResponse({ data: replies });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load Threads replies", 500);
  }
}

export async function listThreadsComments(env: Env, postId?: string | null, limit?: string | null, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const requestedLimit = Math.max(1, Math.min(Number(limit || 100) || 100, 100));
    const filters = ["platform = 'threads'", "status = 'posted'"];
    const values: unknown[] = [];
    if (postId) {
      filters.unshift("id = ?");
      values.unshift(Number(postId));
    }
    await appendScopedFilter(env, "social_posts", filters, values, userId);
    const targets = await env.DB.prepare(
      `SELECT id, external_id, content, image_url FROM social_posts WHERE ${filters.join(" AND ")} ORDER BY posted_at DESC, updated_at DESC`,
    )
      .bind(...values)
      .all<{ id: number; external_id: string | null; content: string | null; image_url: string | null }>();
    const targetRows = (targets.results ?? []).filter((row) => row.external_id?.trim());
    if (targetRows.length === 0) return jsonResponse({ data: [] });

    const conversations = await Promise.all(
      targetRows.map(async (target) => {
        const replies = await fetchThreadsRepliesData(env, {
          mediaId: String(target.external_id).trim(),
          limit: String(requestedLimit),
          reverse: "true",
          userId,
        });
        const ownerRepliesByParent = new Map<string, Record<string, unknown>>();
        replies
          .filter((reply) => Boolean(reply.id))
          .filter((reply) => isThreadsTrue(reply.is_reply))
          .filter((reply) => isThreadsTrue(reply.is_reply_owned_by_me))
          .forEach((reply) => {
            const parentId = readThreadsReplyParentId(reply.replied_to);
            if (!parentId) return;
            ownerRepliesByParent.set(parentId, selectLatestThreadsReply(ownerRepliesByParent.get(parentId), reply));
          });

        return replies
          .filter((reply) => Boolean(reply.id))
          .filter((reply) => isThreadsTrue(reply.is_reply))
          .filter((reply) => !isThreadsTrue(reply.is_reply_owned_by_me))
          .map((reply) => {
            const ownerReply = ownerRepliesByParent.get(String(reply.id));
            return {
            platform: "threads",
            post_id: target.id,
            post_external_id: String(target.external_id).trim(),
            post_preview: target.content?.slice(0, 120) ?? null,
            post_image_url: target.image_url ?? null,
            commenter_username: reply.username ? String(reply.username) : null,
            commenter_name: null,
            text: reply.text ? String(reply.text) : "",
            commented_at: reply.timestamp ? String(reply.timestamp) : null,
            external_id: reply.id ? String(reply.id) : null,
            parent_external_id: readThreadsReplyParentId(reply.replied_to),
            permalink: reply.permalink ? String(reply.permalink) : null,
            reply_status: ownerReply ? "replied" : "new",
            owner_reply_text: ownerReply?.text ? String(ownerReply.text) : null,
            owner_replied_at: ownerReply?.timestamp ? String(ownerReply.timestamp) : null,
            owner_reply_external_id: ownerReply?.id ? String(ownerReply.id) : null,
            owner_reply_permalink: ownerReply?.permalink ? String(ownerReply.permalink) : null,
          };
          });
      }),
    );

    const merged = conversations
      .flat()
      .sort((left, right) => String(right.commented_at ?? "").localeCompare(String(left.commented_at ?? "")));
    return jsonResponse({ data: merged });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load Threads comments", 500);
  }
}

export async function createThreadsReply(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<{ reply_to_id: string; text: string; account_id?: number; image_url?: string | null }>(request);
    const replyToId = payload.reply_to_id?.trim();
    const text = payload.text?.trim();
    const imageUrl = payload.image_url?.trim() || undefined;
    if (!replyToId) return errorResponse("Reply target ID is required", 400);
    if (!text) return errorResponse("Reply text is required", 400);
    if (text.length > 500) return errorResponse("Threads replies must be 500 characters or fewer", 400);

    const published = await publishThreadsText(env, {
      text,
      imageUrl,
      replyToId,
      accountId: payload.account_id,
      userId,
    });
    const publishedDetails = await fetchThreadsMediaDetails(published.credentials, published.externalId);
    const publishedReplyToId = readThreadsReplyParentId(publishedDetails?.replied_to);

    return jsonResponse({
      success: true,
      external_id: published.externalId,
      account_id: published.accountId,
      permalink: typeof publishedDetails?.permalink === "string" ? publishedDetails.permalink : null,
      replied_to_id: publishedReplyToId,
      verified_reply_target: publishedReplyToId ? publishedReplyToId === replyToId : null,
      reply_audience: typeof publishedDetails?.reply_audience === "string" ? publishedDetails.reply_audience : null,
    });
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

    const pending = JSON.parse(row.value) as PendingThreadsOAuth & { created_at?: string; user_id?: number };
    const pendingUserId = ownerId(pending.user_id);

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
    }, pendingUserId);
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

export async function updateThreadsAccount(
  env: Env,
  accountId: string,
  request: Request,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) return errorResponse("Invalid account ID", 400);

    const filters = ["id = ?", "platform = 'threads'"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "social_accounts", filters, filterValues, scopeId);
    const existing = await env.DB.prepare(`SELECT id FROM social_accounts WHERE ${filters.join(" AND ")}`)
      .bind(...filterValues)
      .first<{ id: number }>();
    if (!existing) return errorResponse("Threads account not found", 404);

    const payload = await parseJson<ThreadsAccountUpdatePayload>(request);
    const now = new Date().toISOString();
    const accountUpdates: string[] = [];
    const accountValues: unknown[] = [];

    if (payload.username !== undefined) {
      const username = payload.username.trim().replace(/^@+/, "");
      if (!username) return errorResponse("username is required", 400);
      accountUpdates.push("username = ?");
      accountValues.push(username);
    }
    if (payload.status !== undefined) {
      if (payload.status !== "active" && payload.status !== "inactive") {
        return errorResponse("Invalid account status", 400);
      }
      accountUpdates.push("status = ?");
      accountValues.push(payload.status);
    }

    const settingUpdates: Array<[string, string]> = [];
    if (payload.client_id?.trim()) settingUpdates.push(["threads_client_id", payload.client_id.trim()]);
    if (payload.client_secret?.trim()) settingUpdates.push(["threads_client_secret", payload.client_secret.trim()]);
    if (payload.redirect_uri?.trim()) settingUpdates.push(["threads_redirect_uri", payload.redirect_uri.trim()]);
    if (payload.scopes?.trim()) settingUpdates.push(["threads_scopes", payload.scopes.trim()]);
    if (payload.access_token?.trim()) settingUpdates.push(["threads_access_token", payload.access_token.trim()]);
    if (payload.user_id?.trim()) settingUpdates.push(["threads_user_id", payload.user_id.trim()]);
    const playwrightLogin = payload.playwright_login?.trim() ?? "";
    const playwrightPassword = payload.playwright_password?.trim() ?? "";
    const connectionMode = payload.connection_mode === "playwright"
      ? "playwright"
      : payload.connection_mode === "official_api"
      ? "official_api"
      : null;

    if (accountUpdates.length === 0 && settingUpdates.length === 0 && !connectionMode && !playwrightLogin && !playwrightPassword) {
      return errorResponse("No account fields to update", 400);
    }

    if (accountUpdates.length > 0) {
      accountUpdates.push("updated_at = ?");
      accountValues.push(now);
      await env.DB.prepare(`UPDATE social_accounts SET ${accountUpdates.join(", ")} WHERE ${filters.join(" AND ")}`)
        .bind(...accountValues, ...filterValues)
        .run();
    } else {
      await env.DB.prepare(`UPDATE social_accounts SET updated_at = ? WHERE ${filters.join(" AND ")}`)
        .bind(now, ...filterValues)
        .run();
    }

    if (connectionMode === "playwright" && !playwrightLogin) {
      const currentPlaywright = await readPlaywrightSettings(env, id, scopeId, dashboardUserId);
      if (!currentPlaywright.login) return errorResponse("Playwright login is required", 400);
    }

    await Promise.all(settingUpdates.flatMap(([key, value]) => {
      const updates = [upsertSetting(env, `social_account:${id}:${key}`, value, now, scopeId)];
      if (key === "threads_access_token" || key === "threads_user_id") {
        updates.push(upsertSetting(env, key, value, now, scopeId));
      }
      return updates;
    }).concat(connectionMode ? [upsertSetting(env, `social_account:${id}:connection_mode`, connectionMode, now, scopeId)] : [])
      .concat(
        playwrightLogin
          ? [upsertSetting(env, playwrightUserSettingKey("social_account", id, dashboardUserId, "login"), playwrightLogin, now, scopeId)]
          : [],
      )
      .concat(
        playwrightPassword
          ? [upsertSetting(env, playwrightUserSettingKey("social_account", id, dashboardUserId, "password"), playwrightPassword, now, scopeId)]
          : [],
      )
      .concat(
        connectionMode === "playwright" || playwrightLogin || playwrightPassword
          ? [
              upsertSetting(
                env,
                playwrightUserSettingKey("social_account", id, dashboardUserId, "profile_key"),
                defaultPlaywrightProfileKey("threads", id, dashboardUserId),
                now,
                scopeId,
              ),
            ]
          : [],
      ));

    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Threads account", 500);
  }
}

export async function deleteThreadsAccount(env: Env, accountId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) return errorResponse("Invalid account ID", 400);
    const filters = ["id = ?", "platform = 'threads'"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "social_accounts", filters, values, userId);
    await env.DB.prepare(`DELETE FROM social_accounts WHERE ${filters.join(" AND ")}`).bind(...values).run();
    const settingsHasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
    const settingsHasUserId = await tableHasUserId(env, "app_settings");
    await env.DB.prepare(settingsHasWorkspaceId
      ? "DELETE FROM app_settings WHERE workspace_id = ? AND key LIKE ?"
      : settingsHasUserId
      ? "DELETE FROM app_settings WHERE user_id = ? AND key LIKE ?"
      : "DELETE FROM app_settings WHERE key LIKE ?")
      .bind(...(settingsHasWorkspaceId ? [workspaceId(userId), `social_account:${id}:%`] : settingsHasUserId ? [ownerId(userId), `social_account:${id}:%`] : [`social_account:${id}:%`]))
      .run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete Threads account", 500);
  }
}
