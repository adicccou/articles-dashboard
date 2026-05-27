import type { Env } from "../lib/types";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { DEFAULT_USER_ID, appendScopedFilter, ownerId, scopedInsertColumns, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import { claimSocialPostForPublishing, markLinkedPlannerItemsPublished, markSocialPostsFailed, socialPostsHaveLastError, socialPublishErrorMessage } from "../lib/social-publish";
import { normalizeAccountTags, readAccountTags, upsertAccountTags } from "../lib/account-tags";

type ExtraSocialPlatform = "facebook" | "linkedin" | "instagram" | "youtube";
type AccountConnectionMode = "official_api";
type AccountStatus = "active" | "inactive";
type ExtraSocialPostRow = {
  id: number;
  platform: ExtraSocialPlatform;
  content: string | null;
  image_url: string | null;
  status: string;
  account_id: number | null;
};

type ExtraSocialAccountPayload = {
  platform?: ExtraSocialPlatform;
  username?: string;
  status?: AccountStatus;
  connection_mode?: AccountConnectionMode;
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
  scopes?: string;
  access_token?: string;
  user_id?: string;
  page_id?: string;
  refresh_token?: string;
  tags?: unknown;
};

type InstagramTokenResponse = {
  access_token?: string;
  expires_in?: number;
  permissions?: string;
  token_type?: string;
  user_id?: string;
  error?: { message?: string };
  error_message?: string;
  data?: Array<{
    access_token?: string;
    permissions?: string;
    user_id?: string;
  }>;
};

type InstagramProfileResponse = {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  error?: { message?: string };
  error_message?: string;
  data?: Array<{
    id?: string;
    user_id?: string;
    username?: string;
    name?: string;
    account_type?: string;
    profile_picture_url?: string;
  }>;
};

type InstagramInsightsGraphResponse = {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: unknown }>;
  }>;
  error?: { message?: string };
  error_message?: string;
};

type InstagramMediaCountsResponse = {
  like_count?: number;
  comments_count?: number;
  error?: { message?: string };
  error_message?: string;
};

type LinkedInUserInfo = {
  sub?: string;
  name?: string;
  picture?: string;
  email?: string;
};

type LinkedInTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type LinkedInAnalyticsResponse = {
  elements?: Array<{
    count?: number | string;
    metricType?: string;
    targetEntity?: string;
  }>;
  message?: string;
  serviceErrorCode?: number;
  status?: number;
};

type FacebookGraphErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

type FacebookTokenResponse = FacebookGraphErrorPayload & {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type FacebookPicture = {
  data?: {
    url?: string;
    is_silhouette?: boolean;
  };
};

type FacebookProfileResponse = FacebookGraphErrorPayload & {
  id?: string;
  name?: string;
  picture?: FacebookPicture;
};

type FacebookAccountsResponse = FacebookGraphErrorPayload & {
  data?: Array<{
    id?: string;
    name?: string;
    access_token?: string;
    picture?: FacebookPicture;
  }>;
};

type MetaSignedRequestPayload = {
  algorithm?: string;
  user_id?: string;
  profile_id?: string;
  issued_at?: number;
};

type FieldName =
  | "client_id"
  | "client_secret"
  | "redirect_uri"
  | "scopes"
  | "access_token"
  | "user_id"
  | "page_id"
  | "refresh_token";

const EXTRA_SOCIAL_PLATFORMS: ExtraSocialPlatform[] = ["facebook", "linkedin", "instagram", "youtube"];
const DEFAULT_FACEBOOK_OAUTH_SCOPES = [
  "public_profile",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
].join(",");
const DEFAULT_INSTAGRAM_OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
].join(",");
const REQUIRED_INSTAGRAM_OAUTH_SCOPES = DEFAULT_INSTAGRAM_OAUTH_SCOPES.split(",");
const INSTAGRAM_INSIGHT_METRICS = ["views", "likes", "comments", "shares", "saved", "total_interactions"] as const;
type InstagramInsightMetric = typeof INSTAGRAM_INSIGHT_METRICS[number];
const LINKEDIN_BASE_OAUTH_SCOPES = ["openid", "profile", "w_member_social"];
const LINKEDIN_MEMBER_ANALYTICS_SCOPE = "r_member_postAnalytics";
const DEFAULT_LINKEDIN_OAUTH_SCOPES = LINKEDIN_BASE_OAUTH_SCOPES.join(" ");
const LINKEDIN_ANALYTICS_METRICS = ["IMPRESSION", "REACTION", "RESHARE", "COMMENT"] as const;
type LinkedInAnalyticsMetric = typeof LINKEDIN_ANALYTICS_METRICS[number];
const FACEBOOK_AUTHORIZE_BASE_URL = "https://www.facebook.com";
const FACEBOOK_GRAPH_BASE_URL = "https://graph.facebook.com";
const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_GRAPH_BASE_URL = "https://graph.instagram.com";
const INSTAGRAM_MAX_CAROUSEL_IMAGES = 10;
const INSTAGRAM_CONTAINER_POLL_ATTEMPTS = 12;
const LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_MEMBER_POST_ANALYTICS_URL = "https://api.linkedin.com/rest/memberCreatorPostAnalytics";
const LINKEDIN_IMAGES_URL = "https://api.linkedin.com/rest/images?action=initializeUpload";

const OFFICIAL_FIELD_SETTINGS: Record<ExtraSocialPlatform, Record<FieldName, string>> = {
  facebook: {
    client_id: "facebook_client_id",
    client_secret: "facebook_client_secret",
    redirect_uri: "facebook_redirect_uri",
    scopes: "facebook_scopes",
    access_token: "facebook_access_token",
    user_id: "facebook_page_id",
    page_id: "facebook_user_id",
    refresh_token: "facebook_refresh_token",
  },
  linkedin: {
    client_id: "linkedin_client_id",
    client_secret: "linkedin_client_secret",
    redirect_uri: "linkedin_redirect_uri",
    scopes: "linkedin_scopes",
    access_token: "linkedin_access_token",
    user_id: "linkedin_author_urn",
    page_id: "linkedin_page_id",
    refresh_token: "linkedin_refresh_token",
  },
  instagram: {
    client_id: "instagram_client_id",
    client_secret: "instagram_client_secret",
    redirect_uri: "instagram_redirect_uri",
    scopes: "instagram_scopes",
    access_token: "instagram_access_token",
    user_id: "instagram_user_id",
    page_id: "instagram_page_id",
    refresh_token: "instagram_refresh_token",
  },
  youtube: {
    client_id: "youtube_client_id",
    client_secret: "youtube_client_secret",
    redirect_uri: "youtube_redirect_uri",
    scopes: "youtube_scopes",
    access_token: "youtube_access_token",
    user_id: "youtube_channel_id",
    page_id: "youtube_page_id",
    refresh_token: "youtube_refresh_token",
  },
};

const REQUIRED_OFFICIAL_FIELDS: Record<ExtraSocialPlatform, FieldName[]> = {
  facebook: ["access_token", "user_id"],
  linkedin: ["access_token", "user_id"],
  instagram: ["access_token", "user_id"],
  youtube: ["client_id", "client_secret", "redirect_uri", "scopes", "refresh_token", "user_id"],
};

function isExtraSocialPlatform(value: unknown): value is ExtraSocialPlatform {
  return EXTRA_SOCIAL_PLATFORMS.includes(String(value ?? "").trim().toLowerCase() as ExtraSocialPlatform);
}

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

async function storedOfficialCredentialsReady(
  env: Env,
  platform: ExtraSocialPlatform,
  accountId: number,
  scopeId = DEFAULT_USER_ID,
): Promise<boolean> {
  const settingKeys = REQUIRED_OFFICIAL_FIELDS[platform].map((field) => `social_account:${accountId}:${OFFICIAL_FIELD_SETTINGS[platform][field]}`);
  const values = await Promise.all(settingKeys.map((key) => readSetting(env, key, scopeId)));
  return values.every((value) => value.trim());
}

function graphApiVersion(): string {
  return "v25.0";
}

function facebookPayloadError(payload: FacebookGraphErrorPayload | null | undefined): string {
  return payload?.error?.message || "";
}

function instagramPayloadError(payload: { error?: { message?: string }; error_message?: string } | null | undefined): string {
  return payload?.error?.message || payload?.error_message || "";
}

function normalizeInstagramTokenResponse(payload: InstagramTokenResponse): InstagramTokenResponse {
  if (Array.isArray(payload.data) && payload.data.length > 0) {
    return { ...payload, ...payload.data[0] };
  }
  return payload;
}

function normalizeInstagramProfileResponse(payload: InstagramProfileResponse): InstagramProfileResponse {
  if (Array.isArray(payload.data) && payload.data.length > 0) {
    return { ...payload, ...payload.data[0] };
  }
  return payload;
}

function normalizeInstagramScopes(scopes: string): string {
  const seen = new Set<string>();
  for (const scope of scopes.split(/[,\s]+/)) {
    const normalized = scope.trim();
    if (normalized) seen.add(normalized);
  }
  for (const scope of REQUIRED_INSTAGRAM_OAUTH_SCOPES) {
    seen.add(scope);
  }
  return Array.from(seen).join(",");
}

async function readStoredInstagramOAuthConfig(env: Env, userId = DEFAULT_USER_ID) {
  const filters = ["platform = 'instagram'", "status = 'active'"];
  const values: unknown[] = [];
  await appendScopedFilter(env, "social_accounts", filters, values, userId);
  const account = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
  )
    .bind(...values)
    .first<{ id: number }>();
  if (!account?.id) return null;

  const [clientId, clientSecret, redirectUri, scopes] = await Promise.all([
    readSetting(env, `social_account:${account.id}:instagram_client_id`, userId),
    readSetting(env, `social_account:${account.id}:instagram_client_secret`, userId),
    readSetting(env, `social_account:${account.id}:instagram_redirect_uri`, userId),
    readSetting(env, `social_account:${account.id}:instagram_scopes`, userId),
  ]);
  if (!clientId || !clientSecret) return null;

  return {
    appId: clientId,
    appSecret: clientSecret,
    redirectUri,
    scopes,
  };
}

async function readStoredFacebookOAuthConfig(env: Env, userId = DEFAULT_USER_ID) {
  const filters = ["platform = 'facebook'", "status = 'active'"];
  const values: unknown[] = [];
  await appendScopedFilter(env, "social_accounts", filters, values, userId);
  const account = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
  )
    .bind(...values)
    .first<{ id: number }>();
  if (!account?.id) return null;

  const [clientId, clientSecret, redirectUri, scopes] = await Promise.all([
    readSetting(env, `social_account:${account.id}:facebook_client_id`, userId),
    readSetting(env, `social_account:${account.id}:facebook_client_secret`, userId),
    readSetting(env, `social_account:${account.id}:facebook_redirect_uri`, userId),
    readSetting(env, `social_account:${account.id}:facebook_scopes`, userId),
  ]);
  if (!clientId || !clientSecret) return null;

  return { appId: clientId, appSecret: clientSecret, redirectUri, scopes };
}

function facebookAppSecretForAppId(
  env: Env,
  appId: string,
  stored?: { appId: string; appSecret: string } | null,
): string {
  const normalizedAppId = appId.trim();
  if (!normalizedAppId) return "";

  const facebookAppId = env.FACEBOOK_APP_ID?.trim();
  if (facebookAppId && normalizedAppId === facebookAppId) {
    return env.FACEBOOK_APP_SECRET?.trim()
      || (stored?.appId === normalizedAppId ? stored.appSecret : "")
      || "";
  }

  const metaAppId = env.META_APP_ID?.trim();
  if (metaAppId && normalizedAppId === metaAppId) {
    return env.META_APP_SECRET?.trim()
      || env.INSTAGRAM_APP_SECRET?.trim()
      || (stored?.appId === normalizedAppId ? stored.appSecret : "")
      || "";
  }

  if (stored?.appId === normalizedAppId) return stored.appSecret;
  return "";
}

async function facebookOAuthConfig(env: Env, requestUrl: string, userId = DEFAULT_USER_ID) {
  const requestOrigin = new URL(requestUrl).origin;
  const stored = await readStoredFacebookOAuthConfig(env, userId);
  const appId = env.FACEBOOK_APP_ID?.trim() || env.META_APP_ID?.trim() || stored?.appId || "";
  return {
    appId,
    appSecret: facebookAppSecretForAppId(env, appId, stored),
    redirectUri: env.FACEBOOK_REDIRECT_URI?.trim() || stored?.redirectUri || `${requestOrigin}/api/facebook/auth/callback`,
    scopes: env.FACEBOOK_SCOPES?.trim() || stored?.scopes || DEFAULT_FACEBOOK_OAUTH_SCOPES,
  };
}

async function readStoredMetaAppConfigFromThreads(env: Env, userId = DEFAULT_USER_ID) {
  const filters = ["platform = 'threads'", "status = 'active'"];
  const values: unknown[] = [];
  await appendScopedFilter(env, "social_accounts", filters, values, userId);
  const account = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
  )
    .bind(...values)
    .first<{ id: number }>();
  if (!account?.id) return null;

  const [clientId, clientSecret] = await Promise.all([
    readSetting(env, `social_account:${account.id}:threads_client_id`, userId),
    readSetting(env, `social_account:${account.id}:threads_client_secret`, userId),
  ]);
  if (!clientId || !clientSecret) return null;

  return {
    appId: clientId,
    appSecret: clientSecret,
  };
}

async function instagramOAuthConfig(env: Env, requestUrl: string, userId = DEFAULT_USER_ID) {
  const requestOrigin = new URL(requestUrl).origin;
  const stored = await readStoredInstagramOAuthConfig(env, userId);
  const metaFromThreads = await readStoredMetaAppConfigFromThreads(env, userId);
  const appId = env.INSTAGRAM_APP_ID?.trim() || env.META_APP_ID?.trim() || stored?.appId || metaFromThreads?.appId || "";
  return {
    appId,
    appSecret: instagramAppSecretForAppId(env, appId, stored, metaFromThreads),
    redirectUri: env.INSTAGRAM_REDIRECT_URI?.trim() || stored?.redirectUri || `${requestOrigin}/api/instagram/auth/callback`,
    scopes: normalizeInstagramScopes(env.INSTAGRAM_OAUTH_SCOPES?.trim() || stored?.scopes || DEFAULT_INSTAGRAM_OAUTH_SCOPES),
  };
}

function instagramAppSecretForAppId(
  env: Env,
  appId: string,
  stored?: { appId: string; appSecret: string } | null,
  metaFromThreads?: { appId: string; appSecret: string } | null,
): string {
  const normalizedAppId = appId.trim();
  if (!normalizedAppId) return "";

  const instagramAppId = env.INSTAGRAM_APP_ID?.trim();
  if (instagramAppId && normalizedAppId === instagramAppId) {
    return env.INSTAGRAM_APP_SECRET?.trim()
      || (stored?.appId === normalizedAppId ? stored.appSecret : "")
      || "";
  }

  const metaAppId = env.META_APP_ID?.trim();
  if (metaAppId && normalizedAppId === metaAppId) {
    return env.META_APP_SECRET?.trim()
      || env.INSTAGRAM_APP_SECRET?.trim()
      || (stored?.appId === normalizedAppId ? stored.appSecret : "")
      || "";
  }

  if (stored?.appId === normalizedAppId) return stored.appSecret;
  if (metaFromThreads?.appId === normalizedAppId) return metaFromThreads.appSecret;
  return "";
}

async function readStoredLinkedInOAuthConfig(env: Env, userId = DEFAULT_USER_ID) {
  const filters = ["platform = 'linkedin'", "status = 'active'"];
  const values: unknown[] = [];
  await appendScopedFilter(env, "social_accounts", filters, values, userId);
  const account = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
  )
    .bind(...values)
    .first<{ id: number }>();
  if (!account?.id) return null;

  const [clientId, clientSecret, redirectUri, scopes] = await Promise.all([
    readSetting(env, `social_account:${account.id}:linkedin_client_id`, userId),
    readSetting(env, `social_account:${account.id}:linkedin_client_secret`, userId),
    readSetting(env, `social_account:${account.id}:linkedin_redirect_uri`, userId),
    readSetting(env, `social_account:${account.id}:linkedin_scopes`, userId),
  ]);
  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret, redirectUri, scopes };
}

function normalizeLinkedInScopes(scopes: string): string {
  const seen = new Set<string>();
  for (const scope of scopes.split(/[,\s]+/)) {
    const normalized = scope.trim();
    if (normalized) seen.add(normalized);
  }
  for (const scope of LINKEDIN_BASE_OAUTH_SCOPES) {
    seen.add(scope);
  }
  return Array.from(seen).join(" ");
}

async function linkedInOAuthConfig(env: Env, requestUrl: string, userId = DEFAULT_USER_ID) {
  const requestOrigin = new URL(requestUrl).origin;
  const stored = await readStoredLinkedInOAuthConfig(env, userId);
  return {
    clientId: env.LINKEDIN_CLIENT_ID?.trim() || stored?.clientId || "",
    clientSecret: env.LINKEDIN_CLIENT_SECRET?.trim() || stored?.clientSecret || "",
    redirectUri: env.LINKEDIN_REDIRECT_URI?.trim() || stored?.redirectUri || `${requestOrigin}/api/linkedin/auth/callback`,
    scopes: normalizeLinkedInScopes(env.LINKEDIN_SCOPES?.trim() || stored?.scopes || DEFAULT_LINKEDIN_OAUTH_SCOPES),
  };
}

function linkedInVersion(env: Env): string {
  return env.LINKEDIN_VERSION?.trim() || "202605";
}

function linkedInRestHeaders(env: Env, accessToken: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Linkedin-Version": linkedInVersion(env),
    "X-Restli-Protocol-Version": "2.0.0",
    ...(extra ?? {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

async function parseMetaSignedRequest(signedRequest: string, appSecret: string): Promise<MetaSignedRequestPayload> {
  const [encodedSignature, encodedPayload] = signedRequest.split(".", 2);
  if (!encodedSignature || !encodedPayload) {
    throw new Error("Missing signed request payload.");
  }

  const payloadBytes = decodeBase64Url(encodedPayload);
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as MetaSignedRequestPayload;
  if ((payload.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") {
    throw new Error("Unsupported signed request algorithm.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedSignature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload)),
  );
  const actualSignature = decodeBase64Url(encodedSignature);
  if (!timingSafeEqual(expectedSignature, actualSignature)) {
    throw new Error("Invalid signed request signature.");
  }

  return payload;
}

export function mediaUrls(raw: string | null): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
      }
    } catch {
      return [value];
    }
  }
  return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInstagramContainer(accessToken: string, containerId: string): Promise<void> {
  const statusUrl = new URL(`${INSTAGRAM_GRAPH_BASE_URL}/${graphApiVersion()}/${encodeURIComponent(containerId)}`);
  statusUrl.searchParams.set("fields", "status_code,status");
  statusUrl.searchParams.set("access_token", accessToken);

  for (let attempt = 0; attempt < INSTAGRAM_CONTAINER_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(Math.min(1000 + attempt * 500, 4000));
    }
    const response = await fetch(statusUrl.toString());
    const payload = await response.json().catch(() => ({})) as {
      status_code?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message || `Instagram media container ${containerId} status check failed.`);
    }
    const statusCode = String(payload.status_code || "").toUpperCase();
    if (statusCode === "FINISHED") return;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(payload.status || `Instagram media container ${containerId} ended with ${statusCode}.`);
    }
  }

  throw new Error(`Instagram media container ${containerId} was not ready in time. Try again in a minute.`);
}

async function readOfficialAccountFields(
  env: Env,
  platform: ExtraSocialPlatform,
  accountId: number,
  scopeId = DEFAULT_USER_ID,
): Promise<Record<FieldName, string>> {
  const entries = await Promise.all(Object.entries(OFFICIAL_FIELD_SETTINGS[platform]).map(async ([field, settingKey]) => {
    const value = await readSetting(env, `social_account:${accountId}:${settingKey}`, scopeId);
    return [field, value] as const;
  }));
  return Object.fromEntries(entries) as Record<FieldName, string>;
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
    display_name: displayName || null,
    avatar_url: avatarUrl || null,
  };
}

async function refreshLinkedInAccountPresentation(
  env: Env,
  accountId: number,
  current: { display_name: string | null; avatar_url: string | null },
  scopeId = DEFAULT_USER_ID,
): Promise<{ display_name: string | null; avatar_url: string | null }> {
  const token = (await readSetting(env, `social_account:${accountId}:linkedin_access_token`, scopeId)).trim();
  if (!token) return current;

  try {
    const response = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const profile = await response.json() as LinkedInUserInfo;
    if (!response.ok) return current;

    const displayName = profile.name?.trim() || current.display_name;
    const avatarUrl = profile.picture?.trim() || current.avatar_url;
    const now = new Date().toISOString();
    await Promise.all([
      ...(displayName ? [upsertSetting(env, `social_account:${accountId}:display_name`, displayName, now, scopeId)] : []),
      ...(avatarUrl ? [upsertSetting(env, `social_account:${accountId}:avatar_url`, avatarUrl, now, scopeId)] : []),
    ]);
    return {
      display_name: displayName || null,
      avatar_url: avatarUrl || null,
    };
  } catch {
    return current;
  }
}

async function upsertInstagramOAuthAccount(
  env: Env,
  account: {
    username: string;
    displayName?: string;
    accessToken: string;
    instagramUserId: string;
    instagramProfileId?: string;
    facebookUserId?: string;
    pageId?: string;
    appId: string;
    redirectUri: string;
    scopes: string;
    userAccessToken: string;
    expiresIn?: number;
    avatarUrl?: string;
  },
  scopeId = DEFAULT_USER_ID,
): Promise<number> {
  const now = new Date().toISOString();
  const username = account.username.trim().replace(/^@+/, "") || account.instagramUserId;
  const existingFilters = ["platform = 'instagram'", "username = ?"];
  const existingValues: unknown[] = [username];
  await appendScopedFilter(env, "social_accounts", existingFilters, existingValues, scopeId);
  const existing = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${existingFilters.join(" AND ")} ORDER BY id DESC LIMIT 1`,
  )
    .bind(...existingValues)
    .first<{ id: number }>();

  let accountId = existing?.id ?? 0;
  if (accountId) {
    const updateFilters = ["id = ?"];
    const updateValues: unknown[] = [accountId];
    await appendScopedFilter(env, "social_accounts", updateFilters, updateValues, scopeId);
    await env.DB.prepare(`UPDATE social_accounts SET status = 'active', updated_at = ? WHERE ${updateFilters.join(" AND ")}`)
      .bind(now, ...updateValues)
      .run();
  } else {
    const scoped = await scopedInsertColumns(env, "social_accounts", scopeId);
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (${[...scoped.columns, "platform", "username", "status", "created_at", "updated_at"].join(", ")})
       VALUES (${[...scoped.columns.map(() => "?"), "?", "?", "'active'", "?", "?"].join(", ")})`,
    )
      .bind(...scoped.values, "instagram", username, now, now)
      .run() as { meta: { last_row_id: number } };
    accountId = result.meta.last_row_id;
  }

  const expiresAt = account.expiresIn
    ? new Date(Date.now() + account.expiresIn * 1000).toISOString()
    : "";
  await Promise.all([
    upsertSetting(env, `social_account:${accountId}:connection_mode`, "official_api", now, scopeId),
    upsertSetting(env, `social_account:${accountId}:instagram_client_id`, account.appId, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:instagram_redirect_uri`, account.redirectUri, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:instagram_scopes`, account.scopes, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:instagram_access_token`, account.accessToken, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:instagram_user_id`, account.instagramUserId, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:instagram_user_access_token`, account.userAccessToken, now, scopeId),
    ...(account.pageId?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:instagram_page_id`, account.pageId.trim(), now, scopeId)]
      : []),
    ...(account.instagramProfileId?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:instagram_profile_id`, account.instagramProfileId.trim(), now, scopeId)]
      : []),
    ...(account.facebookUserId?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:instagram_facebook_user_id`, account.facebookUserId.trim(), now, scopeId)]
      : []),
    ...(account.displayName?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:display_name`, account.displayName.trim(), now, scopeId)]
      : []),
    ...(account.avatarUrl?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:avatar_url`, account.avatarUrl.trim(), now, scopeId)]
      : []),
    ...(expiresAt ? [upsertSetting(env, `social_account:${accountId}:instagram_user_token_expires_at`, expiresAt, now, scopeId)] : []),
  ]);

  return accountId;
}

async function upsertLinkedInOAuthAccount(
  env: Env,
  account: {
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    accessToken: string;
    authorUrn: string;
    clientId: string;
    redirectUri: string;
    scopes: string;
    expiresIn?: number;
  },
  scopeId = DEFAULT_USER_ID,
): Promise<number> {
  const now = new Date().toISOString();
  const username = account.username.trim() || account.authorUrn;
  const existingFilters = ["platform = 'linkedin'", "username = ?"];
  const existingValues: unknown[] = [username];
  await appendScopedFilter(env, "social_accounts", existingFilters, existingValues, scopeId);
  const existing = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${existingFilters.join(" AND ")} ORDER BY id DESC LIMIT 1`,
  )
    .bind(...existingValues)
    .first<{ id: number }>();

  let accountId = existing?.id ?? 0;
  if (accountId) {
    const updateFilters = ["id = ?"];
    const updateValues: unknown[] = [accountId];
    await appendScopedFilter(env, "social_accounts", updateFilters, updateValues, scopeId);
    await env.DB.prepare(`UPDATE social_accounts SET status = 'active', updated_at = ? WHERE ${updateFilters.join(" AND ")}`)
      .bind(now, ...updateValues)
      .run();
  } else {
    const scoped = await scopedInsertColumns(env, "social_accounts", scopeId);
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (${[...scoped.columns, "platform", "username", "status", "created_at", "updated_at"].join(", ")})
       VALUES (${[...scoped.columns.map(() => "?"), "?", "?", "'active'", "?", "?"].join(", ")})`,
    )
      .bind(...scoped.values, "linkedin", username, now, now)
      .run() as { meta: { last_row_id: number } };
    accountId = result.meta.last_row_id;
  }

  const expiresAt = account.expiresIn
    ? new Date(Date.now() + account.expiresIn * 1000).toISOString()
    : "";
  await Promise.all([
    upsertSetting(env, `social_account:${accountId}:connection_mode`, "official_api", now, scopeId),
    upsertSetting(env, `social_account:${accountId}:linkedin_client_id`, account.clientId, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:linkedin_redirect_uri`, account.redirectUri, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:linkedin_scopes`, account.scopes, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:linkedin_access_token`, account.accessToken, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:linkedin_author_urn`, account.authorUrn, now, scopeId),
    ...(account.displayName?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:display_name`, account.displayName.trim(), now, scopeId)]
      : []),
    ...(account.avatarUrl?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:avatar_url`, account.avatarUrl.trim(), now, scopeId)]
      : []),
    ...(expiresAt ? [upsertSetting(env, `social_account:${accountId}:linkedin_token_expires_at`, expiresAt, now, scopeId)] : []),
  ]);

  return accountId;
}

async function upsertFacebookOAuthAccount(
  env: Env,
  account: {
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    accessToken: string;
    facebookUserId: string;
    facebookPageId?: string | null;
    appId: string;
    redirectUri: string;
    scopes: string;
    expiresIn?: number;
    accountType: "page" | "profile";
  },
  scopeId = DEFAULT_USER_ID,
): Promise<number> {
  const now = new Date().toISOString();
  const username = account.username.trim() || account.facebookPageId?.trim() || account.facebookUserId;
  const existingFilters = ["platform = 'facebook'", "username = ?"];
  const existingValues: unknown[] = [username];
  await appendScopedFilter(env, "social_accounts", existingFilters, existingValues, scopeId);
  const existing = await env.DB.prepare(
    `SELECT id FROM social_accounts WHERE ${existingFilters.join(" AND ")} ORDER BY id DESC LIMIT 1`,
  )
    .bind(...existingValues)
    .first<{ id: number }>();

  let accountId = existing?.id ?? 0;
  if (accountId) {
    const updateFilters = ["id = ?"];
    const updateValues: unknown[] = [accountId];
    await appendScopedFilter(env, "social_accounts", updateFilters, updateValues, scopeId);
    await env.DB.prepare(`UPDATE social_accounts SET status = 'active', updated_at = ? WHERE ${updateFilters.join(" AND ")}`)
      .bind(now, ...updateValues)
      .run();
  } else {
    const scoped = await scopedInsertColumns(env, "social_accounts", scopeId);
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (${[...scoped.columns, "platform", "username", "status", "created_at", "updated_at"].join(", ")})
       VALUES (${[...scoped.columns.map(() => "?"), "?", "?", "'active'", "?", "?"].join(", ")})`,
    )
      .bind(...scoped.values, "facebook", username, now, now)
      .run() as { meta: { last_row_id: number } };
    accountId = result.meta.last_row_id;
  }

  const expiresAt = account.expiresIn
    ? new Date(Date.now() + account.expiresIn * 1000).toISOString()
    : "";
  const targetId = account.facebookPageId?.trim() || account.facebookUserId;
  await Promise.all([
    upsertSetting(env, `social_account:${accountId}:connection_mode`, "official_api", now, scopeId),
    upsertSetting(env, `social_account:${accountId}:facebook_client_id`, account.appId, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:facebook_redirect_uri`, account.redirectUri, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:facebook_scopes`, account.scopes, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:facebook_access_token`, account.accessToken, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:facebook_page_id`, targetId, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:facebook_user_id`, account.facebookUserId, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:facebook_account_type`, account.accountType, now, scopeId),
    ...(account.displayName?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:display_name`, account.displayName.trim(), now, scopeId)]
      : []),
    ...(account.avatarUrl?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:avatar_url`, account.avatarUrl.trim(), now, scopeId)]
      : []),
    ...(expiresAt ? [upsertSetting(env, `social_account:${accountId}:facebook_token_expires_at`, expiresAt, now, scopeId)] : []),
  ]);

  return accountId;
}

async function resolveExtraAccountForPost(
  env: Env,
  post: ExtraSocialPostRow,
  scopeId = DEFAULT_USER_ID,
): Promise<{
  id: number;
  platform: ExtraSocialPlatform;
  username: string;
} | null> {
  const filters = [`platform = ?`, "status = 'active'"];
  const values: unknown[] = [post.platform];
  if (post.account_id) {
    filters.push("id = ?");
    values.push(post.account_id);
  }
  await appendScopedFilter(env, "social_accounts", filters, values, scopeId);
  const account = await env.DB.prepare(
    `SELECT id, platform, username
     FROM social_accounts
     WHERE ${filters.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(...values)
    .first<{ id: number; platform: ExtraSocialPlatform; username: string }>();
  if (!account) return null;

  return account;
}

async function publishInstagramOfficial(
  env: Env,
  post: ExtraSocialPostRow,
  accountId: number,
  scopeId = DEFAULT_USER_ID,
): Promise<string> {
  const credentials = await readOfficialAccountFields(env, "instagram", accountId, scopeId);
  const accessToken = credentials.access_token.trim();
  const instagramUserId = credentials.user_id.trim();
  const images = mediaUrls(post.image_url);
  if (!accessToken || !instagramUserId) throw new Error("Instagram official API credentials are incomplete.");
  if (images.length === 0) throw new Error("Instagram official API publishing needs an attached public image URL.");
  if (images.length > INSTAGRAM_MAX_CAROUSEL_IMAGES) {
    throw new Error(`Instagram supports up to ${INSTAGRAM_MAX_CAROUSEL_IMAGES} images per carousel. This post has ${images.length}; split it before publishing.`);
  }

  const createMediaContainer = async (body: URLSearchParams) => {
    const mediaResponse = await fetch(`${INSTAGRAM_GRAPH_BASE_URL}/${graphApiVersion()}/${encodeURIComponent(instagramUserId)}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const mediaPayload = await mediaResponse.json() as { id?: string; error?: { message?: string } };
    if (!mediaResponse.ok || !mediaPayload.id) {
      throw new Error(mediaPayload.error?.message || "Instagram media container creation failed.");
    }
    return mediaPayload.id;
  };

  let creationId = "";
  if (images.length === 1) {
    creationId = await createMediaContainer(new URLSearchParams({
      image_url: images[0],
      caption: post.content?.trim() ?? "",
      access_token: accessToken,
    }));
    await waitForInstagramContainer(accessToken, creationId);
  } else {
    const childIds = await Promise.all(images.map((imageUrl) => createMediaContainer(new URLSearchParams({
      image_url: imageUrl,
      is_carousel_item: "true",
      access_token: accessToken,
    }))));
    await Promise.all(childIds.map((childId) => waitForInstagramContainer(accessToken, childId)));
    creationId = await createMediaContainer(new URLSearchParams({
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: post.content?.trim() ?? "",
      access_token: accessToken,
    }));
    await waitForInstagramContainer(accessToken, creationId);
  }

  const publishBody = new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken,
  });
  const publishResponse = await fetch(`${INSTAGRAM_GRAPH_BASE_URL}/${graphApiVersion()}/${encodeURIComponent(instagramUserId)}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: publishBody.toString(),
  });
  const publishPayload = await publishResponse.json() as { id?: string; error?: { message?: string } };
  if (!publishResponse.ok || !publishPayload.id) {
    throw new Error(publishPayload.error?.message || "Instagram publish failed.");
  }
  return publishPayload.id;
}

function parseInstagramMetricValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function readInstagramMetricValue(metrics: Map<string, number>, name: string): number | null {
  return metrics.has(name) ? metrics.get(name) ?? null : null;
}

function instagramInsightFailureMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : "Instagram insights lookup failed.";
}

function sumNullableMetric(items: Array<Record<string, unknown>>, key: string): number | null {
  let found = false;
  let total = 0;
  for (const item of items) {
    const value = item[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    found = true;
    total += value;
  }
  return found ? total : null;
}

async function fetchInstagramInsightMetrics(
  accessToken: string,
  externalId: string,
  metrics: readonly InstagramInsightMetric[],
): Promise<Map<string, number>> {
  const insightsUrl = new URL(`${INSTAGRAM_GRAPH_BASE_URL}/${graphApiVersion()}/${encodeURIComponent(externalId)}/insights`);
  insightsUrl.searchParams.set("metric", metrics.join(","));
  insightsUrl.searchParams.set("access_token", accessToken);

  const response = await fetch(insightsUrl.toString());
  const payload = await response.json().catch(() => ({})) as InstagramInsightsGraphResponse;
  if (!response.ok || payload.error || payload.error_message) {
    throw new Error(instagramPayloadError(payload) || "Instagram insights lookup failed.");
  }

  const values = new Map<string, number>();
  for (const metric of payload.data ?? []) {
    const name = metric.name?.trim();
    const value = parseInstagramMetricValue(metric.values?.[0]?.value);
    if (name && value !== null) values.set(name, value);
  }
  return values;
}

async function fetchAvailableInstagramInsightMetrics(
  accessToken: string,
  externalId: string,
): Promise<Map<string, number>> {
  try {
    return await fetchInstagramInsightMetrics(accessToken, externalId, INSTAGRAM_INSIGHT_METRICS);
  } catch (batchError) {
    const merged = new Map<string, number>();
    for (const metric of INSTAGRAM_INSIGHT_METRICS) {
      try {
        const values = await fetchInstagramInsightMetrics(accessToken, externalId, [metric]);
        for (const [name, value] of values) merged.set(name, value);
      } catch {
        // Some Instagram metrics are unavailable for specific media types; keep the metrics that do resolve.
      }
    }
    if (merged.size === 0) throw batchError;
    return merged;
  }
}

async function fetchInstagramMediaCounts(accessToken: string, externalId: string): Promise<InstagramMediaCountsResponse | null> {
  const mediaUrl = new URL(`${INSTAGRAM_GRAPH_BASE_URL}/${graphApiVersion()}/${encodeURIComponent(externalId)}`);
  mediaUrl.searchParams.set("fields", "like_count,comments_count");
  mediaUrl.searchParams.set("access_token", accessToken);

  const response = await fetch(mediaUrl.toString());
  const payload = await response.json().catch(() => ({})) as InstagramMediaCountsResponse;
  if (!response.ok || payload.error || payload.error_message) return null;
  return payload;
}

async function fetchInstagramPostInsights(
  accessToken: string,
  accountId: number,
  target: { id: number; external_id: string; account_id: number | null },
) {
  let metrics = new Map<string, number>();
  let insightError: unknown = null;
  try {
    metrics = await fetchAvailableInstagramInsightMetrics(accessToken, target.external_id);
  } catch (error) {
    insightError = error;
  }
  const counts = await fetchInstagramMediaCounts(accessToken, target.external_id);
  if (metrics.size === 0 && !counts) throw insightError ?? new Error("Instagram did not return metrics for this post.");

  return {
    platform: "instagram" as const,
    account_id: target.account_id ?? accountId,
    post_id: target.id,
    external_id: target.external_id,
    views: readInstagramMetricValue(metrics, "views"),
    likes: readInstagramMetricValue(metrics, "likes") ?? parseInstagramMetricValue(counts?.like_count),
    shares: readInstagramMetricValue(metrics, "shares"),
    replies: readInstagramMetricValue(metrics, "comments") ?? parseInstagramMetricValue(counts?.comments_count),
    reposts: null,
    quotes: null,
    saved: readInstagramMetricValue(metrics, "saved"),
    total_interactions: readInstagramMetricValue(metrics, "total_interactions"),
  };
}

export async function listInstagramPostInsights(env: Env, url: URL, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const requestedAccountId = Number(url.searchParams.get("account_id") || 0) || undefined;
    const requestedLimit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100) || 100, 200));
    const accountFilters = ["platform = 'instagram'", "status = 'active'"];
    const accountValues: unknown[] = [];
    if (requestedAccountId) {
      accountFilters.push("id = ?");
      accountValues.push(requestedAccountId);
    }
    await appendScopedFilter(env, "social_accounts", accountFilters, accountValues, userId);
    const account = await env.DB.prepare(
      `SELECT id FROM social_accounts WHERE ${accountFilters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
    )
      .bind(...accountValues)
      .first<{ id: number }>();
    if (!account?.id) {
      return jsonResponse({
        data: [],
        status: "not_connected",
        warning: "No active Instagram account with official API credentials was found.",
        totals: { posts: 0, synced: 0, views: null, likes: null, shares: null, replies: null, reposts: null, quotes: null, saved: null, total_interactions: null },
      });
    }

    const credentials = await readOfficialAccountFields(env, "instagram", account.id, userId);
    const accessToken = credentials.access_token.trim();
    const instagramUserId = credentials.user_id.trim();
    if (!accessToken || !instagramUserId) {
      return jsonResponse({
        data: [],
        status: "not_connected",
        warning: "No active Instagram account with official API credentials was found.",
        totals: { posts: 0, synced: 0, views: null, likes: null, shares: null, replies: null, reposts: null, quotes: null, saved: null, total_interactions: null },
      });
    }

    const scopeSet = new Set(credentials.scopes.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean));
    if (!scopeSet.has("instagram_business_manage_insights")) {
      return jsonResponse({
        data: [],
        status: "needs_reconnect",
        warning: "Reconnect this Instagram account so Oilor can request instagram_business_manage_insights.",
        totals: { posts: 0, synced: 0, views: null, likes: null, shares: null, replies: null, reposts: null, quotes: null, saved: null, total_interactions: null },
      });
    }

    const postFilters = ["platform = 'instagram'", "status = 'posted'", "external_id IS NOT NULL", "TRIM(external_id) != ''"];
    const postValues: unknown[] = [];
    if (requestedAccountId) {
      postFilters.push("(account_id = ? OR account_id IS NULL)");
      postValues.push(requestedAccountId);
    }
    await appendScopedFilter(env, "social_posts", postFilters, postValues, userId);
    const rows = await env.DB.prepare(
      `SELECT id, external_id, account_id FROM social_posts WHERE ${postFilters.join(" AND ")} ORDER BY posted_at DESC, updated_at DESC LIMIT ?`,
    )
      .bind(...postValues, requestedLimit)
      .all<{ id: number; external_id: string | null; account_id: number | null }>();
    const targets = (rows.results ?? [])
      .map((row) => ({
        id: row.id,
        external_id: row.external_id?.trim() || "",
        account_id: row.account_id,
      }))
      .filter((row) => row.external_id);

    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          return { insight: await fetchInstagramPostInsights(accessToken, account.id, target), failure: null };
        } catch (error) {
          return {
            insight: null,
            failure: {
              post_id: target.id,
              external_id: target.external_id,
              message: instagramInsightFailureMessage(error),
            },
          };
        }
      }),
    );
    const insights = results.flatMap((result) => (result.insight ? [result.insight] : []));
    const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
    return jsonResponse({
      data: insights,
      status: "connected",
      warning: failures.length
        ? `Skipped ${failures.length} Instagram post${failures.length === 1 ? "" : "s"} because Meta did not return insights for ${failures.length === 1 ? "it" : "them"}.`
        : undefined,
      failures,
      totals: {
        posts: targets.length,
        synced: insights.length,
        views: sumNullableMetric(insights, "views"),
        likes: sumNullableMetric(insights, "likes"),
        shares: sumNullableMetric(insights, "shares"),
        replies: sumNullableMetric(insights, "replies"),
        reposts: sumNullableMetric(insights, "reposts"),
        quotes: sumNullableMetric(insights, "quotes"),
        saved: sumNullableMetric(insights, "saved"),
        total_interactions: sumNullableMetric(insights, "total_interactions"),
      },
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load Instagram insights", 500);
  }
}

async function publishLinkedInOfficial(
  env: Env,
  post: ExtraSocialPostRow,
  accountId: number,
  scopeId = DEFAULT_USER_ID,
): Promise<string> {
  const credentials = await readOfficialAccountFields(env, "linkedin", accountId, scopeId);
  const accessToken = credentials.access_token.trim();
  const author = credentials.user_id.trim().startsWith("urn:")
    ? credentials.user_id.trim()
    : `urn:li:person:${credentials.user_id.trim()}`;
  const text = post.content?.trim() ?? "";
  const images = mediaUrls(post.image_url);
  if (!accessToken || !author) throw new Error("LinkedIn official API credentials are incomplete.");
  if (!text) throw new Error("LinkedIn official API publishing needs post text.");
  if (images.length > 1) throw new Error("LinkedIn multi-image publishing is not implemented yet. Attach one image or publish text-only.");

  const body: Record<string, unknown> = {
    author,
    commentary: text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (images.length === 1) {
    const imageUrn = await uploadLinkedInImage(env, accessToken, author, images[0]);
    body.content = {
      media: {
        id: imageUrn,
      },
    };
  }

  const response = await fetch(LINKEDIN_POSTS_URL, {
    method: "POST",
    headers: linkedInRestHeaders(env, accessToken),
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText || "LinkedIn publish failed.");
  }
  return response.headers.get("x-restli-id") || responseText || `linkedin:${Date.now()}`;
}

function parseLinkedInMetricValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function linkedInAnalyticsFailureMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : "LinkedIn analytics lookup failed.";
}

function linkedInEntityParam(externalId: string): string | null {
  const value = externalId.trim();
  if (!value || value.startsWith("linkedin:")) return null;
  if (value.startsWith("urn:li:ugcPost:")) return `(ugc:${encodeURIComponent(value)})`;
  if (value.startsWith("urn:li:share:")) return `(share:${encodeURIComponent(value)})`;
  if (value.startsWith("ugcPost:")) return `(ugc:${encodeURIComponent(`urn:li:${value}`)})`;
  if (value.startsWith("share:")) return `(share:${encodeURIComponent(`urn:li:${value}`)})`;
  if (/^\d+$/.test(value)) return `(share:${encodeURIComponent(`urn:li:share:${value}`)})`;
  return `(share:${encodeURIComponent(value)})`;
}

async function fetchLinkedInAnalyticsMetric(
  env: Env,
  accessToken: string,
  entityParam: string,
  metric: LinkedInAnalyticsMetric,
): Promise<number | null> {
  const analyticsUrl = new URL(LINKEDIN_MEMBER_POST_ANALYTICS_URL);
  analyticsUrl.searchParams.set("q", "entity");
  analyticsUrl.searchParams.set("entity", entityParam);
  analyticsUrl.searchParams.set("queryType", metric);
  analyticsUrl.searchParams.set("aggregation", "TOTAL");

  const response = await fetch(analyticsUrl.toString(), {
    headers: linkedInRestHeaders(env, accessToken),
  });
  const payload = await response.json().catch(() => ({})) as LinkedInAnalyticsResponse;
  if (!response.ok) {
    throw new Error(payload.message || "LinkedIn analytics lookup failed.");
  }
  for (const element of payload.elements ?? []) {
    if (element.metricType === metric || !element.metricType) {
      return parseLinkedInMetricValue(element.count);
    }
  }
  return null;
}

async function fetchLinkedInPostInsights(
  env: Env,
  accessToken: string,
  accountId: number,
  target: { id: number; external_id: string; account_id: number | null },
) {
  const entityParam = linkedInEntityParam(target.external_id);
  if (!entityParam) throw new Error("LinkedIn post ID is not an analytics URN.");

  const metrics = new Map<LinkedInAnalyticsMetric, number | null>();
  const failures: string[] = [];
  await Promise.all(LINKEDIN_ANALYTICS_METRICS.map(async (metric) => {
    try {
      metrics.set(metric, await fetchLinkedInAnalyticsMetric(env, accessToken, entityParam, metric));
    } catch (error) {
      failures.push(linkedInAnalyticsFailureMessage(error));
    }
  }));
  if (metrics.size === 0) {
    throw new Error(failures[0] || "LinkedIn did not return analytics for this post.");
  }

  const reposts = metrics.get("RESHARE") ?? null;
  return {
    platform: "linkedin" as const,
    account_id: target.account_id ?? accountId,
    post_id: target.id,
    external_id: target.external_id,
    views: metrics.get("IMPRESSION") ?? null,
    likes: metrics.get("REACTION") ?? null,
    shares: reposts,
    replies: metrics.get("COMMENT") ?? null,
    reposts,
    quotes: null,
  };
}

export async function listLinkedInPostInsights(env: Env, url: URL, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const requestedAccountId = Number(url.searchParams.get("account_id") || 0) || undefined;
    const requestedLimit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100) || 100, 200));
    const accountFilters = ["platform = 'linkedin'", "status = 'active'"];
    const accountValues: unknown[] = [];
    if (requestedAccountId) {
      accountFilters.push("id = ?");
      accountValues.push(requestedAccountId);
    }
    await appendScopedFilter(env, "social_accounts", accountFilters, accountValues, userId);
    const account = await env.DB.prepare(
      `SELECT id FROM social_accounts WHERE ${accountFilters.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT 1`,
    )
      .bind(...accountValues)
      .first<{ id: number }>();
    if (!account?.id) {
      return jsonResponse({
        data: [],
        status: "not_connected",
        warning: "No active LinkedIn account with official API credentials was found.",
        totals: { posts: 0, synced: 0, views: null, likes: null, shares: null, replies: null, reposts: null, quotes: null },
      });
    }

    const credentials = await readOfficialAccountFields(env, "linkedin", account.id, userId);
    const accessToken = credentials.access_token.trim();
    if (!accessToken || !credentials.user_id.trim()) {
      return jsonResponse({
        data: [],
        status: "not_connected",
        warning: "No active LinkedIn account with official API credentials was found.",
        totals: { posts: 0, synced: 0, views: null, likes: null, shares: null, replies: null, reposts: null, quotes: null },
      });
    }

    const scopeSet = new Set(credentials.scopes.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean));
    if (!scopeSet.has(LINKEDIN_MEMBER_ANALYTICS_SCOPE)) {
      return jsonResponse({
        data: [],
        status: "not_connected",
        warning: "LinkedIn analytics need a separate developer app or product approval for r_member_postAnalytics before this account can sync post metrics.",
        totals: { posts: 0, synced: 0, views: null, likes: null, shares: null, replies: null, reposts: null, quotes: null },
      });
    }

    const postFilters = ["platform = 'linkedin'", "status = 'posted'", "external_id IS NOT NULL", "TRIM(external_id) != ''"];
    const postValues: unknown[] = [];
    if (requestedAccountId) {
      postFilters.push("(account_id = ? OR account_id IS NULL)");
      postValues.push(requestedAccountId);
    }
    await appendScopedFilter(env, "social_posts", postFilters, postValues, userId);
    const rows = await env.DB.prepare(
      `SELECT id, external_id, account_id FROM social_posts WHERE ${postFilters.join(" AND ")} ORDER BY posted_at DESC, updated_at DESC LIMIT ?`,
    )
      .bind(...postValues, requestedLimit)
      .all<{ id: number; external_id: string | null; account_id: number | null }>();
    const targets = (rows.results ?? [])
      .map((row) => ({
        id: row.id,
        external_id: row.external_id?.trim() || "",
        account_id: row.account_id,
      }))
      .filter((row) => row.external_id);

    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          return { insight: await fetchLinkedInPostInsights(env, accessToken, account.id, target), failure: null };
        } catch (error) {
          return {
            insight: null,
            failure: {
              post_id: target.id,
              external_id: target.external_id,
              message: linkedInAnalyticsFailureMessage(error),
            },
          };
        }
      }),
    );
    const insights = results.flatMap((result) => (result.insight ? [result.insight] : []));
    const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
    return jsonResponse({
      data: insights,
      status: "connected",
      warning: failures.length
        ? `Skipped ${failures.length} LinkedIn post${failures.length === 1 ? "" : "s"} because LinkedIn did not return analytics for ${failures.length === 1 ? "it" : "them"}.`
        : undefined,
      failures,
      totals: {
        posts: targets.length,
        synced: insights.length,
        views: sumNullableMetric(insights, "views"),
        likes: sumNullableMetric(insights, "likes"),
        shares: sumNullableMetric(insights, "shares"),
        replies: sumNullableMetric(insights, "replies"),
        reposts: sumNullableMetric(insights, "reposts"),
        quotes: sumNullableMetric(insights, "quotes"),
      },
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to load LinkedIn insights", 500);
  }
}

async function uploadLinkedInImage(env: Env, accessToken: string, owner: string, imageUrl: string): Promise<string> {
  let mediaUrl: URL;
  try {
    mediaUrl = new URL(imageUrl);
  } catch {
    throw new Error("LinkedIn image publishing needs a public image URL.");
  }
  if (mediaUrl.protocol !== "https:" && mediaUrl.protocol !== "http:") {
    throw new Error("LinkedIn image publishing needs a public image URL.");
  }

  const imageResponse = await fetch(mediaUrl.toString());
  if (!imageResponse.ok) throw new Error("Could not download the image for LinkedIn publishing.");
  const contentType = imageResponse.headers.get("content-type") || "application/octet-stream";
  const imageBytes = await imageResponse.arrayBuffer();

  const initResponse = await fetch(LINKEDIN_IMAGES_URL, {
    method: "POST",
    headers: linkedInRestHeaders(env, accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner,
      },
    }),
  });
  const initPayload = await initResponse.json() as {
    value?: { uploadUrl?: string; image?: string };
    message?: string;
  };
  if (!initResponse.ok || !initPayload.value?.uploadUrl || !initPayload.value.image) {
    throw new Error(initPayload.message || "LinkedIn image upload initialization failed.");
  }

  const uploadResponse = await fetch(initPayload.value.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: imageBytes,
  });
  if (!uploadResponse.ok) {
    throw new Error(await uploadResponse.text() || "LinkedIn image upload failed.");
  }
  return initPayload.value.image;
}

export async function updatePublishedLinkedInPost(
  env: Env,
  postId: string,
  payload: Record<string, unknown>,
  scopeId = DEFAULT_USER_ID,
): Promise<Response | null> {
  const id = Number(postId);
  if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);

  const filters = ["id = ?"];
  const values: unknown[] = [id];
  await appendScopedFilter(env, "social_posts", filters, values, scopeId);
  const post = await env.DB.prepare(
    `SELECT id, platform, content, image_url, status, external_id, account_id
     FROM social_posts
     WHERE ${filters.join(" AND ")}`,
  )
    .bind(...values)
    .first<ExtraSocialPostRow & { external_id: string | null }>();
  if (!post || post.platform !== "linkedin" || post.status !== "posted" || !post.external_id?.trim()) return null;

  const mediaKeys = ["image_url", "imageUrl", "imageURL", "image", "photo", "picture", "media", "media_url", "mediaUrl", "media_urls", "mediaUrls", "url"];
  if (mediaKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
    return errorResponse("LinkedIn does not support replacing media on a published post through the edit API. Delete and repost this LinkedIn post to change media.", 400);
  }

  if (typeof payload.content !== "string" || payload.content.trim() === String(post.content ?? "").trim()) {
    return null;
  }

  const account = await resolveExtraAccountForPost(env, post, scopeId);
  if (!account) return errorResponse("No active LinkedIn account is connected.", 400);
  const credentials = await readOfficialAccountFields(env, "linkedin", account.id, scopeId);
  const accessToken = credentials.access_token.trim();
  if (!accessToken) return errorResponse("LinkedIn official API credentials are incomplete.", 400);

  const response = await fetch(`${LINKEDIN_POSTS_URL}/${encodeURIComponent(post.external_id.trim())}`, {
    method: "POST",
    headers: linkedInRestHeaders(env, accessToken, { "X-RestLi-Method": "PARTIAL_UPDATE" }),
    body: JSON.stringify({
      patch: {
        $set: {
          commentary: payload.content.trim(),
        },
      },
    }),
  });
  if (!response.ok) {
    return errorResponse(await response.text() || "LinkedIn post edit failed.", response.status);
  }
  return null;
}

function validateCreatePayload(payload: ExtraSocialAccountPayload, platform: ExtraSocialPlatform): string | null {
  const username = payload.username?.trim().replace(/^@+/, "");
  if (!username) return "Username is required";

  for (const field of REQUIRED_OFFICIAL_FIELDS[platform]) {
    if (!String(payload[field] ?? "").trim()) {
      return `${field.replace(/_/g, " ")} is required`;
    }
  }
  return null;
}

export async function listExtraSocialAccounts(
  env: Env,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const filters = [`platform IN (${EXTRA_SOCIAL_PLATFORMS.map(() => "?").join(", ")})`];
    const values: unknown[] = [...EXTRA_SOCIAL_PLATFORMS];
    await appendScopedFilter(env, "social_accounts", filters, values, scopeId);
    const rows = await env.DB.prepare(
      `SELECT id, platform, username, status, created_at, updated_at
       FROM social_accounts
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC`,
    ).bind(...values).all<{
      id: number;
      platform: ExtraSocialPlatform;
      username: string;
      status: AccountStatus;
      created_at: string;
      updated_at: string;
    }>();

    const results = await Promise.all((rows.results ?? []).map(async (row) => {
      const [credentialsReady, savedPresentation, tags] = await Promise.all([
        storedOfficialCredentialsReady(env, row.platform, row.id, scopeId),
        readAccountPresentationSettings(env, row.id, scopeId),
        readAccountTags(env, "social_account", row.id, scopeId),
      ]);
      const presentation = row.platform === "linkedin" && (!savedPresentation.display_name || !savedPresentation.avatar_url)
        ? await refreshLinkedInAccountPresentation(env, row.id, savedPresentation, scopeId)
        : savedPresentation;
      return {
        ...row,
        ...presentation,
        tags,
        connection_mode: "official_api",
        status: row.status === "active" && credentialsReady
          ? "active"
          : "inactive",
        credentials_ready: credentialsReady ? 1 : 0,
      };
    }));

    return jsonResponse(results);
  } catch {
    return errorResponse("Failed to list social accounts", 500);
  }
}

export async function proxySocialAccountAvatar(
  env: Env,
  accountIdRaw: string,
  scopeId = DEFAULT_USER_ID,
): Promise<Response> {
  const accountId = Number(accountIdRaw);
  if (!Number.isFinite(accountId) || accountId <= 0) return errorResponse("Invalid account ID", 400);

  const filters = ["id = ?"];
  const values: unknown[] = [accountId];
  await appendScopedFilter(env, "social_accounts", filters, values, scopeId);
  const account = await env.DB.prepare(`SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} LIMIT 1`)
    .bind(...values)
    .first<{ id: number }>();
  if (!account) return errorResponse("Social account not found", 404);

  const avatarUrl = (await readSetting(env, `social_account:${accountId}:avatar_url`, scopeId)).trim();
  if (!avatarUrl) return errorResponse("Social account avatar not found", 404);

  let parsed: URL;
  try {
    parsed = new URL(avatarUrl);
  } catch {
    return errorResponse("Social account avatar URL is invalid", 400);
  }
  if (parsed.protocol !== "https:") return errorResponse("Social account avatar URL must use HTTPS", 400);

  const response = await fetch(parsed.toString(), {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Oilor Studio avatar proxy",
    },
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
    return errorResponse("Social account avatar could not be loaded", 502);
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function facebookPictureUrl(picture: FacebookPicture | undefined): string | null {
  const url = picture?.data?.url?.trim();
  return url || null;
}

export async function authorizeFacebookAccount(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<{ tags?: unknown }>(request);
    const config = await facebookOAuthConfig(env, request.url, userId);
    if (!config.appId) {
      return errorResponse(`Facebook OAuth is not configured. Add FACEBOOK_APP_ID or META_APP_ID to the Worker, then add this redirect URL in Meta: ${config.redirectUri}`, 500);
    }

    const state = crypto.randomUUID();
    const now = new Date().toISOString();
    await upsertSetting(env, `facebook_oauth_state:${state}`, JSON.stringify({
      app_id: config.appId,
      redirect_uri: config.redirectUri,
      scopes: config.scopes,
      tags: normalizeAccountTags(payload.tags),
      user_id: ownerId(userId),
      created_at: now,
    }), now, userId);

    const authUrl = new URL(`${FACEBOOK_AUTHORIZE_BASE_URL}/${graphApiVersion()}/dialog/oauth`);
    authUrl.searchParams.set("client_id", config.appId);
    authUrl.searchParams.set("redirect_uri", config.redirectUri);
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);

    return jsonResponse({ auth_url: authUrl.toString() });
  } catch {
    return errorResponse("Failed to start Facebook authorization", 500);
  }
}

export async function handleFacebookOAuthCallback(env: Env, url: URL): Promise<Response> {
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error") || url.searchParams.get("error_message");
    if (oauthError) {
      return new Response(`<html><body><h1>Facebook authorization failed</h1><p>${escapeHtml(oauthError)}</p></body></html>`, {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (!code || !state) {
      return new Response("<html><body><h1>Invalid Facebook OAuth callback</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const stateKey = `facebook_oauth_state:${state}`;
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(stateKey).first<{ value: string }>();
    if (!row?.value) {
      return new Response("<html><body><h1>Facebook OAuth state expired</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const pending = JSON.parse(row.value) as {
      app_id: string;
      redirect_uri: string;
      scopes: string;
      tags?: unknown;
      user_id?: number;
    };
    const pendingUserId = ownerId(pending.user_id);
    const config = await facebookOAuthConfig(env, url.toString(), pendingUserId);

    if (!config.appSecret) {
      return new Response("<html><body><h1>Facebook OAuth is not configured</h1><p>FACEBOOK_APP_SECRET, META_APP_SECRET, or INSTAGRAM_APP_SECRET is missing on the Worker, so the authorization code cannot be exchanged yet.</p></body></html>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const tokenUrl = new URL(`${FACEBOOK_GRAPH_BASE_URL}/${graphApiVersion()}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", pending.app_id || config.appId);
    tokenUrl.searchParams.set("client_secret", config.appSecret);
    tokenUrl.searchParams.set("redirect_uri", pending.redirect_uri || config.redirectUri);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await fetch(tokenUrl.toString());
    const tokenPayload = await tokenResponse.json() as FacebookTokenResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return new Response(`<html><body><h1>Facebook token exchange failed</h1><p>${escapeHtml(facebookPayloadError(tokenPayload) || "No access token returned.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const longTokenUrl = new URL(`${FACEBOOK_GRAPH_BASE_URL}/${graphApiVersion()}/oauth/access_token`);
    longTokenUrl.searchParams.set("grant_type", "fb_exchange_token");
    longTokenUrl.searchParams.set("client_id", pending.app_id || config.appId);
    longTokenUrl.searchParams.set("client_secret", config.appSecret);
    longTokenUrl.searchParams.set("fb_exchange_token", tokenPayload.access_token);
    const longTokenResponse = await fetch(longTokenUrl.toString());
    const longTokenPayload = await longTokenResponse.json() as FacebookTokenResponse;
    const userAccessToken = longTokenPayload.access_token || tokenPayload.access_token;
    const expiresIn = longTokenPayload.expires_in || tokenPayload.expires_in;
    if (!longTokenResponse.ok && !userAccessToken) {
      return new Response(`<html><body><h1>Facebook long-lived token exchange failed</h1><p>${escapeHtml(facebookPayloadError(longTokenPayload) || "No access token returned.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const profileUrl = new URL(`${FACEBOOK_GRAPH_BASE_URL}/${graphApiVersion()}/me`);
    profileUrl.searchParams.set("fields", "id,name,picture.type(large)");
    profileUrl.searchParams.set("access_token", userAccessToken);
    const profileResponse = await fetch(profileUrl.toString());
    const profile = await profileResponse.json() as FacebookProfileResponse;
    if (!profileResponse.ok || !profile.id) {
      return new Response(`<html><body><h1>Facebook profile lookup failed</h1><p>${escapeHtml(facebookPayloadError(profile) || "Could not load Facebook profile.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const pagesUrl = new URL(`${FACEBOOK_GRAPH_BASE_URL}/${graphApiVersion()}/me/accounts`);
    pagesUrl.searchParams.set("fields", "id,name,access_token,picture.type(large)");
    pagesUrl.searchParams.set("limit", "100");
    pagesUrl.searchParams.set("access_token", userAccessToken);
    const pagesResponse = await fetch(pagesUrl.toString());
    const pagesPayload = await pagesResponse.json() as FacebookAccountsResponse;
    const pages = pagesResponse.ok
      ? (pagesPayload.data ?? []).filter((page) => page.id?.trim() && page.access_token?.trim())
      : [];

    const targets = pages.length > 0
      ? pages.map((page) => ({
        username: page.name || page.id || "Facebook Page",
        displayName: page.name || null,
        avatarUrl: facebookPictureUrl(page.picture),
        accessToken: page.access_token!,
        facebookUserId: profile.id!,
        facebookPageId: page.id!,
        accountType: "page" as const,
      }))
      : [{
        username: profile.name || profile.id,
        displayName: profile.name || null,
        avatarUrl: facebookPictureUrl(profile.picture),
        accessToken: userAccessToken,
        facebookUserId: profile.id,
        facebookPageId: null,
        accountType: "profile" as const,
      }];

    const accountIds: number[] = [];
    const tags = normalizeAccountTags(pending.tags);
    const now = new Date().toISOString();
    for (const target of targets) {
      const accountId = await upsertFacebookOAuthAccount(env, {
        ...target,
        appId: pending.app_id || config.appId,
        redirectUri: pending.redirect_uri || config.redirectUri,
        scopes: pending.scopes || config.scopes,
        expiresIn,
      }, pendingUserId);
      accountIds.push(accountId);
      if (tags.length > 0) {
        await upsertAccountTags(env, "social_account", accountId, tags, now, pendingUserId);
      }
    }
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(stateKey).run();

    return new Response(
      `<html>
        <head><title>Facebook connected</title></head>
        <body>
          <h1>Facebook account connected</h1>
          <p>You can return to the dashboard now.</p>
          <script>
            const payload = { type: "facebook_connected", ok: true, account_ids: ${JSON.stringify(accountIds)} };
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
  } catch (error) {
    return new Response(
      `<html><body><h1>Error processing Facebook OAuth callback</h1><p>${escapeHtml(error instanceof Error ? error.message : "Unknown error")}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }
}

export async function authorizeInstagramAccount(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<{ tags?: unknown }>(request);
    const config = await instagramOAuthConfig(env, request.url, userId);
    const missingParts = [
      !config.appId ? "INSTAGRAM_APP_ID" : "",
    ].filter(Boolean);
    if (missingParts.length > 0) {
      return errorResponse(`Instagram OAuth is not configured. Missing ${missingParts.join(" and ")} on the Worker, and no stored Instagram app credentials were found.`, 500);
    }

    const state = crypto.randomUUID();
    const now = new Date().toISOString();
    await upsertSetting(env, `instagram_oauth_state:${state}`, JSON.stringify({
      app_id: config.appId,
      redirect_uri: config.redirectUri,
      scopes: config.scopes,
      tags: normalizeAccountTags(payload.tags),
      user_id: ownerId(userId),
      created_at: now,
    }), now, userId);

    const authUrl = new URL(INSTAGRAM_AUTHORIZE_URL);
    authUrl.searchParams.set("client_id", config.appId);
    authUrl.searchParams.set("redirect_uri", config.redirectUri);
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("enable_fb_login", "true");
    authUrl.searchParams.set("state", state);

    return jsonResponse({ auth_url: authUrl.toString() });
  } catch {
    return errorResponse("Failed to start Instagram authorization", 500);
  }
}

export async function handleInstagramOAuthCallback(env: Env, url: URL): Promise<Response> {
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error") || url.searchParams.get("error_message");
    if (oauthError) {
      return new Response(`<html><body><h1>Instagram authorization failed</h1><p>${escapeHtml(oauthError)}</p></body></html>`, {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (!code || !state) {
      return new Response("<html><body><h1>Invalid Instagram OAuth callback</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const stateKey = `instagram_oauth_state:${state}`;
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(stateKey).first<{ value: string }>();
    if (!row?.value) {
      return new Response("<html><body><h1>Instagram OAuth state expired</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const pending = JSON.parse(row.value) as {
      app_id: string;
      redirect_uri: string;
      scopes: string;
      tags?: unknown;
      user_id?: number;
    };
    const pendingUserId = ownerId(pending.user_id);
    const config = await instagramOAuthConfig(env, url.toString(), pendingUserId);

    if (!config.appSecret) {
      return new Response("<html><body><h1>Instagram OAuth is not configured</h1><p>INSTAGRAM_APP_SECRET is missing on the Worker, so the authorization code cannot be exchanged for an access token yet.</p></body></html>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const normalizedCode = code.replace(/#_$/, "");
    const tokenBody = new FormData();
    tokenBody.set("client_id", pending.app_id || config.appId);
    tokenBody.set("client_secret", config.appSecret);
    tokenBody.set("grant_type", "authorization_code");
    tokenBody.set("redirect_uri", pending.redirect_uri || config.redirectUri);
    tokenBody.set("code", normalizedCode);
    const tokenResponse = await fetch(INSTAGRAM_TOKEN_URL, {
      method: "POST",
      body: tokenBody,
    });
    const rawTokenPayload = await tokenResponse.json() as InstagramTokenResponse;
    const tokenPayload = normalizeInstagramTokenResponse(rawTokenPayload);
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return new Response(`<html><body><h1>Instagram token exchange failed</h1><p>${escapeHtml(instagramPayloadError(tokenPayload) || "No access token returned.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const longTokenUrl = new URL(`${INSTAGRAM_GRAPH_BASE_URL}/access_token`);
    longTokenUrl.searchParams.set("grant_type", "ig_exchange_token");
    longTokenUrl.searchParams.set("client_secret", config.appSecret);
    longTokenUrl.searchParams.set("access_token", tokenPayload.access_token);
    const longTokenResponse = await fetch(longTokenUrl.toString());
    const longTokenPayload = await longTokenResponse.json() as InstagramTokenResponse;
    const userAccessToken = longTokenPayload.access_token || tokenPayload.access_token;
    if (!longTokenResponse.ok && !userAccessToken) {
      return new Response(`<html><body><h1>Instagram long-lived token exchange failed</h1><p>${escapeHtml(instagramPayloadError(longTokenPayload) || "No access token returned.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const profileUrl = new URL(`${INSTAGRAM_GRAPH_BASE_URL}/${graphApiVersion()}/me`);
    profileUrl.searchParams.set("fields", "id,user_id,username,name,account_type,profile_picture_url");
    profileUrl.searchParams.set("access_token", userAccessToken);
    const profileResponse = await fetch(profileUrl.toString());
    const rawProfilePayload = await profileResponse.json() as InstagramProfileResponse;
    const profilePayload = normalizeInstagramProfileResponse(rawProfilePayload);
    if (!profileResponse.ok) {
      return new Response(`<html><body><h1>Instagram account lookup failed</h1><p>${escapeHtml(instagramPayloadError(profilePayload) || "Could not load Instagram profile.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const instagramUserId = profilePayload.user_id?.trim() || profilePayload.id?.trim() || "";
    const instagramProfileId = profilePayload.id?.trim() || tokenPayload.user_id?.trim() || "";
    if (!instagramUserId || !userAccessToken) {
      return new Response(
        "<html><body><h1>No Instagram professional account found</h1><p>Complete Instagram business login with a Business or Creator account, then try again.</p></body></html>",
        { status: 400, headers: { "Content-Type": "text/html" } },
      );
    }

    const accountId = await upsertInstagramOAuthAccount(env, {
      username: profilePayload.username || instagramUserId,
      displayName: profilePayload.name || profilePayload.username || instagramUserId,
      accessToken: userAccessToken,
      instagramUserId,
      instagramProfileId,
      appId: pending.app_id || config.appId,
      redirectUri: pending.redirect_uri || config.redirectUri,
      scopes: pending.scopes || config.scopes,
      userAccessToken,
      expiresIn: longTokenPayload.expires_in,
      avatarUrl: profilePayload.profile_picture_url,
    }, pendingUserId);
    const tags = normalizeAccountTags(pending.tags);
    if (tags.length > 0) {
      await upsertAccountTags(env, "social_account", accountId, tags, new Date().toISOString(), pendingUserId);
    }
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(stateKey).run();

    return new Response(
      `<html>
        <head><title>Instagram connected</title></head>
        <body>
          <h1>Instagram account connected</h1>
          <p>You can return to the dashboard now.</p>
          <script>
            const payload = { type: "instagram_connected", ok: true, account_id: ${JSON.stringify(accountId)} };
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
  } catch (error) {
    return new Response(
      `<html><body><h1>Error processing Instagram OAuth callback</h1><p>${escapeHtml(error instanceof Error ? error.message : "Unknown error")}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }
}

function extractSocialAccountIdFromSettingKey(key: string): number | null {
  const match = /^social_account:(\d+):/.exec(key);
  if (!match) return null;
  const accountId = Number(match[1]);
  return Number.isInteger(accountId) && accountId > 0 ? accountId : null;
}

async function findInstagramAccountIdsForMetaIdentifiers(env: Env, identifiers: string[]): Promise<number[]> {
  const normalized = new Set(identifiers.map((value) => value.trim()).filter(Boolean));
  if (normalized.size === 0) return [];

  const rows = await env.DB.prepare(
    `SELECT key, value
       FROM app_settings
      WHERE key LIKE 'social_account:%:instagram_facebook_user_id'
         OR key LIKE 'social_account:%:instagram_profile_id'
         OR key LIKE 'social_account:%:instagram_user_id'
         OR key LIKE 'social_account:%:instagram_page_id'`,
  ).all<{ key: string; value: string }>();

  const accountIds = new Set<number>();
  for (const row of rows.results ?? []) {
    if (!normalized.has(String(row.value ?? "").trim())) continue;
    const accountId = extractSocialAccountIdFromSettingKey(row.key);
    if (accountId) accountIds.add(accountId);
  }
  return [...accountIds];
}

async function removeSocialAccounts(env: Env, accountIds: number[]): Promise<void> {
  if (accountIds.length === 0) return;
  const uniqueAccountIds = [...new Set(accountIds)];
  await Promise.all(uniqueAccountIds.flatMap((accountId) => [
    env.DB.prepare("DELETE FROM social_accounts WHERE id = ?").bind(accountId).run(),
    env.DB.prepare("DELETE FROM app_settings WHERE key LIKE ?").bind(`social_account:${accountId}:%`).run(),
  ]));
}

function metaDeletionStatusUrl(requestUrl: string, confirmationCode: string): string {
  const url = new URL("/legal/data-deletion", requestUrl);
  url.searchParams.set("confirmation_code", confirmationCode);
  return url.toString();
}

export async function handleMetaDeauthorizeCallback(env: Env, request: Request): Promise<Response> {
  try {
    const appSecret = env.INSTAGRAM_APP_SECRET?.trim() || env.META_APP_SECRET?.trim();
    if (!appSecret) {
      return errorResponse("INSTAGRAM_APP_SECRET is not configured.", 500);
    }

    const formData = await request.formData();
    const signedRequest = String(formData.get("signed_request") ?? "").trim();
    if (!signedRequest) {
      return errorResponse("Missing signed_request.", 400);
    }

    const payload = await parseMetaSignedRequest(signedRequest, appSecret);
    const accountIds = await findInstagramAccountIdsForMetaIdentifiers(env, [
      String(payload.user_id ?? ""),
      String(payload.profile_id ?? ""),
    ]);
    await removeSocialAccounts(env, accountIds);

    return jsonResponse({ ok: true, disconnected_accounts: accountIds.length });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Invalid deauthorize request.", 400);
  }
}

export async function handleMetaDataDeletionRequest(env: Env, request: Request): Promise<Response> {
  try {
    const appSecret = env.INSTAGRAM_APP_SECRET?.trim() || env.META_APP_SECRET?.trim();
    if (!appSecret) {
      return errorResponse("INSTAGRAM_APP_SECRET is not configured.", 500);
    }

    const formData = await request.formData();
    const signedRequest = String(formData.get("signed_request") ?? "").trim();
    if (!signedRequest) {
      return errorResponse("Missing signed_request.", 400);
    }

    const payload = await parseMetaSignedRequest(signedRequest, appSecret);
    const accountIds = await findInstagramAccountIdsForMetaIdentifiers(env, [
      String(payload.user_id ?? ""),
      String(payload.profile_id ?? ""),
    ]);
    await removeSocialAccounts(env, accountIds);

    const confirmationCode = crypto.randomUUID();
    return jsonResponse({
      url: metaDeletionStatusUrl(request.url, confirmationCode),
      confirmation_code: confirmationCode,
      disconnected_accounts: accountIds.length,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Invalid data deletion request.", 400);
  }
}

export async function authorizeLinkedInAccount(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<{ tags?: unknown }>(request);
    const config = await linkedInOAuthConfig(env, request.url, userId);
    const missingParts = [
      !config.clientId ? "LINKEDIN_CLIENT_ID" : "",
      !config.clientSecret ? "LINKEDIN_CLIENT_SECRET" : "",
    ].filter(Boolean);
    if (missingParts.length > 0) {
      return errorResponse(
        `LinkedIn OAuth is not configured. Missing ${missingParts.join(" and ")} on the Worker, and no stored LinkedIn app credentials were found. Add this redirect URL in the LinkedIn Developer app: ${config.redirectUri}`,
        500,
      );
    }

    const state = crypto.randomUUID();
    const now = new Date().toISOString();
    await upsertSetting(env, `linkedin_oauth_state:${state}`, JSON.stringify({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scopes: config.scopes,
      tags: normalizeAccountTags(payload.tags),
      user_id: ownerId(userId),
      created_at: now,
    }), now, userId);

    const authUrl = new URL(LINKEDIN_AUTHORIZE_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", config.redirectUri);
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("state", state);

    return jsonResponse({ auth_url: authUrl.toString() });
  } catch {
    return errorResponse("Failed to start LinkedIn authorization", 500);
  }
}

export async function handleLinkedInOAuthCallback(env: Env, url: URL): Promise<Response> {
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error") || url.searchParams.get("error_description");
    if (oauthError) {
      return new Response(`<html><body><h1>LinkedIn authorization failed</h1><p>${escapeHtml(oauthError)}</p></body></html>`, {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (!code || !state) {
      return new Response("<html><body><h1>Invalid LinkedIn OAuth callback</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const stateKey = `linkedin_oauth_state:${state}`;
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(stateKey).first<{ value: string }>();
    if (!row?.value) {
      return new Response("<html><body><h1>LinkedIn OAuth state expired</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const pending = JSON.parse(row.value) as {
      client_id: string;
      redirect_uri: string;
      scopes: string;
      tags?: unknown;
      user_id?: number;
    };
    const pendingUserId = ownerId(pending.user_id);
    const config = await linkedInOAuthConfig(env, url.toString(), pendingUserId);

    const tokenResponse = await fetch(LINKEDIN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: pending.redirect_uri || config.redirectUri,
        client_id: pending.client_id || config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
    });
    const tokenPayload = await tokenResponse.json() as LinkedInTokenResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return new Response(`<html><body><h1>LinkedIn token exchange failed</h1><p>${escapeHtml(tokenPayload.error_description || tokenPayload.error || "No access token returned.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const profileResponse = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const profile = await profileResponse.json() as LinkedInUserInfo & { message?: string };
    if (!profileResponse.ok || !profile.sub) {
      return new Response(
        `<html><body><h1>LinkedIn profile lookup failed</h1><p>${escapeHtml(profile.message || "The LinkedIn app needs the openid and profile scopes so the dashboard can resolve the author URN.")}</p></body></html>`,
        { status: 500, headers: { "Content-Type": "text/html" } },
      );
    }

    const accountId = await upsertLinkedInOAuthAccount(env, {
      username: profile.name || profile.email || profile.sub,
      displayName: profile.name || null,
      avatarUrl: profile.picture || null,
      accessToken: tokenPayload.access_token,
      authorUrn: `urn:li:person:${profile.sub}`,
      clientId: pending.client_id || config.clientId,
      redirectUri: pending.redirect_uri || config.redirectUri,
      scopes: tokenPayload.scope || pending.scopes || config.scopes,
      expiresIn: tokenPayload.expires_in,
    }, pendingUserId);
    const tags = normalizeAccountTags(pending.tags);
    if (tags.length > 0) {
      await upsertAccountTags(env, "social_account", accountId, tags, new Date().toISOString(), pendingUserId);
    }
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(stateKey).run();

    return new Response(
      `<html>
        <head><title>LinkedIn connected</title></head>
        <body>
          <h1>LinkedIn account connected</h1>
          <p>You can return to the dashboard now.</p>
          <script>
            const payload = { type: "linkedin_connected", ok: true, account_id: ${JSON.stringify(accountId)} };
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
  } catch (error) {
    return new Response(
      `<html><body><h1>Error processing LinkedIn OAuth callback</h1><p>${escapeHtml(error instanceof Error ? error.message : "Unknown error")}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }
}

export async function listInternalExtraSocialAccounts(env: Env, scopeId = DEFAULT_USER_ID) {
  const rows = await env.DB.prepare(
    `SELECT id, platform, username, status, created_at, updated_at
     FROM social_accounts
     WHERE platform IN (${EXTRA_SOCIAL_PLATFORMS.map(() => "?").join(", ")})
     ORDER BY created_at DESC`,
  ).bind(...EXTRA_SOCIAL_PLATFORMS).all<{
    id: number;
    platform: ExtraSocialPlatform;
    username: string;
    status: AccountStatus;
    created_at: string;
    updated_at: string;
  }>();

  return Promise.all((rows.results ?? []).map(async (row) => {
    const [officialReady, savedPresentation, tags] = await Promise.all([
      storedOfficialCredentialsReady(env, row.platform, row.id, scopeId),
      readAccountPresentationSettings(env, row.id, scopeId),
      readAccountTags(env, "social_account", row.id, scopeId),
    ]);
    const presentation = row.platform === "linkedin" && (!savedPresentation.display_name || !savedPresentation.avatar_url)
      ? await refreshLinkedInAccountPresentation(env, row.id, savedPresentation, scopeId)
      : savedPresentation;
    return {
      ...row,
      ...presentation,
      tags,
      connection_mode: "official_api",
      credentials_ready: officialReady,
    };
  }));
}

export async function addExtraSocialAccount(
  env: Env,
  request: Request,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const payload = await parseJson<ExtraSocialAccountPayload>(request);
    const platform = String(payload.platform ?? "").trim().toLowerCase();
    if (!isExtraSocialPlatform(platform)) return errorResponse("Unsupported social platform", 400);

    const connectionMode: AccountConnectionMode = "official_api";
    const validationError = validateCreatePayload(payload, platform);
    if (validationError) return errorResponse(validationError, 400);

    const username = payload.username!.trim().replace(/^@+/, "");
    const status: AccountStatus = payload.status === "inactive" ? "inactive" : "active";
    const now = new Date().toISOString();
    const scoped = await scopedInsertColumns(env, "social_accounts", scopeId);
    const result = await env.DB.prepare(
      `INSERT INTO social_accounts (${[...scoped.columns, "platform", "username", "status", "created_at", "updated_at"].join(", ")})
       VALUES (${[...scoped.columns.map(() => "?"), "?", "?", "?", "?", "?"].join(", ")})`,
    )
      .bind(...scoped.values, platform, username, status, now, now)
      .run() as { meta: { last_row_id: number } };

    const accountId = result.meta.last_row_id;
    await upsertSetting(env, `social_account:${accountId}:connection_mode`, connectionMode, now, scopeId);
    const tags = await upsertAccountTags(env, "social_account", accountId, payload.tags, now, scopeId);

    await Promise.all(Object.entries(OFFICIAL_FIELD_SETTINGS[platform]).flatMap(([field, settingKey]) => {
      const value = String(payload[field as FieldName] ?? "").trim();
      return value ? [upsertSetting(env, `social_account:${accountId}:${settingKey}`, value, now, scopeId)] : [];
    }));

    return jsonResponse({
      id: accountId,
      platform,
      username,
      status,
      tags,
      connection_mode: connectionMode,
      credentials_ready: 1,
      created_at: now,
      updated_at: now,
    }, { status: 201 });
  } catch {
    return errorResponse("Failed to add social account", 500);
  }
}

export async function updateExtraSocialAccount(
  env: Env,
  accountId: string,
  request: Request,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(accountId);
    if (Number.isNaN(id)) return errorResponse("Invalid account ID", 400);

    const filters = [`platform IN (${EXTRA_SOCIAL_PLATFORMS.map(() => "?").join(", ")})`, "id = ?"];
    const filterValues: unknown[] = [...EXTRA_SOCIAL_PLATFORMS, id];
    await appendScopedFilter(env, "social_accounts", filters, filterValues, scopeId);
    const existing = await env.DB.prepare(`SELECT id, platform FROM social_accounts WHERE ${filters.join(" AND ")}`)
      .bind(...filterValues)
      .first<{ id: number; platform: ExtraSocialPlatform }>();
    if (!existing) return errorResponse("Social account not found", 404);

    const payload = await parseJson<ExtraSocialAccountPayload>(request);
    const now = new Date().toISOString();
    const accountUpdates: string[] = [];
    const accountValues: unknown[] = [];

    if (payload.username !== undefined) {
      const username = payload.username.trim().replace(/^@+/, "");
      if (!username) return errorResponse("Username is required", 400);
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

    const updates = [];
    if (payload.connection_mode) {
      updates.push(upsertSetting(env, `social_account:${id}:connection_mode`, "official_api", now, scopeId));
    }

    for (const [field, settingKey] of Object.entries(OFFICIAL_FIELD_SETTINGS[existing.platform])) {
      const value = String(payload[field as FieldName] ?? "").trim();
      if (!value) continue;
      updates.push(upsertSetting(env, `social_account:${id}:${settingKey}`, value, now, scopeId));
    }
    if (payload.tags !== undefined) {
      updates.push(upsertAccountTags(env, "social_account", id, payload.tags, now, scopeId));
    }

    if (updates.length === 0 && accountUpdates.length === 0) {
      return errorResponse("No account fields to update", 400);
    }

    await Promise.all(updates);
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update social account", 500);
  }
}

export async function updateSocialAccountTags(
  env: Env,
  accountId: string,
  request: Request,
  scopeId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(accountId);
    if (!Number.isFinite(id) || id <= 0) return errorResponse("Invalid account ID", 400);

    const payload = await parseJson<{ platform?: string; tags?: unknown }>(request);
    const platform = String(payload.platform ?? "").trim().toLowerCase();
    const tags = normalizeAccountTags(payload.tags);
    const now = new Date().toISOString();

    if (platform === "reddit") {
      const filters = ["id = ?"];
      const values: unknown[] = [id];
      await appendScopedFilter(env, "reddit_accounts", filters, values, scopeId);
      const existing = await env.DB.prepare(`SELECT id FROM reddit_accounts WHERE ${filters.join(" AND ")} LIMIT 1`)
        .bind(...values)
        .first<{ id: number }>();
      if (!existing) return errorResponse("Reddit account not found", 404);
      await Promise.all([
        upsertAccountTags(env, "reddit_account", id, tags, now, scopeId),
        env.DB.prepare(`UPDATE reddit_accounts SET updated_at = ? WHERE ${filters.join(" AND ")}`)
          .bind(now, ...values)
          .run(),
      ]);
      return jsonResponse({ success: true, tags, updated_at: now });
    }

    const filters = ["id = ?"];
    const values: unknown[] = [id];
    if (platform) {
      filters.push("platform = ?");
      values.push(platform);
    }
    await appendScopedFilter(env, "social_accounts", filters, values, scopeId);
    const existing = await env.DB.prepare(`SELECT id FROM social_accounts WHERE ${filters.join(" AND ")} LIMIT 1`)
      .bind(...values)
      .first<{ id: number }>();
    if (!existing) return errorResponse("Social account not found", 404);

    await Promise.all([
      upsertAccountTags(env, "social_account", id, tags, now, scopeId),
      env.DB.prepare(`UPDATE social_accounts SET updated_at = ? WHERE ${filters.join(" AND ")}`)
        .bind(now, ...values)
        .run(),
    ]);
    return jsonResponse({ success: true, tags, updated_at: now });
  } catch {
    return errorResponse("Failed to update account tags", 500);
  }
}

export async function deleteExtraSocialAccount(env: Env, accountId: string, scopeId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(accountId);
    if (Number.isNaN(id)) return errorResponse("Invalid account ID", 400);
    const filters = [`platform IN (${EXTRA_SOCIAL_PLATFORMS.map(() => "?").join(", ")})`, "id = ?"];
    const values: unknown[] = [...EXTRA_SOCIAL_PLATFORMS, id];
    await appendScopedFilter(env, "social_accounts", filters, values, scopeId);
    await env.DB.prepare(`DELETE FROM social_accounts WHERE ${filters.join(" AND ")}`).bind(...values).run();

    const settingsHasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
    const settingsHasUserId = await tableHasUserId(env, "app_settings");
    await env.DB.prepare(settingsHasWorkspaceId
      ? "DELETE FROM app_settings WHERE workspace_id = ? AND key LIKE ?"
      : settingsHasUserId
      ? "DELETE FROM app_settings WHERE user_id = ? AND key LIKE ?"
      : "DELETE FROM app_settings WHERE key LIKE ?")
      .bind(...(settingsHasWorkspaceId ? [workspaceId(scopeId), `social_account:${id}:%`] : settingsHasUserId ? [ownerId(scopeId), `social_account:${id}:%`] : [`social_account:${id}:%`]))
      .run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete social account", 500);
  }
}

export async function publishExtraSocialPost(
  env: Env,
  postId: string,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  const id = Number(postId);
  if (Number.isNaN(id)) return errorResponse("Invalid post ID", 400);
  let publishedExternalId: string | null = null;

  try {
    const filters = ["id = ?", `platform IN (${EXTRA_SOCIAL_PLATFORMS.map(() => "?").join(", ")})`];
    const values: unknown[] = [id, ...EXTRA_SOCIAL_PLATFORMS];
    await appendScopedFilter(env, "social_posts", filters, values, scopeId);
    const post = await env.DB.prepare(
      `SELECT id, platform, content, image_url, status, external_id, account_id
       FROM social_posts
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(...values)
      .first<ExtraSocialPostRow & { external_id: string | null }>();
    if (!post) return errorResponse("Social post not found", 404);
    if (post.status === "posted" && post.external_id?.trim()) {
      return jsonResponse({ success: true, external_id: post.external_id.trim(), already_posted: true, account_id: post.account_id });
    }
    if (post.status === "posted") return errorResponse("Post is already published", 400);

    const account = await resolveExtraAccountForPost(env, post, scopeId);
    if (!account) return errorResponse(`No active ${post.platform} account is connected.`, 400);

    const now = new Date().toISOString();
    const claim = await claimSocialPostForPublishing(env, filters, values, now);
    if (claim.status === "already_posted") {
      return jsonResponse({ success: true, external_id: claim.externalId, already_posted: true, account_id: claim.accountId });
    }
    if (claim.status === "in_progress") return errorResponse("Post is already publishing.", 409);
    if (claim.status !== "claimed") return errorResponse(claim.message, 400);

    let externalId = "";
    if (post.platform === "instagram") {
      externalId = await publishInstagramOfficial(env, post, account.id, scopeId);
    } else if (post.platform === "linkedin") {
      externalId = await publishLinkedInOfficial(env, post, account.id, scopeId);
    } else if (post.platform === "facebook") {
      return errorResponse("Facebook official API publishing is not implemented yet.", 501);
    } else {
      return errorResponse("YouTube official API publishing is not implemented yet.", 501);
    }
    publishedExternalId = externalId;

    const lastErrorAssignment = await socialPostsHaveLastError(env) ? ", last_error = NULL" : "";
    await env.DB.prepare(
      `UPDATE social_posts
       SET status = 'posted', posted_at = ?, external_id = ?, account_id = ?, updated_at = ?${lastErrorAssignment}
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(now, externalId, account.id, now, ...values)
      .run();
    try {
      await markLinkedPlannerItemsPublished(env, id, now);
    } catch (plannerError) {
      console.error(`Failed to mark linked planner items published for ${post.platform} post:`, plannerError);
    }
    return jsonResponse({ success: true, external_id: externalId, posted_at: now, account_id: account.id });
  } catch (error) {
    const message = socialPublishErrorMessage(error, "Failed to publish social post");
    if (publishedExternalId) {
      console.error("Social post published externally but dashboard sync failed:", error);
      const now = new Date().toISOString();
      const filters = ["id = ?"];
      const values: unknown[] = [id];
      await appendScopedFilter(env, "social_posts", filters, values, scopeId);
      const lastErrorAssignment = await socialPostsHaveLastError(env) ? ", last_error = NULL" : "";
      await env.DB.prepare(
        `UPDATE social_posts SET status = 'posted', posted_at = COALESCE(posted_at, ?), external_id = ?, updated_at = ?${lastErrorAssignment} WHERE ${filters.join(" AND ")}`,
      )
        .bind(now, publishedExternalId, now, ...values)
        .run()
        .catch((syncError) => console.error("Failed to repair external published social post state:", syncError));
      return errorResponse("The platform published externally, but the dashboard could not finish syncing the published state. Refresh before retrying to avoid a duplicate.", 502);
    }
    const now = new Date().toISOString();
    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "social_posts", filters, values, scopeId);
    await markSocialPostsFailed(env, filters, values, now, message);
    return errorResponse(message, 500);
  }
}
