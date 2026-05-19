import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";

const IMAGE_URL_ALIASES = ["image_url", "imageUrl", "imageURL", "image", "photo", "picture", "media", "media_url", "mediaUrl", "media_urls", "mediaUrls", "url"] as const;

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

type SocialPostRow = {
  id: number;
  platform: string;
  status: string;
  external_id: string | null;
};

type TwitterPublishError = {
  message: string;
  status: number;
};

type SocialPostSchemaCapabilities = {
  hasTitle: boolean;
  hasSubreddit: boolean;
  hasAccountId: boolean;
  hasReplyToId: boolean;
};

function extractImageUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractImageUrl(item);
      if (extracted) return extracted;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of IMAGE_URL_ALIASES) {
      const extracted = extractImageUrl(record[key]);
      if (extracted) return extracted;
    }
  }
  return undefined;
}

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

export async function getSocialPostSchemaCapabilities(env: Env): Promise<SocialPostSchemaCapabilities> {
  const columns = await env.DB.prepare("PRAGMA table_info(social_posts)").all<{ name: string }>();
  const names = new Set((columns.results ?? []).map((column) => String(column.name || "").trim().toLowerCase()));
  return {
    hasTitle: names.has("title"),
    hasSubreddit: names.has("subreddit"),
    hasAccountId: names.has("account_id"),
    hasReplyToId: names.has("reply_to_id"),
  };
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
  queryParams?: Record<string, string>,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const signatureParams = {
    ...oauthParams,
    ...(queryParams ?? {}),
  };

  const parameterString = Object.entries(signatureParams)
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

async function deleteTwitterPostExternally(env: Env, externalId: string): Promise<void> {
  const credentials = await getTwitterCredentials(env);
  if (!credentials) throw new Error("No active Twitter/X account with API credentials was found.");

  const endpoint = `https://api.twitter.com/2/tweets/${encodeURIComponent(externalId)}`;
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      Authorization: await buildTwitterOAuthHeader("DELETE", endpoint, credentials),
    },
  });
  const payload = await response.json() as {
    data?: { deleted?: boolean };
    detail?: string;
    title?: string;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || payload.data?.deleted !== true) {
    const message = payload.detail
      || payload.title
      || payload.errors?.map((error) => error.message).filter(Boolean).join("; ")
      || "Twitter/X delete failed";
    throw new Error(message);
  }
}

function extractTwitterErrorMessage(
  payload: { detail?: string; title?: string; errors?: Array<{ message?: string }> },
  fallback: string,
): string {
  return (
    payload.detail
    || payload.title
    || payload.errors?.map((error) => error.message).filter(Boolean).join("; ")
    || fallback
  );
}

function classifyTwitterPublishError(message: string): TwitterPublishError {
  const normalized = message.trim();
  if (/does not have any credits/i.test(normalized)) {
    return {
      status: 402,
      message: "The connected Twitter/X account has no posting credits left. Add credits or switch to an account/project with posting access, then try again.",
    };
  }
  return {
    status: 500,
    message: normalized || "Failed to publish Twitter/X post",
  };
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
    const payload = await parseJson<{
      content?: string;
      scheduled_at?: string;
      image_url?: string;
      title?: string;
      subreddit?: string;
      account_id?: number | null;
      reply_to_id?: string | null;
    }>(request);
    const content = payload.content?.trim() ?? "";
    const imageUrl = payload.image_url?.trim() ?? "";
    const title = payload.title?.trim() ?? "";
    const subreddit = payload.subreddit?.trim().replace(/^r\//i, "") ?? "";
    const capabilities = await getSocialPostSchemaCapabilities(env);
    const requiresRedditMetadata = platform === "reddit";
    if (requiresRedditMetadata && !capabilities.hasTitle && !capabilities.hasSubreddit) {
      return errorResponse("Apply the latest social_posts migration before creating Reddit posts.", 400);
    }
    if (!content && !imageUrl && !title) {
      return errorResponse("content or image_url is required", 400);
    }
    const now = new Date().toISOString();
    const status = payload.scheduled_at ? "scheduled" : "draft";
    const columns = ["platform", "content", "image_url", "status", "scheduled_at", "created_by", "created_at", "updated_at"];
    const values: Array<string | number | null> = [platform, content, imageUrl || null, status, payload.scheduled_at ?? null, "dashboard", now, now];
    if (capabilities.hasTitle) {
      columns.push("title");
      values.push(title || null);
    }
    if (capabilities.hasSubreddit) {
      columns.push("subreddit");
      values.push(subreddit || null);
    }
    if (capabilities.hasAccountId) {
      columns.push("account_id");
      values.push(payload.account_id ?? null);
    }
    if (capabilities.hasReplyToId) {
      columns.push("reply_to_id");
      values.push(payload.reply_to_id?.trim() || null);
    }
    const placeholders = columns.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `INSERT INTO social_posts (${columns.join(", ")})
       VALUES (${placeholders})`,
    )
      .bind(...values)
      .run() as { meta: { last_row_id: number } };

    return jsonResponse({
      id: result.meta.last_row_id,
      platform,
      title: title || null,
      subreddit: subreddit || null,
      account_id: payload.account_id ?? null,
      reply_to_id: payload.reply_to_id?.trim() || null,
      content,
      image_url: imageUrl || null,
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
    const payload = await parseJson<{
      content?: string;
      image_url?: string | null;
      imageUrl?: string | null;
      imageURL?: string | null;
      image?: unknown;
      photo?: unknown;
      picture?: unknown;
      media?: unknown;
      media_url?: string | null;
      mediaUrl?: string | null;
      media_urls?: unknown;
      mediaUrls?: unknown;
      url?: string | null;
      status?: string;
      scheduled_at?: string;
      scheduledAt?: string;
      title?: string | null;
      subreddit?: string | null;
      account_id?: number | null;
      reply_to_id?: string | null;
    }>(request);
    const now = new Date().toISOString();
    const capabilities = await getSocialPostSchemaCapabilities(env);

    const updates: string[] = [];
    const values: unknown[] = [];
    let imageUrl: string | null | undefined = payload.image_url;
    if (imageUrl === undefined) {
      imageUrl = extractImageUrl(payload);
    }
    const scheduledAt = payload.scheduled_at ?? payload.scheduledAt;

    if (payload.content !== undefined) { updates.push("content = ?"); values.push(payload.content); }
    if (imageUrl !== undefined) { updates.push("image_url = ?"); values.push(imageUrl); }
    if (payload.status !== undefined) { updates.push("status = ?"); values.push(payload.status); }
    if (scheduledAt !== undefined) { updates.push("scheduled_at = ?"); values.push(scheduledAt); }
    if (capabilities.hasTitle && payload.title !== undefined) { updates.push("title = ?"); values.push(payload.title?.trim() || null); }
    if (capabilities.hasSubreddit && payload.subreddit !== undefined) { updates.push("subreddit = ?"); values.push(payload.subreddit?.trim().replace(/^r\//i, "") || null); }
    if (capabilities.hasAccountId && payload.account_id !== undefined) { updates.push("account_id = ?"); values.push(payload.account_id); }
    if (capabilities.hasReplyToId && payload.reply_to_id !== undefined) { updates.push("reply_to_id = ?"); values.push(payload.reply_to_id?.trim() || null); }

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
    const post = await env.DB.prepare(
      "SELECT id, platform, status, external_id FROM social_posts WHERE id = ?",
    )
      .bind(id)
      .first<SocialPostRow>();
    if (!post) return errorResponse("Post not found", 404);

    const externalId = post.external_id?.trim() || "";
    const isPublished = post.status === "posted";

    if (isPublished && externalId) {
      if (post.platform === "twitter") {
        await deleteTwitterPostExternally(env, externalId);
      }
    }

    await env.DB.prepare("DELETE FROM planner_items WHERE social_post_id = ?").bind(id).run();
    await env.DB.prepare("DELETE FROM social_posts WHERE id = ?").bind(id).run();
    const dashboardOnly = isPublished && Boolean(externalId) && post.platform === "threads";
    return jsonResponse({
      success: true,
      external_deleted: isPublished && Boolean(externalId) && post.platform === "twitter",
      dashboard_only: dashboardOnly,
      platform: post.platform,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to delete post", 500);
  }
}

type TwitterMeResponse = {
  data?: {
    id?: string;
    username?: string;
    name?: string;
  };
};

type TwitterMentionsResponse = {
  data?: Array<{
    id?: string;
    author_id?: string;
    conversation_id?: string;
    text?: string;
    created_at?: string;
  }>;
  includes?: {
    users?: Array<{
      id?: string;
      username?: string;
      name?: string;
    }>;
  };
};

async function fetchTwitterMe(env: Env): Promise<{ id: string; username: string; name?: string }> {
  const credentials = await getTwitterCredentials(env);
  if (!credentials) throw new Error("No active Twitter/X account with API credentials was found.");

  const endpoint = "https://api.twitter.com/2/users/me?user.fields=username,name";
  const meQueryParams = { "user.fields": "username,name" };
  const response = await fetch(endpoint, {
    headers: {
      Authorization: await buildTwitterOAuthHeader("GET", "https://api.twitter.com/2/users/me", credentials, meQueryParams),
    },
  });
  const payload = await response.json() as TwitterMeResponse & { detail?: string; title?: string; errors?: Array<{ message?: string }> };
  if (!response.ok || !payload.data?.id || !payload.data.username) {
    throw new Error(extractTwitterErrorMessage(payload, "Failed to load the connected Twitter/X account."));
  }
  return {
    id: payload.data.id,
    username: payload.data.username,
    name: payload.data.name,
  };
}

export async function listTwitterComments(env: Env, postId?: string | null, limit?: string | null): Promise<Response> {
  try {
    const me = await fetchTwitterMe(env);
    const requestedLimit = Math.max(1, Math.min(Number(limit || 20) || 20, 100));
    const targets = postId
      ? await env.DB.prepare(
        "SELECT id, external_id, content FROM social_posts WHERE id = ? AND platform = 'twitter' AND status = 'posted'",
      ).bind(Number(postId)).all<{ id: number; external_id: string | null; content: string }>()
      : await env.DB.prepare(
        "SELECT id, external_id, content FROM social_posts WHERE platform = 'twitter' AND status = 'posted' ORDER BY posted_at DESC, updated_at DESC LIMIT 10",
      ).all<{ id: number; external_id: string | null; content: string }>();
    const targetRows = (targets.results ?? []).filter((row) => row.external_id?.trim());
    const targetMap = new Map(targetRows.map((row) => [String(row.external_id).trim(), row]));
    if (!targetMap.size) return jsonResponse({ data: [] });

    const endpoint = new URL(`https://api.twitter.com/2/users/${encodeURIComponent(me.id)}/mentions`);
    endpoint.searchParams.set("max_results", String(requestedLimit));
    endpoint.searchParams.set("tweet.fields", "author_id,conversation_id,created_at,text");
    endpoint.searchParams.set("expansions", "author_id");
    endpoint.searchParams.set("user.fields", "username,name");
    const baseEndpoint = `https://api.twitter.com/2/users/${encodeURIComponent(me.id)}/mentions`;
    const mentionsQueryParams = {
      max_results: String(requestedLimit),
      "tweet.fields": "author_id,conversation_id,created_at,text",
      expansions: "author_id",
      "user.fields": "username,name",
    };
    const credentials = await getTwitterCredentials(env);
    if (!credentials) throw new Error("No active Twitter/X account with API credentials was found.");
    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: await buildTwitterOAuthHeader("GET", baseEndpoint, credentials, mentionsQueryParams),
      },
    });
    const payload = await response.json() as TwitterMentionsResponse & { detail?: string; title?: string; errors?: Array<{ message?: string }> };
    if (!response.ok) {
      throw new Error(extractTwitterErrorMessage(payload, "Failed to load Twitter/X comments."));
    }

    const users = new Map(
      (payload.includes?.users ?? [])
        .filter((user) => user.id)
        .map((user) => [String(user.id), user]),
    );
    const comments = (payload.data ?? [])
      .filter((tweet) => tweet.author_id && tweet.author_id !== me.id)
      .filter((tweet) => tweet.conversation_id && targetMap.has(String(tweet.conversation_id)))
      .map((tweet) => {
        const author = users.get(String(tweet.author_id));
        const target = targetMap.get(String(tweet.conversation_id));
        return {
          platform: "twitter",
          post_id: target?.id ?? null,
          post_external_id: tweet.conversation_id ?? null,
          post_preview: target?.content?.slice(0, 120) ?? null,
          commenter_username: author?.username ?? null,
          commenter_name: author?.name ?? null,
          text: tweet.text ?? "",
          commented_at: tweet.created_at ?? null,
          external_id: tweet.id ?? null,
          permalink: author?.username && tweet.id ? `https://x.com/${author.username}/status/${tweet.id}` : null,
        };
      });
    return jsonResponse({ data: comments });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load Twitter/X comments", 500);
  }
}

type TwitterSearchResponse = {
  data?: Array<{
    id?: string;
    author_id?: string;
    text?: string;
    created_at?: string;
  }>;
  includes?: {
    users?: Array<{
      id?: string;
      username?: string;
      name?: string;
    }>;
  };
};

export async function searchTwitterPosts(env: Env, url: URL): Promise<Response> {
  try {
    const rawQuery = url.searchParams.get("q")?.trim();
    if (!rawQuery) return errorResponse("Search query is required", 400);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 10) || 10, 25));
    const credentials = await getTwitterCredentials(env);
    if (!credentials) return errorResponse("No active Twitter/X account with API credentials was found.", 400);

    const query = rawQuery.includes("-is:retweet") ? rawQuery : `${rawQuery} -is:retweet`;
    const endpoint = new URL("https://api.twitter.com/2/tweets/search/recent");
    endpoint.searchParams.set("query", query);
    endpoint.searchParams.set("max_results", String(limit));
    endpoint.searchParams.set("tweet.fields", "author_id,created_at,text");
    endpoint.searchParams.set("expansions", "author_id");
    endpoint.searchParams.set("user.fields", "username,name");
    const queryParams = {
      query,
      max_results: String(limit),
      "tweet.fields": "author_id,created_at,text",
      expansions: "author_id",
      "user.fields": "username,name",
    };
    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: await buildTwitterOAuthHeader("GET", "https://api.twitter.com/2/tweets/search/recent", credentials, queryParams),
      },
    });
    const payload = await response.json() as TwitterSearchResponse & { detail?: string; title?: string; errors?: Array<{ message?: string }> };
    if (!response.ok) {
      throw new Error(extractTwitterErrorMessage(payload, "Twitter/X search failed"));
    }

    const users = new Map(
      (payload.includes?.users ?? [])
        .filter((user) => user.id)
        .map((user) => [String(user.id), user]),
    );
    const results = (payload.data ?? []).map((tweet) => {
      const author = users.get(String(tweet.author_id ?? ""));
      return {
        post_id: tweet.id ?? null,
        username: author?.username ?? null,
        name: author?.name ?? null,
        text: tweet.text ?? "",
        created_at: tweet.created_at ?? null,
        permalink: author?.username && tweet.id ? `https://x.com/${author.username}/status/${tweet.id}` : null,
      };
    });
    return jsonResponse({ data: results });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to search Twitter/X", 500);
  }
}

export async function publishTwitterPost(env: Env, postId: string): Promise<Response> {
  const id = Number(postId);
  if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);

  try {
    const capabilities = await getSocialPostSchemaCapabilities(env);
    const replySelect = capabilities.hasReplyToId ? "reply_to_id" : "NULL AS reply_to_id";
    const post = await env.DB.prepare(`SELECT id, content, status, ${replySelect} FROM social_posts WHERE id = ? AND platform = 'twitter'`)
      .bind(id)
      .first<{ id: number; content: string; status: string; reply_to_id: string | null }>();
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
      body: JSON.stringify({
        text: post.content.trim(),
        ...(post.reply_to_id?.trim()
          ? { reply: { in_reply_to_tweet_id: post.reply_to_id.trim() } }
          : {}),
      }),
    });
    const payload = await response.json() as { data?: { id?: string }; detail?: string; title?: string; errors?: Array<{ message?: string }> };
    if (!response.ok || !payload.data?.id) {
      const message = extractTwitterErrorMessage(payload, "Twitter/X publish failed");
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
    const failure = classifyTwitterPublishError(error instanceof Error ? error.message : "Failed to publish Twitter/X post");
    return errorResponse(failure.message, failure.status);
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
