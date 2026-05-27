import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { DEFAULT_USER_ID, appendScopedFilter, ownerId, scopedInsertColumns, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import { claimSocialPostForPublishing, markLinkedPlannerItemsPublished, markSocialPostsFailed, socialPostsHaveLastError, socialPublishErrorMessage } from "../lib/social-publish";
import { normalizeAccountTags, readAccountTags, upsertAccountTags } from "../lib/account-tags";

const IMAGE_URL_ALIASES = ["image_url", "imageUrl", "imageURL", "image", "photo", "picture", "media", "media_url", "mediaUrl", "media_urls", "mediaUrls", "url"] as const;
const TWITTER_OAUTH_REQUEST_TOKEN_URL = "https://api.twitter.com/oauth/request_token";
const TWITTER_OAUTH_AUTHORIZE_URL = "https://api.twitter.com/oauth/authorize";
const TWITTER_OAUTH_ACCESS_TOKEN_URL = "https://api.twitter.com/oauth/access_token";
const TWITTER_X_OAUTH_ACCESS_TOKEN_URL = "https://api.x.com/oauth/access_token";
const TWITTER_MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const TWITTER_MAX_IMAGES_PER_POST = 4;
const TWITTER_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type TwitterAccountPayload = {
  username: string;
  api_key: string;
  api_secret: string;
  access_token: string;
  access_secret: string;
  connection_mode?: "official_api";
  status?: "active" | "inactive";
  tags?: unknown;
};

type TwitterAccountUpdatePayload = Partial<TwitterAccountPayload> & {
  status?: "active" | "inactive";
};

type PendingTwitterOAuth = {
  api_key?: string;
  api_secret?: string;
  redirect_uri?: string;
  tags?: unknown;
};

type TwitterCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

type TwitterPresentationProfile = {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
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

type TwitterAccessTokenExchange = {
  body: string;
  params: URLSearchParams;
  ok: boolean;
  status: number;
};

type SocialPostSchemaCapabilities = {
  hasTitle: boolean;
  hasSubreddit: boolean;
  hasAccountId: boolean;
  hasReplyToId: boolean;
  hasLastError: boolean;
};

function handlerErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function extractImageUrls(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        return extractImageUrls(JSON.parse(trimmed));
      } catch {
        return [trimmed];
      }
    }
    return trimmed.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    const urls: string[] = [];
    for (const item of value) {
      urls.push(...extractImageUrls(item));
    }
    return dedupeImageUrls(urls);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const urls: string[] = [];
    for (const key of IMAGE_URL_ALIASES) {
      urls.push(...extractImageUrls(record[key]));
    }
    urls.push(...extractImageUrls(record.urls));
    return dedupeImageUrls(urls);
  }
  return [];
}

function dedupeImageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const url of urls) {
    const value = String(url || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function formatImageUrlValue(value: unknown): string | undefined {
  const urls = extractImageUrls(value);
  if (urls.length === 0) return undefined;
  if (urls.length === 1) return urls[0];
  return JSON.stringify(urls);
}

async function upsertSetting(
  env: Env,
  key: string,
  value: string,
  updatedAt: string,
  userId = DEFAULT_USER_ID,
): Promise<void> {
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

async function readAccountPresentationSettings(
  env: Env,
  accountId: number,
  scopeId = DEFAULT_USER_ID,
): Promise<{ display_name: string | null; avatar_url: string | null }> {
  const [displayName, avatarUrl] = await Promise.all([
    readSetting(env, `social_account:${accountId}:display_name`, scopeId),
    readSetting(env, `social_account:${accountId}:avatar_url`, scopeId),
  ]);
  return {
    display_name: displayName,
    avatar_url: avatarUrl,
  };
}

async function syncTwitterAccountPresentation(
  env: Env,
  accountId: number,
  profile: TwitterPresentationProfile,
  scopeId = DEFAULT_USER_ID,
): Promise<{ display_name: string | null; avatar_url: string | null }> {
  const now = new Date().toISOString();
  await Promise.all([
    ...(profile.display_name?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:display_name`, profile.display_name.trim(), now, scopeId)]
      : []),
    ...(profile.avatar_url?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:avatar_url`, profile.avatar_url.trim(), now, scopeId)]
      : []),
  ]);
  return {
    display_name: profile.display_name?.trim() || null,
    avatar_url: profile.avatar_url?.trim() || null,
  };
}

function parseTwitterOAuthResponse(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

function stripXmlError(body: string): string {
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTwitterOAuthErrorBody(body: string): string {
  const stripped = stripXmlError(body);
  return stripped || body || "Unknown error";
}

function isTwitterDownPage(body: string): boolean {
  return /This page is down|I scream\. You scream|stop making jokes/i.test(body);
}

export function formatTwitterOAuthStartError(body: string, redirectUri: string): string {
  const message = stripXmlError(body);
  if (/Callback URL not approved/i.test(message)) {
    return `Twitter/X rejected the callback URL. Add this exact callback URL in the X Developer app under User authentication settings > Callback URI / Redirect URL, then try again: ${redirectUri}`;
  }
  return message || "Failed to start Twitter/X authorization.";
}

async function readStoredTwitterOAuthConfig(
  env: Env,
  userId = DEFAULT_USER_ID,
): Promise<{ api_key: string; api_secret: string; redirect_uri: string } | null> {
  const filters = ["platform = 'twitter'", "status = 'active'"];
  const values: unknown[] = [];
  await appendScopedFilter(env, "social_accounts", filters, values, userId);
  const account = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
  )
    .bind(...values)
    .first<{ id: number }>();
  if (!account?.id) return null;

  const [apiKey, apiSecret, redirectUri] = await Promise.all([
    readSetting(env, `social_account:${account.id}:twitter_api_key`, userId),
    readSetting(env, `social_account:${account.id}:twitter_api_secret`, userId),
    readSetting(env, `social_account:${account.id}:twitter_redirect_uri`, userId),
  ]);
  if (!apiKey || !apiSecret) return null;
  return {
    api_key: apiKey,
    api_secret: apiSecret,
    redirect_uri: redirectUri?.trim() || "",
  };
}

async function twitterOAuthConfig(
  env: Env,
  requestUrl: string,
  payload: PendingTwitterOAuth,
  userId = DEFAULT_USER_ID,
): Promise<{ api_key: string; api_secret: string; redirect_uri: string }> {
  const requestOrigin = new URL(requestUrl).origin;
  const stored = await readStoredTwitterOAuthConfig(env, userId);
  const [globalApiKey, globalApiSecret, globalRedirectUri] = await Promise.all([
    readSetting(env, "twitter_api_key", userId),
    readSetting(env, "twitter_api_secret", userId),
    readSetting(env, "twitter_redirect_uri", userId),
  ]);
  return {
    api_key: payload.api_key?.trim() || env.TWITTER_API_KEY?.trim() || globalApiKey || stored?.api_key || "",
    api_secret: payload.api_secret?.trim() || env.TWITTER_API_SECRET?.trim() || globalApiSecret || stored?.api_secret || "",
    redirect_uri: payload.redirect_uri?.trim() || globalRedirectUri?.trim() || stored?.redirect_uri || env.TWITTER_REDIRECT_URI?.trim() || `${requestOrigin}/api/twitter/auth/callback`,
  };
}

export async function getSocialPostSchemaCapabilities(env: Env): Promise<SocialPostSchemaCapabilities> {
  const columns = await env.DB.prepare("PRAGMA table_info(social_posts)").all<{ name: string }>();
  const names = new Set((columns.results ?? []).map((column) => String(column.name || "").trim().toLowerCase()));
  return {
    hasTitle: names.has("title"),
    hasSubreddit: names.has("subreddit"),
    hasAccountId: names.has("account_id"),
    hasReplyToId: names.has("reply_to_id"),
    hasLastError: names.has("last_error"),
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

async function buildTwitterOAuthAuthorizationHeader(
  method: string,
  endpoint: string,
  options: {
    apiKey: string;
    apiSecret: string;
    accessToken?: string;
    accessSecret?: string;
    queryParams?: Record<string, string>;
    oauthParams?: Record<string, string>;
  },
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: options.apiKey,
    oauth_nonce: randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...(options.oauthParams ?? {}),
  };
  if (options.accessToken) oauthParams.oauth_token = options.accessToken;

  const signatureParams = {
    ...oauthParams,
    ...(options.queryParams ?? {}),
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
  const signingKey = `${oauthEncode(options.apiSecret)}&${oauthEncode(options.accessSecret ?? "")}`;
  oauthParams.oauth_signature = await hmacSha1Base64(signingKey, signatureBase);

  return `OAuth ${Object.entries(oauthParams)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${oauthEncode(key)}="${oauthEncode(value)}"`)
    .join(", ")}`;
}

async function buildTwitterOAuthHeader(
  method: string,
  endpoint: string,
  credentials: TwitterCredentials,
  queryParams?: Record<string, string>,
): Promise<string> {
  return buildTwitterOAuthAuthorizationHeader(method, endpoint, {
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    accessToken: credentials.accessToken,
    accessSecret: credentials.accessSecret,
    queryParams,
  });
}

async function requestTwitterAccessToken(
  endpoint: string,
  pending: { api_key: string; api_secret: string; request_token_secret: string },
  oauthToken: string,
  oauthVerifier: string,
  transport: "body" | "query" | "header",
): Promise<TwitterAccessTokenExchange> {
  const requestParams = {
    oauth_token: oauthToken,
    oauth_verifier: oauthVerifier,
  };
  const verifierParam = {
    oauth_verifier: oauthVerifier,
  };
  const url = new URL(endpoint);
  const headers: Record<string, string> = {};
  let body: string | undefined;

  if (transport === "query") {
    for (const [key, value] of Object.entries(requestParams)) {
      url.searchParams.set(key, value);
    }
  } else if (transport === "body") {
    body = new URLSearchParams(verifierParam).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  }

  const authorization = await buildTwitterOAuthAuthorizationHeader("POST", endpoint, {
    apiKey: pending.api_key,
    apiSecret: pending.api_secret,
    accessToken: transport === "body" || transport === "header" ? oauthToken : undefined,
    accessSecret: pending.request_token_secret,
    queryParams: transport === "body" ? verifierParam : transport === "query" ? requestParams : undefined,
    oauthParams: transport === "header" ? { oauth_verifier: oauthVerifier } : undefined,
  });
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...headers,
      Authorization: authorization,
    },
    body,
  });
  const responseBody = await response.text();
  return {
    body: responseBody,
    params: parseTwitterOAuthResponse(responseBody),
    ok: response.ok,
    status: response.status,
  };
}

async function exchangeTwitterAccessToken(
  pending: { api_key: string; api_secret: string; request_token_secret: string },
  oauthToken: string,
  oauthVerifier: string,
): Promise<TwitterAccessTokenExchange> {
  const attempts: Array<{ endpoint: string; transport: "body" | "query" | "header" }> = [
    { endpoint: TWITTER_OAUTH_ACCESS_TOKEN_URL, transport: "body" },
    { endpoint: TWITTER_OAUTH_ACCESS_TOKEN_URL, transport: "query" },
    { endpoint: TWITTER_X_OAUTH_ACCESS_TOKEN_URL, transport: "body" },
    { endpoint: TWITTER_X_OAUTH_ACCESS_TOKEN_URL, transport: "query" },
    { endpoint: TWITTER_OAUTH_ACCESS_TOKEN_URL, transport: "header" },
  ];
  let lastResult: TwitterAccessTokenExchange | null = null;
  let firstReadableFailure: TwitterAccessTokenExchange | null = null;

  for (const attempt of attempts) {
    const result = await requestTwitterAccessToken(
      attempt.endpoint,
      pending,
      oauthToken,
      oauthVerifier,
      attempt.transport,
    );
    const accessToken = result.params.get("oauth_token")?.trim() || "";
    const accessSecret = result.params.get("oauth_token_secret")?.trim() || "";
    if (result.ok && accessToken && accessSecret) return result;
    lastResult = result;
    if (!firstReadableFailure && !isTwitterDownPage(result.body)) {
      firstReadableFailure = result;
    }
  }

  return firstReadableFailure ?? lastResult ?? {
    body: "Unknown error",
    params: new URLSearchParams(),
    ok: false,
    status: 500,
  };
}

async function getTwitterCredentials(
  env: Env,
  requestedAccountId?: number,
  userId = DEFAULT_USER_ID,
): Promise<TwitterCredentials | null> {
  const filters = ["platform = 'twitter'", "status = 'active'"];
  const values: unknown[] = [];
  if (requestedAccountId) {
    filters.push("id = ?");
    values.push(requestedAccountId);
  }
  await appendScopedFilter(env, "social_accounts", filters, values, userId);
  const account = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
  ).bind(...values).first<{ id: number }>();

  const scopedPrefix = account ? `social_account:${account.id}:` : "";
  const [apiKey, apiSecret, accessToken, accessSecret] = await Promise.all([
    account ? readSetting(env, `${scopedPrefix}twitter_api_key`, userId) : null,
    account ? readSetting(env, `${scopedPrefix}twitter_api_secret`, userId) : null,
    account ? readSetting(env, `${scopedPrefix}twitter_access_token`, userId) : null,
    account ? readSetting(env, `${scopedPrefix}twitter_access_secret`, userId) : null,
  ]);

  const fallback = await Promise.all([
    readSetting(env, "twitter_api_key", userId),
    readSetting(env, "twitter_api_secret", userId),
    readSetting(env, "twitter_access_token", userId),
    readSetting(env, "twitter_access_secret", userId),
  ]);

  const credentials = {
    apiKey: apiKey || fallback[0] || "",
    apiSecret: apiSecret || fallback[1] || "",
    accessToken: accessToken || fallback[2] || "",
    accessSecret: accessSecret || fallback[3] || "",
  };

  return Object.values(credentials).every(Boolean) ? credentials : null;
}

async function deleteTwitterPostExternally(env: Env, externalId: string, userId = DEFAULT_USER_ID): Promise<void> {
  const credentials = await getTwitterCredentials(env, undefined, userId);
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
  payload: { detail?: string; title?: string; error?: string; errors?: Array<{ message?: string }> },
  fallback: string,
): string {
  return (
    payload.detail
    || payload.title
    || payload.error
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

function twitterMediaFileName(index: number, contentType: string): string {
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
    ? "webp"
    : contentType.includes("gif")
    ? "gif"
    : "jpg";
  return `social-post-${index + 1}.${extension}`;
}

async function fetchTwitterMediaBlob(imageUrl: string, index: number): Promise<Blob> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error(`Twitter/X image ${index + 1} must be an absolute public URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Twitter/X image ${index + 1} must be an HTTP or HTTPS URL.`);
  }

  const response = await fetch(parsed.toString());
  if (!response.ok) {
    throw new Error(`Twitter/X could not download image ${index + 1} (${response.status}).`);
  }
  const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`Twitter/X image ${index + 1} is not an image (${contentType || "unknown content type"}).`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error(`Twitter/X image ${index + 1} is empty.`);
  }
  if (bytes.byteLength > TWITTER_MAX_IMAGE_BYTES) {
    throw new Error(`Twitter/X image ${index + 1} is larger than 5 MB. Compress it or split the post before publishing.`);
  }
  return new Blob([bytes], { type: contentType });
}

async function uploadTwitterMedia(credentials: TwitterCredentials, imageUrl: string, index: number): Promise<string> {
  const blob = await fetchTwitterMediaBlob(imageUrl, index);
  const form = new FormData();
  form.set("media", blob, twitterMediaFileName(index, blob.type));
  form.set("media_category", "tweet_image");

  const response = await fetch(TWITTER_MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: await buildTwitterOAuthHeader("POST", TWITTER_MEDIA_UPLOAD_URL, credentials),
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({})) as {
    media_id_string?: string;
    media_id?: string | number;
    detail?: string;
    title?: string;
    error?: string;
    errors?: Array<{ message?: string }>;
  };
  const mediaId = payload.media_id_string || (payload.media_id ? String(payload.media_id) : "");
  if (!response.ok || !mediaId) {
    throw new Error(extractTwitterErrorMessage(payload, `Twitter/X image ${index + 1} upload failed.`));
  }
  return mediaId;
}

async function uploadTwitterPostMedia(credentials: TwitterCredentials, imageUrls: string[]): Promise<string[]> {
  if (imageUrls.length === 0) return [];
  if (imageUrls.length > TWITTER_MAX_IMAGES_PER_POST) {
    throw new Error(`Twitter/X supports up to ${TWITTER_MAX_IMAGES_PER_POST} images per post. This post has ${imageUrls.length}; split it before publishing so no images are dropped.`);
  }
  const mediaIds: string[] = [];
  for (const [index, imageUrl] of imageUrls.entries()) {
    mediaIds.push(await uploadTwitterMedia(credentials, imageUrl, index));
  }
  return mediaIds;
}

// ------------------------------------------------------------------ social posts

export async function listSocialPosts(env: Env, platform: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const filters = ["platform = ?"];
    const values: unknown[] = [platform];
    await appendScopedFilter(env, "social_posts", filters, values, userId);
    const posts = await env.DB.prepare(
      `SELECT * FROM social_posts WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(...values)
      .all();
    return jsonResponse(posts.results ?? []);
  } catch (error) {
    console.error("Failed to list social posts:", error);
    return errorResponse(handlerErrorMessage(error, "Failed to list posts"), 500);
  }
}

export async function createSocialPost(
  env: Env,
  platform: string,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const payload = await parseJson<{
      content?: string;
      scheduled_at?: string;
      image_url?: unknown;
      imageUrl?: unknown;
      imageURL?: unknown;
      image?: unknown;
      photo?: unknown;
      picture?: unknown;
      media?: unknown;
      media_url?: unknown;
      mediaUrl?: unknown;
      media_urls?: unknown;
      mediaUrls?: unknown;
      url?: unknown;
      title?: string;
      subreddit?: string;
      account_id?: number | null;
      reply_to_id?: string | null;
    }>(request);
    const content = payload.content?.trim() ?? "";
    const imageUrl = formatImageUrlValue(payload.image_url ?? payload) ?? "";
    const title = payload.title?.trim() ?? "";
    const subreddit = payload.subreddit?.trim().replace(/^r\//i, "") ?? "";
    const replyToId = payload.reply_to_id?.trim() ?? "";
    const capabilities = await getSocialPostSchemaCapabilities(env);
    const requiresRedditMetadata = platform === "reddit";
    if (requiresRedditMetadata && !capabilities.hasTitle && !capabilities.hasSubreddit) {
      return errorResponse("Apply the latest social_posts migration before creating Reddit posts.", 400);
    }
    if (platform === "reddit" && !replyToId && !title) {
      return errorResponse("Reddit posts need a title.", 400);
    }
    if (platform === "reddit" && !replyToId && !subreddit) {
      return errorResponse("Choose a subreddit before creating a Reddit post.", 400);
    }
    if (platform === "reddit" && replyToId && !content) {
      return errorResponse("Reddit replies need text.", 400);
    }
    if (!content && !imageUrl && !title) {
      return errorResponse("content or image_url is required", 400);
    }
    const now = new Date().toISOString();
    const status = payload.scheduled_at ? "scheduled" : "draft";
    const scoped = await scopedInsertColumns(env, "social_posts", userId);
    const columns = [...scoped.columns, "platform", "content", "image_url", "status", "scheduled_at", "created_by", "created_at", "updated_at"];
    const values: Array<string | number | null> = [
      ...(scoped.values as Array<number>),
      platform,
      content,
      imageUrl || null,
      status,
      payload.scheduled_at ?? null,
      "dashboard",
      now,
      now,
    ];
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
      values.push(replyToId || null);
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
  } catch (error) {
    console.error("Failed to create social post:", error);
    return errorResponse(handlerErrorMessage(error, "Failed to create post"), 500);
  }
}

export async function updateSocialPost(
  env: Env,
  postId: string,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(postId);
    if (isNaN(id)) return errorResponse("Invalid post ID", 400);
    const payload = await parseJson<{
      content?: string;
      image_url?: unknown;
      imageUrl?: unknown;
      imageURL?: unknown;
      image?: unknown;
      photo?: unknown;
      picture?: unknown;
      media?: unknown;
      media_url?: unknown;
      mediaUrl?: unknown;
      media_urls?: unknown;
      mediaUrls?: unknown;
      url?: unknown;
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
    let imageUrl: string | null | undefined = payload.image_url === null ? null : formatImageUrlValue(payload.image_url);
    if (imageUrl === undefined) {
      imageUrl = formatImageUrlValue(payload);
    } else if (imageUrl !== null) {
      imageUrl = formatImageUrlValue(imageUrl) ?? "";
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
    values.push(now);
    const filters = ["id = ?"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "social_posts", filters, filterValues, userId);

    await env.DB.prepare(`UPDATE social_posts SET ${updates.join(", ")} WHERE ${filters.join(" AND ")}`)
      .bind(...values, ...filterValues)
      .run();
    return jsonResponse({ success: true, updated_at: now });
  } catch (error) {
    console.error("Failed to update social post:", error);
    return errorResponse(handlerErrorMessage(error, "Failed to update post"), 500);
  }
}

export async function deleteSocialPost(env: Env, postId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(postId);
    if (isNaN(id)) return errorResponse("Invalid post ID", 400);
    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "social_posts", filters, values, userId);
    const post = await env.DB.prepare(
      `SELECT id, platform, status, external_id FROM social_posts WHERE ${filters.join(" AND ")}`,
    )
      .bind(...values)
      .first<SocialPostRow>();
    if (!post) return errorResponse("Post not found", 404);

    const externalId = post.external_id?.trim() || "";
    const isPublished = post.status === "posted";

    if (isPublished && externalId) {
      if (post.platform === "twitter") {
        await deleteTwitterPostExternally(env, externalId, userId);
      }
    }

    await env.DB.prepare("DELETE FROM planner_items WHERE social_post_id = ?").bind(id).run();
    await env.DB.prepare(`DELETE FROM social_posts WHERE ${filters.join(" AND ")}`).bind(...values).run();
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
    profile_image_url?: string;
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

type TwitterConversationReply = {
  id?: string;
  author_id?: string;
  conversation_id?: string;
  text?: string;
  created_at?: string;
  referenced_tweets?: Array<{
    type?: string;
    id?: string;
  }>;
};

type TwitterConversationSearchResponse = {
  data?: TwitterConversationReply[];
};

async function fetchTwitterProfile(credentials: TwitterCredentials): Promise<TwitterPresentationProfile> {
  const endpoint = "https://api.x.com/2/users/me?user.fields=username,name,profile_image_url";
  const meQueryParams = { "user.fields": "username,name,profile_image_url" };
  const response = await fetch(endpoint, {
    headers: {
      Authorization: await buildTwitterOAuthHeader("GET", "https://api.x.com/2/users/me", credentials, meQueryParams),
    },
  });
  const payload = await response.json() as TwitterMeResponse & { detail?: string; title?: string; errors?: Array<{ message?: string }> };
  if (!response.ok || !payload.data?.id || !payload.data.username) {
    throw new Error(extractTwitterErrorMessage(payload, "Failed to load the connected Twitter/X account."));
  }
  return {
    user_id: payload.data.id,
    username: payload.data.username,
    display_name: payload.data.name?.trim() || null,
    avatar_url: payload.data.profile_image_url?.trim() || null,
  };
}

function selectLatestTwitterReply(
  current: TwitterConversationReply | undefined,
  candidate: TwitterConversationReply,
): TwitterConversationReply {
  const currentTimestamp = String(current?.created_at ?? "");
  const candidateTimestamp = String(candidate.created_at ?? "");
  return candidateTimestamp.localeCompare(currentTimestamp) > 0 ? candidate : (current ?? candidate);
}

async function loadOwnedTwitterRepliesByParent(
  env: Env,
  conversationIds: string[],
  meUsername: string,
  credentials: TwitterCredentials,
): Promise<Map<string, TwitterConversationReply>> {
  const repliesByParent = new Map<string, TwitterConversationReply>();

  for (const conversationId of conversationIds) {
    const query = `conversation_id:${conversationId} from:${meUsername} -is:retweet`;
    const endpoint = new URL("https://api.twitter.com/2/tweets/search/recent");
    endpoint.searchParams.set("query", query);
    endpoint.searchParams.set("max_results", "25");
    endpoint.searchParams.set("tweet.fields", "author_id,conversation_id,created_at,text,referenced_tweets");
    const queryParams = {
      query,
      max_results: "25",
      "tweet.fields": "author_id,conversation_id,created_at,text,referenced_tweets",
    };

    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: await buildTwitterOAuthHeader("GET", "https://api.twitter.com/2/tweets/search/recent", credentials, queryParams),
      },
    });
    const payload = await response.json() as TwitterConversationSearchResponse & {
      detail?: string;
      title?: string;
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok) {
      throw new Error(extractTwitterErrorMessage(payload, "Failed to load Twitter/X reply state."));
    }

    for (const tweet of payload.data ?? []) {
      const parentId = (tweet.referenced_tweets ?? []).find((reference) => reference.type === "replied_to")?.id?.trim();
      if (!parentId) continue;
      repliesByParent.set(parentId, selectLatestTwitterReply(repliesByParent.get(parentId), tweet));
    }
  }

  return repliesByParent;
}

export async function listTwitterComments(env: Env, postId?: string | null, limit?: string | null, accountId?: string | null, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const requestedAccountId = Number(accountId || 0) || undefined;
    const credentials = await getTwitterCredentials(env, requestedAccountId, userId);
    if (!credentials) throw new Error("No active Twitter/X account with API credentials was found.");
    const profile = await fetchTwitterProfile(credentials);
    const me = {
      id: profile.user_id,
      username: profile.username,
      name: profile.display_name || undefined,
    };
    const requestedLimit = Math.max(1, Math.min(Number(limit || 100) || 100, 100));
    const filters = ["platform = 'twitter'", "status = 'posted'"];
    const values: unknown[] = [];
    if (postId) {
      filters.unshift("id = ?");
      values.unshift(Number(postId));
    }
    if (requestedAccountId) {
      filters.push("account_id = ?");
      values.push(requestedAccountId);
    }
    await appendScopedFilter(env, "social_posts", filters, values, userId);
    const targets = await env.DB.prepare(
      `SELECT id, external_id, content, image_url, account_id FROM social_posts WHERE ${filters.join(" AND ")} ORDER BY posted_at DESC, updated_at DESC`,
    ).bind(...values).all<{ id: number; external_id: string | null; content: string; image_url: string | null; account_id: number | null }>();
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
    const repliesByParent = await loadOwnedTwitterRepliesByParent(
      env,
      Array.from(new Set((payload.data ?? []).map((tweet) => String(tweet.conversation_id ?? "").trim()).filter(Boolean))),
      me.username,
      credentials,
    );
    const comments = (payload.data ?? [])
      .filter((tweet) => tweet.author_id && tweet.author_id !== me.id)
      .filter((tweet) => tweet.conversation_id && targetMap.has(String(tweet.conversation_id)))
      .map((tweet) => {
        const author = users.get(String(tweet.author_id));
        const target = targetMap.get(String(tweet.conversation_id));
        const ownerReply = tweet.id ? repliesByParent.get(String(tweet.id)) : undefined;
        return {
          platform: "twitter",
          account_id: requestedAccountId ?? target?.account_id ?? null,
          post_id: target?.id ?? null,
          post_external_id: tweet.conversation_id ?? null,
          post_preview: target?.content?.slice(0, 120) ?? null,
          post_image_url: target?.image_url ?? null,
          commenter_username: author?.username ?? null,
          commenter_name: author?.name ?? null,
          text: tweet.text ?? "",
          commented_at: tweet.created_at ?? null,
          external_id: tweet.id ?? null,
          parent_external_id: null,
          permalink: author?.username && tweet.id ? `https://x.com/${author.username}/status/${tweet.id}` : null,
          reply_status: ownerReply ? "replied" : "new",
          owner_reply_text: ownerReply?.text ?? null,
          owner_replied_at: ownerReply?.created_at ?? null,
          owner_reply_external_id: ownerReply?.id ?? null,
          owner_reply_permalink: ownerReply?.id ? `https://x.com/${me.username}/status/${ownerReply.id}` : null,
        };
      });
    return jsonResponse({ data: comments });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load Twitter/X comments", 500);
  }
}

export async function createTwitterReply(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<{ reply_to_id?: string; text?: string; account_id?: number | null }>(request);
    const replyToId = payload.reply_to_id?.trim() || "";
    const text = payload.text?.trim() || "";
    if (!replyToId || !text) {
      return errorResponse("reply_to_id and text are required", 400);
    }
    if (text.length > 280) {
      return errorResponse("Twitter/X replies must be 280 characters or fewer", 400);
    }

    const credentials = await getTwitterCredentials(env, payload.account_id ? Number(payload.account_id) : undefined, userId);
    if (!credentials) return errorResponse("No active Twitter/X account with API credentials was found.", 400);

    const endpoint = "https://api.twitter.com/2/tweets";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: await buildTwitterOAuthHeader("POST", endpoint, credentials),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        reply: { in_reply_to_tweet_id: replyToId },
      }),
    });
    const payloadBody = await response.json() as { data?: { id?: string }; detail?: string; title?: string; errors?: Array<{ message?: string }> };
    if (!response.ok || !payloadBody.data?.id) {
      throw new Error(extractTwitterErrorMessage(payloadBody, "Twitter/X reply failed"));
    }

    return jsonResponse({ success: true, external_id: payloadBody.data.id }, { status: 201 });
  } catch (error) {
    const classified = classifyTwitterPublishError(error instanceof Error ? error.message : "Failed to publish Twitter/X reply");
    return errorResponse(classified.message, classified.status);
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

export async function publishTwitterPost(env: Env, postId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  const id = Number(postId);
  if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);
  let publishedExternalId: string | null = null;

  try {
    const capabilities = await getSocialPostSchemaCapabilities(env);
    const replySelect = capabilities.hasReplyToId ? "reply_to_id" : "NULL AS reply_to_id";
    const accountSelect = capabilities.hasAccountId ? "account_id" : "NULL AS account_id";
    const filters = ["id = ?", "platform = 'twitter'"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "social_posts", filters, values, userId);
    const post = await env.DB.prepare(
      `SELECT id, content, image_url, status, external_id, ${replySelect}, ${accountSelect} FROM social_posts WHERE ${filters.join(" AND ")}`,
    )
      .bind(...values)
      .first<{ id: number; content: string | null; image_url: string | null; status: string; external_id: string | null; reply_to_id: string | null; account_id: number | null }>();
    if (!post) return errorResponse("Twitter/X post not found", 404);
    const imageUrls = extractImageUrls(post.image_url);
    if (!post.content?.trim() && imageUrls.length === 0) return errorResponse("Post content is empty", 400);
    if (post.status === "posted" && post.external_id?.trim()) {
      return jsonResponse({ success: true, external_id: post.external_id.trim(), already_posted: true });
    }
    if (post.status === "posted") return errorResponse("Post is already published", 400);
    const credentials = await getTwitterCredentials(env, post.account_id ?? undefined, userId);
    if (!credentials) return errorResponse("No active Twitter/X account with API credentials was found.", 400);

    const now = new Date().toISOString();
    const claim = await claimSocialPostForPublishing(env, filters, values, now);
    if (claim.status === "already_posted") {
      return jsonResponse({ success: true, external_id: claim.externalId, already_posted: true });
    }
    if (claim.status === "in_progress") return errorResponse("Post is already publishing.", 409);
    if (claim.status !== "claimed") return errorResponse(claim.message, 400);

    const mediaIds = await uploadTwitterPostMedia(credentials, imageUrls);

    const endpoint = "https://api.twitter.com/2/tweets";
    const body: Record<string, unknown> = {};
    if (post.content?.trim()) body.text = post.content.trim();
    if (post.reply_to_id?.trim()) {
      body.reply = { in_reply_to_tweet_id: post.reply_to_id.trim() };
    }
    if (mediaIds.length > 0) {
      body.media = { media_ids: mediaIds };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: await buildTwitterOAuthHeader("POST", endpoint, credentials),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { data?: { id?: string }; detail?: string; title?: string; errors?: Array<{ message?: string }> };
    if (!response.ok || !payload.data?.id) {
      const message = extractTwitterErrorMessage(payload, "Twitter/X publish failed");
      throw new Error(message);
    }
    publishedExternalId = payload.data.id;

    await env.DB.prepare(
      `UPDATE social_posts
       SET status = 'posted', posted_at = ?, external_id = ?, updated_at = ?${capabilities.hasLastError ? ", last_error = NULL" : ""}
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(now, publishedExternalId, now, ...values)
      .run();
    try {
      await markLinkedPlannerItemsPublished(env, id, now);
    } catch (plannerError) {
      console.error("Failed to mark linked planner items published for Twitter/X post:", plannerError);
    }

    return jsonResponse({ success: true, external_id: publishedExternalId, posted_at: now, media_count: mediaIds.length });
  } catch (error) {
    if (publishedExternalId) {
      console.error("Twitter/X published externally but dashboard sync failed:", error);
      const now = new Date().toISOString();
      const filters = ["id = ?"];
      const values: unknown[] = [id];
      await appendScopedFilter(env, "social_posts", filters, values, userId);
      const lastErrorAssignment = await socialPostsHaveLastError(env) ? ", last_error = NULL" : "";
      await env.DB.prepare(
        `UPDATE social_posts SET status = 'posted', posted_at = COALESCE(posted_at, ?), external_id = ?, updated_at = ?${lastErrorAssignment} WHERE ${filters.join(" AND ")}`,
      )
        .bind(now, publishedExternalId, now, ...values)
        .run()
        .catch((syncError) => console.error("Failed to repair Twitter/X published state:", syncError));
      return errorResponse("Twitter/X published externally, but the dashboard could not finish syncing the published state. Refresh before retrying to avoid a duplicate.", 502);
    }
    const now = new Date().toISOString();
    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "social_posts", filters, values, userId);
    const message = socialPublishErrorMessage(error, "Failed to publish Twitter/X post");
    await markSocialPostsFailed(env, filters, values, now, message);
    const failure = classifyTwitterPublishError(message);
    return errorResponse(failure.message, failure.status);
  }
}

// ------------------------------------------------------------------ twitter accounts

async function upsertTwitterAccount(
  env: Env,
  payload: TwitterAccountPayload & { display_name?: string; avatar_url?: string },
  scopeId = DEFAULT_USER_ID,
): Promise<{
  id: number;
  platform: "twitter";
  username: string;
  status: "active" | "inactive";
  connection_mode: "official_api";
  created_at: string;
  updated_at: string;
}> {
  const username = payload.username.trim().replace(/^@+/, "");
  if (!username) throw new Error("username is required");

  const connectionMode = "official_api";
  const status = payload.status === "inactive" ? "inactive" : "active";
  const now = new Date().toISOString();
  const existingFilters = ["platform = 'twitter'", "username = ?"];
  const existingValues: unknown[] = [username];
  await appendScopedFilter(env, "social_accounts", existingFilters, existingValues, scopeId);
  const existing = await env.DB.prepare(
    `SELECT id, created_at FROM social_accounts WHERE ${existingFilters.join(" AND ")} ORDER BY id DESC LIMIT 1`,
  )
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
      .bind(...scoped.values, "twitter", username, status, now, now)
      .run() as { meta: { last_row_id: number } };
    accountId = result.meta.last_row_id;
    createdAt = now;
  }

  await Promise.all([
    upsertSetting(env, `social_account:${accountId}:connection_mode`, connectionMode, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:twitter_api_key`, payload.api_key.trim(), now, scopeId),
    upsertSetting(env, `social_account:${accountId}:twitter_api_secret`, payload.api_secret.trim(), now, scopeId),
    upsertSetting(env, `social_account:${accountId}:twitter_access_token`, payload.access_token.trim(), now, scopeId),
    upsertSetting(env, `social_account:${accountId}:twitter_access_secret`, payload.access_secret.trim(), now, scopeId),
    upsertSetting(env, "twitter_api_key", payload.api_key.trim(), now, scopeId),
    upsertSetting(env, "twitter_api_secret", payload.api_secret.trim(), now, scopeId),
    upsertSetting(env, "twitter_access_token", payload.access_token.trim(), now, scopeId),
    upsertSetting(env, "twitter_access_secret", payload.access_secret.trim(), now, scopeId),
    ...(payload.display_name?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:display_name`, payload.display_name.trim(), now, scopeId)]
      : []),
    ...(payload.avatar_url?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:avatar_url`, payload.avatar_url.trim(), now, scopeId)]
      : []),
    ...(payload.tags !== undefined
      ? [upsertAccountTags(env, "social_account", accountId, payload.tags, now, scopeId)]
      : []),
  ]);

  return {
    id: accountId,
    platform: "twitter",
    username,
    status,
    connection_mode: connectionMode,
    created_at: createdAt,
    updated_at: now,
  };
}

export async function listTwitterAccounts(
  env: Env,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const accountHasWorkspaceId = await tableHasWorkspaceId(env, "social_accounts");
    const settingsHasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
    const accountHasUserId = await tableHasUserId(env, "social_accounts");
    const settingsHasUserId = await tableHasUserId(env, "app_settings");
    const joinScope = settingsHasWorkspaceId
      ? accountHasWorkspaceId
        ? " AND {alias}.workspace_id = account.workspace_id"
        : " AND {alias}.workspace_id = ?"
      : settingsHasUserId
      ? accountHasUserId
        ? " AND {alias}.user_id = account.user_id"
        : " AND {alias}.user_id = ?"
      : "";
    const joinValues = settingsHasWorkspaceId && !accountHasWorkspaceId
      ? [workspaceId(scopeId), workspaceId(scopeId), workspaceId(scopeId), workspaceId(scopeId)]
      : settingsHasUserId && !accountHasUserId
      ? [ownerId(scopeId), ownerId(scopeId), ownerId(scopeId), ownerId(scopeId)]
      : [];
    const filters = ["account.platform = 'twitter'"];
    const values: unknown[] = [];
    await appendScopedFilter(env, "social_accounts", filters, values, scopeId, "account");
    const rows = await env.DB.prepare(
      `SELECT
         account.id,
         'twitter' AS platform,
         account.username,
         account.status,
         account.created_at,
         account.updated_at,
         CASE
           WHEN api_key.value IS NOT NULL AND TRIM(api_key.value) != ''
            AND api_secret.value IS NOT NULL AND TRIM(api_secret.value) != ''
            AND access_token.value IS NOT NULL AND TRIM(access_token.value) != ''
            AND access_secret.value IS NOT NULL AND TRIM(access_secret.value) != ''
           THEN 1
         ELSE 0
         END AS api_credentials_ready
       FROM social_accounts account
       LEFT JOIN app_settings api_key ON api_key.key = 'social_account:' || account.id || ':twitter_api_key'${joinScope.replace("{alias}", "api_key")}
       LEFT JOIN app_settings api_secret ON api_secret.key = 'social_account:' || account.id || ':twitter_api_secret'${joinScope.replace("{alias}", "api_secret")}
       LEFT JOIN app_settings access_token ON access_token.key = 'social_account:' || account.id || ':twitter_access_token'${joinScope.replace("{alias}", "access_token")}
       LEFT JOIN app_settings access_secret ON access_secret.key = 'social_account:' || account.id || ':twitter_access_secret'${joinScope.replace("{alias}", "access_secret")}
       WHERE ${filters.join(" AND ")}
       ORDER BY account.created_at DESC`,
    ).bind(...joinValues, ...(settingsHasWorkspaceId && !accountHasWorkspaceId
      ? [workspaceId(scopeId)]
      : settingsHasUserId && !accountHasUserId
      ? [ownerId(scopeId)]
      : []), ...values).all();

    const results = await Promise.all((rows.results ?? []).map(async (row) => {
      const account = row as {
        id: number;
        platform: "twitter";
        username: string;
        status: "active" | "inactive";
        created_at: string;
        updated_at: string;
        api_credentials_ready: number;
      };
      let presentation = await readAccountPresentationSettings(env, account.id, scopeId);
      if (!presentation.display_name || !presentation.avatar_url) {
        const credentials = await getTwitterCredentials(env, account.id, scopeId);
        if (credentials) {
          try {
            const profile = await fetchTwitterProfile(credentials);
            presentation = await syncTwitterAccountPresentation(env, account.id, profile, scopeId);
          } catch {
            // Keep the saved presentation if live Twitter enrichment fails.
          }
        }
      }
      const tags = await readAccountTags(env, "social_account", account.id, scopeId);
      return {
        id: account.id,
        platform: account.platform,
        username: account.username,
        ...presentation,
        tags,
        status: account.status === "active" && account.api_credentials_ready
          ? "active"
          : "inactive",
        created_at: account.created_at,
        updated_at: account.updated_at,
        connection_mode: "official_api",
        credentials_ready: account.api_credentials_ready,
      };
    }));
    return jsonResponse(results);
  } catch {
    return errorResponse("Failed to list accounts", 500);
  }
}

export async function authorizeTwitterAccount(
  env: Env,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const payload = await parseJson<PendingTwitterOAuth>(request);
    const config = await twitterOAuthConfig(env, request.url, payload, userId);
    if (!config.api_key || !config.api_secret) {
      return errorResponse(
        "Twitter/X OAuth is not configured. Missing Twitter API key and API secret in Worker config or saved app settings.",
        500,
      );
    }

    const authorization = await buildTwitterOAuthAuthorizationHeader("POST", TWITTER_OAUTH_REQUEST_TOKEN_URL, {
      apiKey: config.api_key,
      apiSecret: config.api_secret,
      oauthParams: {
        oauth_callback: config.redirect_uri,
      },
    });
    const response = await fetch(TWITTER_OAUTH_REQUEST_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: authorization,
      },
    });
    const body = await response.text();
    const params = parseTwitterOAuthResponse(body);
    const oauthToken = params.get("oauth_token")?.trim() || "";
    const oauthTokenSecret = params.get("oauth_token_secret")?.trim() || "";
    const callbackConfirmed = params.get("oauth_callback_confirmed")?.trim() || "";

    if (!response.ok || !oauthToken || !oauthTokenSecret || callbackConfirmed !== "true") {
      return errorResponse(formatTwitterOAuthStartError(body, config.redirect_uri), response.ok ? 502 : response.status);
    }

    const now = new Date().toISOString();
    await upsertSetting(env, `twitter_oauth_token:${oauthToken}`, JSON.stringify({
      api_key: config.api_key,
      api_secret: config.api_secret,
      redirect_uri: config.redirect_uri,
      request_token_secret: oauthTokenSecret,
      tags: normalizeAccountTags(payload.tags),
      user_id: ownerId(userId),
      created_at: now,
    }), now, userId);

    const authUrl = new URL(TWITTER_OAUTH_AUTHORIZE_URL);
    authUrl.searchParams.set("oauth_token", oauthToken);
    return jsonResponse({ auth_url: authUrl.toString() });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to start Twitter/X authorization", 500);
  }
}

export async function addTwitterAccount(
  env: Env,
  request: Request,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const payload = await parseJson<TwitterAccountPayload>(request);
    if (!payload.username?.trim()) return errorResponse("username is required", 400);
    if (!payload.api_key?.trim()) return errorResponse("API key is required", 400);
    if (!payload.api_secret?.trim()) return errorResponse("API secret is required", 400);
    if (!payload.access_token?.trim()) return errorResponse("Access token is required", 400);
    if (!payload.access_secret?.trim()) return errorResponse("Access secret is required", 400);
    return jsonResponse(await upsertTwitterAccount(env, payload, scopeId), { status: 201 });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to add account", 500);
  }
}

export async function handleTwitterOAuthCallback(env: Env, url: URL): Promise<Response> {
  try {
    const denied = url.searchParams.get("denied");
    if (denied) {
      return new Response(`<html><body><h1>Twitter/X authorization cancelled</h1><p>${denied}</p></body></html>`, {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const oauthToken = url.searchParams.get("oauth_token");
    const oauthVerifier = url.searchParams.get("oauth_verifier");
    if (!oauthToken || !oauthVerifier) {
      return new Response("<html><body><h1>Invalid Twitter/X OAuth callback</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const stateKey = `twitter_oauth_token:${oauthToken}`;
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(stateKey).first<{ value: string }>();
    if (!row?.value) {
      return new Response("<html><body><h1>Twitter/X OAuth state expired</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const pending = JSON.parse(row.value) as {
      api_key: string;
      api_secret: string;
      redirect_uri: string;
      request_token_secret: string;
      tags?: unknown;
      user_id?: number;
      created_at?: string;
    };
    const pendingUserId = ownerId(pending.user_id);

    const exchange = await exchangeTwitterAccessToken(pending, oauthToken, oauthVerifier);
    const params = exchange.params;
    const accessToken = params.get("oauth_token")?.trim() || "";
    const accessSecret = params.get("oauth_token_secret")?.trim() || "";
    const screenName = params.get("screen_name")?.trim() || "";
    const userId = params.get("user_id")?.trim() || "";

    if (!exchange.ok || !accessToken || !accessSecret) {
      return new Response(`<html><body><h1>Twitter/X token exchange failed</h1><p>${escapeHtml(formatTwitterOAuthErrorBody(exchange.body))}</p></body></html>`, {
        status: exchange.status >= 400 ? exchange.status : 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const credentials: TwitterCredentials = {
      apiKey: pending.api_key,
      apiSecret: pending.api_secret,
      accessToken,
      accessSecret,
    };

    let profile: TwitterPresentationProfile = {
      user_id: userId,
      username: screenName || userId,
      display_name: null,
      avatar_url: null,
    };
    try {
      profile = await fetchTwitterProfile(credentials);
    } catch {
      // Keep the token exchange result even if profile enrichment fails.
    }

    await upsertTwitterAccount(env, {
      username: profile.username || screenName || userId,
      api_key: pending.api_key,
      api_secret: pending.api_secret,
      access_token: accessToken,
      access_secret: accessSecret,
      status: "active",
      display_name: profile.display_name || undefined,
      avatar_url: profile.avatar_url || undefined,
      tags: pending.tags,
    }, pendingUserId);
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(stateKey).run();

    return new Response(
      `<html>
        <head><title>Twitter/X connected</title></head>
        <body>
          <h1>Twitter/X account connected</h1>
          <p>You can return to the dashboard now.</p>
          <script>
            const payload = { type: "twitter_connected", ok: true };
            if (window.opener) {
              window.opener.postMessage(payload, window.location.origin);
              window.close();
            } else {
              window.location.href = "/";
            }
          </script>
        </body>
      </html>`,
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  } catch {
    return new Response("<html><body><h1>Error processing Twitter/X OAuth callback</h1></body></html>", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}

export async function updateTwitterAccount(
  env: Env,
  accountId: string,
  request: Request,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) return errorResponse("Invalid account ID", 400);

    const filters = ["id = ?", "platform = 'twitter'"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "social_accounts", filters, filterValues, scopeId);
    const existing = await env.DB.prepare(`SELECT id FROM social_accounts WHERE ${filters.join(" AND ")}`)
      .bind(...filterValues)
      .first<{ id: number }>();
    if (!existing) return errorResponse("Twitter/X account not found", 404);

    const payload = await parseJson<TwitterAccountUpdatePayload>(request);
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

    const credentialUpdates: Array<[string, string]> = [];
    if (payload.api_key?.trim()) credentialUpdates.push(["twitter_api_key", payload.api_key.trim()]);
    if (payload.api_secret?.trim()) credentialUpdates.push(["twitter_api_secret", payload.api_secret.trim()]);
    if (payload.access_token?.trim()) credentialUpdates.push(["twitter_access_token", payload.access_token.trim()]);
    if (payload.access_secret?.trim()) credentialUpdates.push(["twitter_access_secret", payload.access_secret.trim()]);
    const connectionMode = payload.connection_mode ? "official_api" : null;
    const tagUpdate = payload.tags !== undefined;

    if (accountUpdates.length === 0 && credentialUpdates.length === 0 && !connectionMode && !tagUpdate) {
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

    const settingWrites: Array<Promise<unknown>> = credentialUpdates.flatMap(([key, value]) => [
      upsertSetting(env, `social_account:${id}:${key}`, value, now, scopeId),
      upsertSetting(env, key, value, now, scopeId),
    ]);
    if (connectionMode) {
      settingWrites.push(upsertSetting(env, `social_account:${id}:connection_mode`, connectionMode, now, scopeId));
    }
    if (tagUpdate) {
      settingWrites.push(upsertAccountTags(env, "social_account", id, payload.tags, now, scopeId));
    }
    await Promise.all(settingWrites);

    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Twitter/X account", 500);
  }
}

export async function deleteTwitterAccount(env: Env, accountId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) return errorResponse("Invalid account ID", 400);
    const filters = ["id = ?", "platform = 'twitter'"];
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
    return errorResponse("Failed to delete account", 500);
  }
}
