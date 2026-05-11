import type { Env } from "../lib/types";
import type { RedditCampaign } from "../../src/lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { getSocialPostSchemaCapabilities } from "./twitter";

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
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
};

type RedditSocialPostRow = {
  id: number;
  title: string | null;
  subreddit: string | null;
  content: string;
  status: string;
  external_id: string | null;
  account_id: number | null;
};

type RedditApiThing = {
  kind?: string;
  data?: Record<string, unknown>;
};

type RedditApiListing = {
  data?: {
    children?: RedditApiThing[];
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

async function getActiveRedditAccount(env: Env, requestedAccountId?: number): Promise<RedditAccountRow | null> {
  const requested = requestedAccountId
    ? await env.DB.prepare(
      "SELECT id, name, access_token, refresh_token, token_expires_at FROM reddit_accounts WHERE id = ? AND status = 'active'",
    ).bind(requestedAccountId).first<RedditAccountRow>()
    : null;
  if (requested) return requested;
  return env.DB.prepare(
    "SELECT id, name, access_token, refresh_token, token_expires_at FROM reddit_accounts WHERE status = 'active' ORDER BY updated_at DESC, id DESC LIMIT 1",
  ).first<RedditAccountRow>();
}

async function ensureRedditAccessToken(env: Env, account: RedditAccountRow): Promise<RedditAccountRow> {
  if (!account.token_expires_at || !account.refresh_token || !env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    return account;
  }

  const expiresAt = Date.parse(account.token_expires_at);
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
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
      refresh_token: account.refresh_token,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error("Failed to refresh the Reddit access token.");
  }
  const payload = await response.json() as { access_token?: string; expires_in?: number };
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
  headers.set("Authorization", `Bearer ${account.access_token}`);
  headers.set("User-Agent", "BlogPoster/1.0");
  return fetch(`${REDDIT_API_BASE}${path}`, {
    ...init,
    headers,
  });
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
  const responsePayload = await response.json() as {
    json?: {
      errors?: unknown[];
      data?: {
        name?: string;
      };
    };
  };
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
  const payload = await response.json() as RedditApiListing[];
  if (!response.ok || !Array.isArray(payload) || payload.length < 2) {
    throw new Error("Failed to load Reddit comments.");
  }
  const listing = payload[1];
  const children = listing?.data?.children ?? [];
  return children
    .filter((child) => child.kind === "t1" && child.data)
    .map((child) => child.data as Record<string, unknown>);
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
  const payload = await response.json() as RedditApiListing;
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
  const payload = await response.json() as RedditCommentReplyResponse;
  const errors = payload.json?.errors ?? [];
  const externalId = payload.json?.data?.things?.[0]?.data?.name;
  if (!response.ok || errors.length > 0 || !externalId) {
    const firstError = Array.isArray(errors) && errors.length > 0 ? JSON.stringify(errors[0]) : null;
    throw new Error(firstError || "Reddit reply publishing failed.");
  }
  return externalId;
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

export async function publishRedditPost(env: Env, postId: string): Promise<Response> {
  try {
    const capabilities = await getSocialPostSchemaCapabilities(env);
    if (!capabilities.hasTitle || !capabilities.hasSubreddit) {
      return errorResponse("Apply the latest social_posts migration before publishing Reddit posts.", 400);
    }

    const id = Number(postId);
    if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);
    const post = await env.DB.prepare(
      "SELECT id, title, subreddit, content, status, external_id, account_id FROM social_posts WHERE id = ? AND platform = 'reddit'",
    ).bind(id).first<RedditSocialPostRow>();
    if (!post) return errorResponse("Reddit post not found", 404);
    if (!post.title?.trim()) return errorResponse("Reddit posts need a title.", 400);
    if (!post.subreddit?.trim()) return errorResponse("Reddit posts need a subreddit.", 400);
    if (post.status === "posted") return errorResponse("Post is already published", 400);

    const published = await submitRedditSelfPost(env, {
      title: post.title.trim(),
      subreddit: post.subreddit.trim(),
      text: post.content?.trim() || "",
      accountId: post.account_id,
    });
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE social_posts
       SET status = 'posted', posted_at = ?, external_id = ?, account_id = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(now, published.externalId, published.accountId, now, id)
      .run();
    return jsonResponse({ success: true, external_id: published.externalId, posted_at: now, account_id: published.accountId });
  } catch (error) {
    const id = Number(postId);
    if (!Number.isNaN(id)) {
      const now = new Date().toISOString();
      await env.DB.prepare("UPDATE social_posts SET status = 'failed', updated_at = ? WHERE id = ?")
        .bind(now, id)
        .run();
    }
    return errorResponse(error instanceof Error ? error.message : "Failed to publish Reddit post", 500);
  }
}

export async function listRedditComments(env: Env, postId?: string | null, limit?: string | null): Promise<Response> {
  try {
    const requestedLimit = Math.max(1, Math.min(Number(limit || 10) || 10, 25));
    const account = await getActiveRedditAccount(env);
    if (!account) return jsonResponse({ data: [] });
    const readyAccount = await ensureRedditAccessToken(env, account);

    const targets = postId
      ? await env.DB.prepare(
        "SELECT id, title, subreddit, external_id, account_id FROM social_posts WHERE id = ? AND platform = 'reddit' AND status = 'posted'",
      ).bind(Number(postId)).all<{ id: number; title: string | null; subreddit: string | null; external_id: string | null; account_id: number | null }>()
      : await env.DB.prepare(
        "SELECT id, title, subreddit, external_id, account_id FROM social_posts WHERE platform = 'reddit' AND status = 'posted' ORDER BY posted_at DESC, updated_at DESC LIMIT 5",
      ).all<{ id: number; title: string | null; subreddit: string | null; external_id: string | null; account_id: number | null }>();
    const targetRows = (targets.results ?? []).filter((row) => row.external_id?.trim());

    let effectiveTargets = targetRows;
    if (!effectiveTargets.length) {
      const submissionsResponse = await redditRequest(readyAccount, `/user/${encodeURIComponent(readyAccount.name)}/submitted?limit=5`);
      const submissionsPayload = await submissionsResponse.json() as RedditApiListing;
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
          };
        })
        .filter((row) => row.external_id);
    }

    const commentCollections = await Promise.all(
      effectiveTargets.slice(0, 5).map(async (target) => {
        const comments = await fetchRedditPostComments(readyAccount, String(target.external_id), requestedLimit);
        return comments.map((comment) => ({
          platform: "reddit",
          post_id: target.id,
          post_external_id: target.external_id,
          post_title: target.title,
          subreddit: target.subreddit,
          commenter_username: String(comment.author ?? ""),
          commenter_name: null,
          text: String(comment.body ?? ""),
          commented_at: typeof comment.created_utc === "number"
            ? new Date(Number(comment.created_utc) * 1000).toISOString()
            : null,
          external_id: String(comment.name ?? ""),
          permalink: comment.permalink ? `https://reddit.com${String(comment.permalink)}` : null,
        }));
      }),
    );
    const merged = commentCollections.flat().sort((left, right) => {
      return String(right.commented_at ?? "").localeCompare(String(left.commented_at ?? ""));
    }).slice(0, requestedLimit);
    return jsonResponse({ data: merged });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load Reddit comments", 500);
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
