import type { Env } from "../lib/types";
import type { RedditCampaign } from "../../src/lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { getSocialPostSchemaCapabilities } from "./twitter";
import { DEFAULT_USER_ID, appendScopedFilter, ownerId, scopedInsertColumns, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import { defaultPlaywrightProfileKey, playwrightUserSettingKey } from "../lib/playwright-accounts";
import { markLinkedPlannerItemsPublished } from "../lib/social-publish";

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

type RedditAccountRow = {
  id: number;
  name: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  connection_mode?: "official_api" | "playwright";
  playwright_login?: string | null;
  playwright_password?: string | null;
};

type RedditSocialPostRow = {
  id: number;
  title: string | null;
  subreddit: string | null;
  content: string;
  status: string;
  external_id: string | null;
  account_id: number | null;
  reply_to_id?: string | null;
};

type RedditApiThing = {
  kind?: string;
  data?: Record<string, unknown>;
};

type RedditApiListing = {
  data?: {
    children?: RedditApiThing[];
    after?: string | null;
  };
};

type RedditCommentReplyResponse = {
  json?: {
    errors?: unknown[];
    data?: {
      things?: Array<{
        data?: {
          name?: string;
        };
      }>;
    };
  };
};

const REDDIT_API_BASE = "https://oauth.reddit.com";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_WEB_BASE = "https://www.reddit.com";
const REDDIT_WEB_USER_AGENT = "BlogPoster/1.0 subreddit crawler";

function hasUsableRedditAccessToken(account: RedditAccountRow): boolean {
  return Boolean(account.access_token?.trim());
}

async function readRedditJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    throw new Error(fallbackMessage);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

async function readSetting(env: Env, key: string, userId = DEFAULT_USER_ID): Promise<string | null> {
  const hasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
  const hasUserId = await tableHasUserId(env, "app_settings");
  const row = await env.DB.prepare(hasWorkspaceId
    ? "SELECT value FROM app_settings WHERE workspace_id = ? AND key = ?"
    : hasUserId
    ? "SELECT value FROM app_settings WHERE user_id = ? AND key = ?"
    : "SELECT value FROM app_settings WHERE key = ?")
    .bind(...(hasWorkspaceId ? [workspaceId(userId), key] : hasUserId ? [ownerId(userId), key] : [key]))
    .first<{ value: string }>();
  return row?.value?.trim() || null;
}

async function readPlaywrightSettings(
  env: Env,
  accountId: number,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<{ login: string | null; password: string | null; profileKey: string | null }> {
  const [login, password, profileKey] = await Promise.all([
    readSetting(env, playwrightUserSettingKey("reddit_account", accountId, dashboardUserId, "login"), scopeId),
    readSetting(env, playwrightUserSettingKey("reddit_account", accountId, dashboardUserId, "password"), scopeId),
    readSetting(env, playwrightUserSettingKey("reddit_account", accountId, dashboardUserId, "profile_key"), scopeId),
  ]);
  return { login, password, profileKey };
}

async function getActiveRedditAccount(env: Env, requestedAccountId?: number, userId = DEFAULT_USER_ID): Promise<RedditAccountRow | null> {
  const filters = ["status = 'active'"];
  const values: unknown[] = [];
  if (requestedAccountId) {
    filters.push("id = ?");
    values.push(requestedAccountId);
  }
  await appendScopedFilter(env, "reddit_accounts", filters, values, userId);
  const requested = requestedAccountId
    ? await env.DB.prepare(
      `SELECT id, name, access_token, refresh_token, token_expires_at
       FROM reddit_accounts
       WHERE ${filters.join(" AND ")}`,
    ).bind(...values).first<RedditAccountRow>()
    : null;
  if (requested) return requested;
  return env.DB.prepare(
    `SELECT id, name, access_token, refresh_token, token_expires_at
     FROM reddit_accounts
     WHERE ${filters.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  ).bind(...values).first<RedditAccountRow>();
}

async function ensureRedditAccessToken(env: Env, account: RedditAccountRow): Promise<RedditAccountRow> {
  const refreshToken = account.refresh_token?.trim();
  if (!refreshToken || !env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    return account;
  }

  const expiresAt = account.token_expires_at ? Date.parse(account.token_expires_at) : NaN;
  if (hasUsableRedditAccessToken(account) && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
    return account;
  }

  const response = await fetch(REDDIT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`)}`,
      "User-Agent": "BlogPoster/1.0",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error("Failed to refresh the Reddit access token.");
  }
  const payload = await readRedditJson<{ access_token?: string; expires_in?: number }>(
    response,
    "Failed to refresh the Reddit access token.",
  );
  if (!payload.access_token) {
    throw new Error("Reddit token refresh did not return a usable access token.");
  }
  const updatedAt = new Date().toISOString();
  const expiresAtNext = new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString();
  await env.DB.prepare(
    `UPDATE reddit_accounts
     SET access_token = ?, token_expires_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(payload.access_token, expiresAtNext, updatedAt, account.id)
    .run();
  return {
    ...account,
    access_token: payload.access_token,
    token_expires_at: expiresAtNext,
  };
}

async function redditRequest(account: RedditAccountRow, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${account.access_token ?? ""}`);
  headers.set("User-Agent", "BlogPoster/1.0");
  return fetch(`${REDDIT_API_BASE}${path}`, {
    ...init,
    headers,
  });
}

async function getScopedRedditAccount(
  env: Env,
  userId: number,
  requestedAccountId?: number,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<RedditAccountRow | null> {
  const filters = ["status = 'active'"];
  const values: unknown[] = [];
  if (requestedAccountId) {
    filters.push("id = ?");
    values.push(requestedAccountId);
  }
  await appendScopedFilter(env, "reddit_accounts", filters, values, userId);
  const account = await env.DB.prepare(
    `SELECT id, name, access_token, refresh_token, token_expires_at
     FROM reddit_accounts
     WHERE ${filters.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(...values)
    .first<RedditAccountRow>();
  if (!account) return null;

  const [connectionMode, playwright] = await Promise.all([
    readSetting(env, `reddit_account:${account.id}:connection_mode`, userId),
    readPlaywrightSettings(env, account.id, userId, dashboardUserId),
  ]);
  return {
    ...account,
    connection_mode: connectionMode === "playwright" ? "playwright" : "official_api",
    playwright_login: playwright.login,
    playwright_password: playwright.password,
  };
}

function normalizeSubscribedSubreddit(data: Record<string, unknown>) {
  const name = String(data.display_name ?? "").trim();
  const displayName = String(data.display_name_prefixed ?? (name ? `r/${name}` : "")).trim();
  return {
    name,
    display_name: displayName || name,
    title: data.title ? String(data.title) : null,
    description: data.public_description ? String(data.public_description) : null,
    subscribers: typeof data.subscribers === "number" ? data.subscribers : null,
    over18: Boolean(data.over18),
    icon_url: data.icon_img ? String(data.icon_img) : null,
  };
}

type RedditSubredditOption = ReturnType<typeof normalizeSubscribedSubreddit>;

function normalizeSubredditName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^\/?r\//i, "")
    .replace(/[^A-Za-z0-9_]/g, "");
}

function subredditOptionFromName(value: unknown): RedditSubredditOption | null {
  const name = normalizeSubredditName(value);
  if (!name) return null;
  return normalizeSubscribedSubreddit({
    display_name: name,
    display_name_prefixed: `r/${name}`,
  });
}

function uniqueSubredditOptions(subreddits: RedditSubredditOption[]): RedditSubredditOption[] {
  return Array.from(
    new Map(subreddits.filter((subreddit) => subreddit.name).map((subreddit) => [
      subreddit.name.toLowerCase(),
      subreddit,
    ])).values(),
  ).sort((left, right) => left.name.localeCompare(right.name));
}

function cookieHeaderFromSetCookie(value: string | null): string {
  if (!value) return "";
  return value
    .split(/,(?=\s*[^;,\s]+=)/g)
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function possibleRedditUsernames(account: RedditAccountRow): string[] {
  const candidates = [account.name, account.playwright_login]
    .map((value) => String(value ?? "")
      .trim()
      .replace(/^@/, "")
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .trim())
    .filter((value) => /^[A-Za-z0-9_-]{3,20}$/.test(value));
  return Array.from(new Set(candidates));
}

async function fetchRedditWebListing(url: string, cookieHeader?: string): Promise<RedditApiListing | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": REDDIT_WEB_USER_AGENT,
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  try {
    return await response.json() as RedditApiListing;
  } catch {
    return null;
  }
}

async function getRedditWebLoginCookie(account: RedditAccountRow): Promise<string> {
  const username = account.playwright_login?.trim() || account.name.trim();
  const password = account.playwright_password?.trim() || "";
  if (!username || !password) return "";

  const response = await fetch(`${REDDIT_WEB_BASE}/api/login/${encodeURIComponent(username)}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_WEB_USER_AGENT,
    },
    body: new URLSearchParams({
      api_type: "json",
      user: username,
      passwd: password,
      rem: "true",
    }).toString(),
    redirect: "manual",
  });

  let payload: { json?: { errors?: unknown[] } } | null = null;
  try {
    payload = await response.json() as { json?: { errors?: unknown[] } };
  } catch {
    payload = null;
  }
  const errors = payload?.json?.errors ?? [];
  if (!response.ok || errors.length > 0) return "";
  return cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
}

async function loadSubscribedSubredditsFromRedditWeb(account: RedditAccountRow): Promise<RedditSubredditOption[]> {
  const cookieHeader = await getRedditWebLoginCookie(account);
  if (!cookieHeader) return [];

  const subreddits: RedditSubredditOption[] = [];
  let after: string | null = null;

  for (let page = 0; page < 3; page += 1) {
    const params = new URLSearchParams({ limit: "100", raw_json: "1" });
    if (after) params.set("after", after);
    const payload = await fetchRedditWebListing(`${REDDIT_WEB_BASE}/subreddits/mine/subscriber.json?${params.toString()}`, cookieHeader);
    if (!payload) break;

    const children = payload.data?.children ?? [];
    children
      .filter((child) => child.kind === "t5" && child.data)
      .map((child) => normalizeSubscribedSubreddit(child.data as Record<string, unknown>))
      .filter((subreddit) => subreddit.name)
      .forEach((subreddit) => subreddits.push(subreddit));

    after = payload.data?.after ?? null;
    if (!after) break;
  }

  return uniqueSubredditOptions(subreddits);
}

async function loadSubredditsFromPublicRedditActivity(account: RedditAccountRow): Promise<RedditSubredditOption[]> {
  const usernames = possibleRedditUsernames(account);
  const subreddits: RedditSubredditOption[] = [];

  for (const username of usernames) {
    const endpoints = ["submitted", "comments", "overview"];
    for (const endpoint of endpoints) {
      const payload = await fetchRedditWebListing(
        `${REDDIT_WEB_BASE}/user/${encodeURIComponent(username)}/${endpoint}.json?limit=100&raw_json=1`,
      );
      const children = payload?.data?.children ?? [];
      children
        .filter((child) => child.data)
        .map((child) => subredditOptionFromName((child.data as Record<string, unknown>).subreddit))
        .filter((subreddit): subreddit is RedditSubredditOption => Boolean(subreddit))
        .forEach((subreddit) => subreddits.push(subreddit));
    }
    if (subreddits.length > 0) break;
  }

  return uniqueSubredditOptions(subreddits);
}

async function loadPlaywrightRedditSubreddits(
  account: RedditAccountRow,
): Promise<{ data: RedditSubredditOption[]; warning?: string }> {
  const subscribed = await loadSubscribedSubredditsFromRedditWeb(account);
  if (subscribed.length > 0) {
    return { data: subscribed };
  }

  const publicActivity = await loadSubredditsFromPublicRedditActivity(account);
  if (publicActivity.length > 0) {
    return {
      data: publicActivity,
      warning: "Could not crawl Reddit subscriptions from the Playwright session, so suggestions are from public Reddit activity. You can still type any subreddit.",
    };
  }

  return {
    data: [],
    warning: "Could not crawl subscribed subreddits for this Playwright account. Type the target subreddit manually.",
  };
}

async function submitRedditSelfPost(
  env: Env,
  payload: { title: string; subreddit: string; text?: string; accountId?: number | null },
): Promise<{ externalId: string; accountId: number }> {
  const account = await getActiveRedditAccount(env, payload.accountId ? Number(payload.accountId) : undefined);
  if (!account) throw new Error("No active Reddit account is connected.");
  const readyAccount = await ensureRedditAccessToken(env, account);
  const response = await redditRequest(readyAccount, "/api/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      api_type: "json",
      kind: "self",
      sr: payload.subreddit.replace(/^r\//i, ""),
      title: payload.title,
      text: payload.text ?? "",
    }).toString(),
  });
  const responsePayload = await readRedditJson<{
    json?: {
      errors?: unknown[];
      data?: {
        name?: string;
      };
    };
  }>(response, "Reddit post publishing failed.");
  const errors = responsePayload.json?.errors ?? [];
  const externalId = responsePayload.json?.data?.name;
  if (!response.ok || errors.length > 0 || !externalId) {
    const firstError = Array.isArray(errors) && errors.length > 0 ? JSON.stringify(errors[0]) : null;
    throw new Error(firstError || "Reddit post publishing failed.");
  }
  return { externalId, accountId: readyAccount.id };
}

async function fetchRedditPostComments(
  account: RedditAccountRow,
  externalId: string,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const slug = externalId.replace(/^t3_/, "");
  const response = await redditRequest(account, `/comments/${encodeURIComponent(slug)}.json?limit=${limit}`);
  const payload = await readRedditJson<RedditApiListing[]>(response, "Failed to load Reddit comments.");
  if (!response.ok || !Array.isArray(payload) || payload.length < 2) {
    throw new Error("Failed to load Reddit comments.");
  }
  const listing = payload[1];
  const children = listing?.data?.children ?? [];
  return children
    .filter((child) => child.kind === "t1" && child.data)
    .map((child) => child.data as Record<string, unknown>);
}

function normalizeRedditUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function getRedditReplyChildren(value: unknown): RedditApiThing[] {
  if (!value || typeof value !== "object") return [];
  const listing = value as { data?: { children?: RedditApiThing[] } };
  return Array.isArray(listing.data?.children) ? listing.data.children : [];
}

function findLatestOwnedRedditReply(comment: Record<string, unknown>, ownerUsername: string): Record<string, unknown> | null {
  const replies = getRedditReplyChildren(comment.replies);
  const ownedReplies = replies
    .filter((child) => child.kind === "t1" && child.data)
    .map((child) => child.data as Record<string, unknown>)
    .filter((reply) => normalizeRedditUsername(reply.author) === ownerUsername);

  if (ownedReplies.length === 0) return null;

  return ownedReplies.reduce<Record<string, unknown>>((latest, reply) => {
    const latestCreated = Number(latest.created_utc ?? 0);
    const replyCreated = Number(reply.created_utc ?? 0);
    return replyCreated > latestCreated ? reply : latest;
  }, ownedReplies[0]);
}

async function searchRedditSubmissions(
  account: RedditAccountRow,
  subreddit: string,
  query: string,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const path = `/r/${encodeURIComponent(subreddit.replace(/^r\//i, ""))}/search.json?` + new URLSearchParams({
    q: query,
    restrict_sr: "1",
    sort: "new",
    t: "week",
    type: "link",
    limit: String(limit),
  }).toString();
  const response = await redditRequest(account, path);
  const payload = await readRedditJson<RedditApiListing>(response, "Failed to search Reddit posts.");
  if (!response.ok) {
    throw new Error("Failed to search Reddit posts.");
  }
  const children = payload.data?.children ?? [];
  return children
    .filter((child) => child.kind === "t3" && child.data)
    .map((child) => child.data as Record<string, unknown>);
}

async function submitRedditReply(
  account: RedditAccountRow,
  replyToId: string,
  text: string,
): Promise<string> {
  const response = await redditRequest(account, "/api/comment", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      api_type: "json",
      thing_id: replyToId,
      text,
    }).toString(),
  });
  const payload = await readRedditJson<RedditCommentReplyResponse>(response, "Reddit reply publishing failed.");
  const errors = payload.json?.errors ?? [];
  const externalId = payload.json?.data?.things?.[0]?.data?.name;
  if (!response.ok || errors.length > 0 || !externalId) {
    const firstError = Array.isArray(errors) && errors.length > 0 ? JSON.stringify(errors[0]) : null;
    throw new Error(firstError || "Reddit reply publishing failed.");
  }
  return externalId;
}

export async function listCampaigns(env: Env, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const filters: string[] = [];
    const values: unknown[] = [];
    await appendScopedFilter(env, "reddit_campaigns", filters, values, userId);
    const campaigns = await env.DB.prepare(
      `SELECT * FROM reddit_campaigns ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY created_at DESC`,
    ).bind(...values).all();

    return jsonResponse(campaigns.results || []);
  } catch (error) {
    return errorResponse("Failed to fetch campaigns", 500);
  }
}

export async function createCampaign(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<CreateCampaignPayload>(request);

    // Validate required fields
    if (!payload.name || !payload.subreddit || !payload.search_query) {
      return errorResponse("Missing required fields", 400);
    }

    const now = new Date().toISOString();
    const scoped = await scopedInsertColumns(env, "reddit_campaigns", userId);
    const result = await env.DB.prepare(
      `INSERT INTO reddit_campaigns (
        ${scoped.columns.length ? "user_id," : ""}
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
      ) VALUES (${scoped.columns.length ? "?," : ""}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
      .bind(
        ...scoped.values,
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
  userId = DEFAULT_USER_ID,
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
    const filters = ["id = ?"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "reddit_campaigns", filters, filterValues, userId);

    const query = `UPDATE reddit_campaigns SET ${updates.join(", ")} WHERE ${filters.join(" AND ")}`;
    await env.DB.prepare(query).bind(...values, ...filterValues).run();

    return jsonResponse({ success: true, updated_at: now });
  } catch (error) {
    return errorResponse("Failed to update campaign", 500);
  }
}

export async function deleteCampaign(env: Env, campaignId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(campaignId);
    if (isNaN(id)) {
      return errorResponse("Invalid campaign ID", 400);
    }

    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "reddit_campaigns", filters, values, userId);
    await env.DB.prepare(`DELETE FROM reddit_campaigns WHERE ${filters.join(" AND ")}`).bind(...values).run();

    return jsonResponse({ success: true });
  } catch (error) {
    return errorResponse("Failed to delete campaign", 500);
  }
}

export async function publishRedditPost(
  env: Env,
  postId: string,
  userId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const capabilities = await getSocialPostSchemaCapabilities(env);
    if (!capabilities.hasTitle || !capabilities.hasSubreddit) {
      return errorResponse("Apply the latest social_posts migration before publishing Reddit posts.", 400);
    }

    const id = Number(postId);
    if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);
    const replySelect = capabilities.hasReplyToId ? "reply_to_id" : "NULL AS reply_to_id";
    const filters = ["id = ?", "platform = 'reddit'"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "social_posts", filters, values, userId);
    const post = await env.DB.prepare(
      `SELECT id, title, subreddit, content, status, external_id, account_id, ${replySelect}
       FROM social_posts
       WHERE ${filters.join(" AND ")}`,
    ).bind(...values).first<RedditSocialPostRow>();
    if (!post) return errorResponse("Reddit post not found", 404);
    const isReply = Boolean(post.reply_to_id?.trim());
    if (!isReply && !post.title?.trim()) return errorResponse("Reddit posts need a title.", 400);
    if (!isReply && !post.subreddit?.trim()) return errorResponse("Reddit posts need a subreddit.", 400);
    if (isReply && !post.content?.trim()) return errorResponse("Reddit replies need text.", 400);
    if (post.status === "posted") return errorResponse("Post is already published", 400);

    const account = await getActiveRedditAccount(env, post.account_id ?? undefined, userId);
    if (!account) return errorResponse("No active Reddit account is connected.", 400);
    const connectionMode = await readSetting(env, `reddit_account:${account.id}:connection_mode`, userId);
    if (connectionMode === "playwright") {
      const playwright = await readPlaywrightSettings(env, account.id, userId, dashboardUserId);
      const profileKey = playwright.profileKey || defaultPlaywrightProfileKey("reddit", account.id, dashboardUserId);
      return errorResponse(
        `This Reddit account is set to Playwright. Browser publishing must run through profile ${profileKey}; the Worker will not use official API credentials for it.`,
        501,
      );
    }
    const readyAccount = await ensureRedditAccessToken(env, account);
    const externalId = isReply
      ? await submitRedditReply(readyAccount, post.reply_to_id?.trim() || "", post.content?.trim() || "")
      : (await submitRedditSelfPost(env, {
        title: post.title?.trim() || "",
        subreddit: post.subreddit?.trim() || "",
        text: post.content?.trim() || "",
        accountId: readyAccount.id,
      })).externalId;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE social_posts
       SET status = 'posted', posted_at = ?, external_id = ?, account_id = ?, updated_at = ?
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(now, externalId, readyAccount.id, now, ...values)
      .run();
    await markLinkedPlannerItemsPublished(env, id, now);
    return jsonResponse({ success: true, external_id: externalId, posted_at: now, account_id: readyAccount.id });
  } catch (error) {
    const id = Number(postId);
    if (!Number.isNaN(id)) {
      const now = new Date().toISOString();
      const filters = ["id = ?"];
      const values: unknown[] = [id];
      await appendScopedFilter(env, "social_posts", filters, values, userId);
      await env.DB.prepare(`UPDATE social_posts SET status = 'failed', updated_at = ? WHERE ${filters.join(" AND ")}`)
        .bind(now, ...values)
        .run();
    }
    return errorResponse(error instanceof Error ? error.message : "Failed to publish Reddit post", 500);
  }
}

export async function listRedditComments(env: Env, postId?: string | null, limit?: string | null): Promise<Response> {
  try {
    const requestedLimit = Math.max(1, Math.min(Number(limit || 100) || 100, 100));
    const account = await getActiveRedditAccount(env);
    if (!account) return jsonResponse({ data: [] });
    const readyAccount = await ensureRedditAccessToken(env, account);
    if (!hasUsableRedditAccessToken(readyAccount)) {
      return jsonResponse({
        data: [],
        warning: "Reddit account is not connected yet.",
      });
    }

    const targets = postId
      ? await env.DB.prepare(
        "SELECT id, title, subreddit, external_id, account_id, image_url FROM social_posts WHERE id = ? AND platform = 'reddit' AND status = 'posted'",
      ).bind(Number(postId)).all<{ id: number; title: string | null; subreddit: string | null; external_id: string | null; account_id: number | null; image_url: string | null }>()
      : await env.DB.prepare(
        "SELECT id, title, subreddit, external_id, account_id, image_url FROM social_posts WHERE platform = 'reddit' AND status = 'posted' ORDER BY posted_at DESC, updated_at DESC",
      ).all<{ id: number; title: string | null; subreddit: string | null; external_id: string | null; account_id: number | null; image_url: string | null }>();
    const targetRows = (targets.results ?? []).filter((row) => row.external_id?.trim());

    let effectiveTargets = targetRows;
    if (!effectiveTargets.length) {
      const submissionsResponse = await redditRequest(readyAccount, `/user/${encodeURIComponent(readyAccount.name)}/submitted?limit=100`);
      const submissionsPayload = await readRedditJson<RedditApiListing>(
        submissionsResponse,
        "Failed to load Reddit comments.",
      );
      if (!submissionsResponse.ok) {
        throw new Error("Failed to load Reddit comments.");
      }
      const children = submissionsPayload.data?.children ?? [];
      effectiveTargets = children
        .filter((child) => child.kind === "t3" && child.data)
        .map((child) => {
          const data = child.data as Record<string, unknown>;
          return {
            id: 0,
            title: String(data.title ?? ""),
            subreddit: String(data.subreddit ?? ""),
            external_id: String(data.name ?? ""),
            account_id: readyAccount.id,
            image_url: null,
          };
        })
        .filter((row) => row.external_id);
    }

    const commentCollections = await Promise.all(
      effectiveTargets.map(async (target) => {
        const comments = await fetchRedditPostComments(readyAccount, String(target.external_id), requestedLimit);
        return comments
          .filter((comment) => String(comment.author ?? "").trim().toLowerCase() !== readyAccount.name.trim().toLowerCase())
          .map((comment) => {
            const ownerReply = findLatestOwnedRedditReply(comment, readyAccount.name.trim().toLowerCase());
            return {
            platform: "reddit",
            post_id: target.id,
            post_external_id: target.external_id,
            post_title: target.title,
            post_image_url: target.image_url ?? null,
            subreddit: target.subreddit,
            commenter_username: String(comment.author ?? ""),
            commenter_name: null,
            text: String(comment.body ?? ""),
            commented_at: typeof comment.created_utc === "number"
              ? new Date(Number(comment.created_utc) * 1000).toISOString()
              : null,
            external_id: String(comment.name ?? ""),
            parent_external_id: comment.parent_id ? String(comment.parent_id) : null,
            permalink: comment.permalink ? `https://reddit.com${String(comment.permalink)}` : null,
            reply_status: ownerReply ? "replied" : "new",
            owner_reply_text: ownerReply ? String(ownerReply.body ?? "") : null,
            owner_replied_at: ownerReply && typeof ownerReply.created_utc === "number"
              ? new Date(Number(ownerReply.created_utc) * 1000).toISOString()
              : null,
            owner_reply_external_id: ownerReply ? String(ownerReply.name ?? "") : null,
            owner_reply_permalink: ownerReply?.permalink ? `https://reddit.com${String(ownerReply.permalink)}` : null,
          };
          });
      }),
    );
    const merged = commentCollections.flat().sort((left, right) => {
      return String(right.commented_at ?? "").localeCompare(String(left.commented_at ?? ""));
    });
    return jsonResponse({ data: merged });
  } catch (error) {
    console.warn("Failed to load Reddit comments", error);
    return jsonResponse({
      data: [],
      warning: error instanceof Error ? error.message : "Failed to load Reddit comments",
    });
  }
}

export async function listRedditSubscribedSubreddits(
  env: Env,
  url: URL,
  userId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const requestedAccountId = Number(url.searchParams.get("account_id") || 0) || undefined;
    const account = await getScopedRedditAccount(env, userId, requestedAccountId, dashboardUserId);
    if (!account) {
      return jsonResponse({ data: [], account_id: null, account_name: null });
    }

    const readyAccount = await ensureRedditAccessToken(env, account);
    if (readyAccount.connection_mode === "playwright") {
      const crawled = await loadPlaywrightRedditSubreddits(readyAccount);
      return jsonResponse({
        data: crawled.data,
        account_id: readyAccount.id,
        account_name: readyAccount.name,
        warning: crawled.warning,
      });
    }

    if (!hasUsableRedditAccessToken(readyAccount)) {
      return jsonResponse({
        data: [],
        account_id: readyAccount.id,
        account_name: readyAccount.name,
        warning: "Connect Reddit with Official API to load subscribed subreddits.",
      });
    }

    const subreddits: ReturnType<typeof normalizeSubscribedSubreddit>[] = [];
    let after: string | null = null;

    for (let page = 0; page < 3; page += 1) {
      const params = new URLSearchParams({ limit: "100" });
      if (after) params.set("after", after);
      const response = await redditRequest(readyAccount, `/subreddits/mine/subscriber?${params.toString()}`);
      const payload = await readRedditJson<RedditApiListing>(response, "Failed to load subscribed subreddits.");
      if (!response.ok) {
        throw new Error("Failed to load subscribed subreddits.");
      }

      const children = payload.data?.children ?? [];
      children
        .filter((child) => child.kind === "t5" && child.data)
        .map((child) => normalizeSubscribedSubreddit(child.data as Record<string, unknown>))
        .filter((subreddit) => subreddit.name)
        .forEach((subreddit) => subreddits.push(subreddit));

      after = payload.data?.after ?? null;
      if (!after) break;
    }

    const unique = uniqueSubredditOptions(subreddits);

    return jsonResponse({
      data: unique,
      account_id: readyAccount.id,
      account_name: readyAccount.name,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load subscribed subreddits", 500);
  }
}

export async function searchRedditPosts(env: Env, url: URL): Promise<Response> {
  try {
    const rawQuery = url.searchParams.get("q")?.trim();
    const subreddit = url.searchParams.get("subreddit")?.trim().replace(/^r\//i, "") || "";
    if (!rawQuery) return errorResponse("Search query is required", 400);
    if (!subreddit) return errorResponse("Subreddit is required", 400);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 10) || 10, 25));
    const requestedAccountId = Number(url.searchParams.get("account_id") || 0) || undefined;
    const account = await getActiveRedditAccount(env, requestedAccountId);
    if (!account) return errorResponse("No active Reddit account is connected.", 400);
    const readyAccount = await ensureRedditAccessToken(env, account);
    const results = await searchRedditSubmissions(readyAccount, subreddit, rawQuery, limit);
    return jsonResponse({
      data: results.map((item) => ({
        post_id: String(item.name ?? ""),
        subreddit: String(item.subreddit ?? subreddit),
        title: String(item.title ?? ""),
        text: String(item.selftext ?? ""),
        username: String(item.author ?? ""),
        created_at: typeof item.created_utc === "number"
          ? new Date(Number(item.created_utc) * 1000).toISOString()
          : null,
        permalink: item.permalink ? `https://reddit.com${String(item.permalink)}` : null,
      })),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to search Reddit posts", 500);
  }
}

export async function createRedditReply(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<{ reply_to_id?: string; text?: string; account_id?: number | null }>(request);
    const replyToId = payload.reply_to_id?.trim() || "";
    const text = payload.text?.trim() || "";
    if (!replyToId || !text) {
      return errorResponse("reply_to_id and text are required", 400);
    }
    const account = await getActiveRedditAccount(env, payload.account_id ? Number(payload.account_id) : undefined);
    if (!account) return errorResponse("No active Reddit account is connected.", 400);
    const readyAccount = await ensureRedditAccessToken(env, account);
    const externalId = await submitRedditReply(readyAccount, replyToId, text);
    return jsonResponse({
      success: true,
      external_id: externalId,
      account_id: readyAccount.id,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to publish Reddit reply", 500);
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
