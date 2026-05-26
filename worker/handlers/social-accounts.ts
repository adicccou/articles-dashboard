import type { Env } from "../lib/types";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { DEFAULT_USER_ID, appendScopedFilter, ownerId, scopedInsertColumns, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import { markLinkedPlannerItemsPublished } from "../lib/social-publish";

type ExtraSocialPlatform = "linkedin" | "instagram" | "youtube";
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
};

type InstagramPageConnection = {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
  } | null;
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

const EXTRA_SOCIAL_PLATFORMS: ExtraSocialPlatform[] = ["linkedin", "instagram", "youtube"];
const DEFAULT_INSTAGRAM_OAUTH_SCOPES = [
  "pages_show_list",
  "instagram_basic",
  "instagram_content_publish",
  "pages_read_engagement",
].join(",");

const OFFICIAL_FIELD_SETTINGS: Record<ExtraSocialPlatform, Record<FieldName, string>> = {
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
  linkedin: ["client_id", "client_secret", "redirect_uri", "scopes", "access_token", "user_id"],
  instagram: ["access_token", "user_id", "page_id"],
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
  return "v20.0";
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

async function instagramOAuthConfig(env: Env, requestUrl: string, userId = DEFAULT_USER_ID) {
  const requestOrigin = new URL(requestUrl).origin;
  const stored = await readStoredInstagramOAuthConfig(env, userId);
  return {
    appId: env.META_APP_ID?.trim() || stored?.appId || "",
    appSecret: env.META_APP_SECRET?.trim() || stored?.appSecret || "",
    redirectUri: env.INSTAGRAM_REDIRECT_URI?.trim() || stored?.redirectUri || `${requestOrigin}/api/instagram/auth/callback`,
    scopes: env.INSTAGRAM_OAUTH_SCOPES?.trim() || stored?.scopes || DEFAULT_INSTAGRAM_OAUTH_SCOPES,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mediaUrls(raw: string | null): string[] {
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

async function upsertInstagramOAuthAccount(
  env: Env,
  account: {
    username: string;
    displayName?: string;
    accessToken: string;
    instagramUserId: string;
    pageId: string;
    appId: string;
    redirectUri: string;
    scopes: string;
    userAccessToken: string;
    expiresIn?: number;
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
    upsertSetting(env, `social_account:${accountId}:instagram_page_id`, account.pageId, now, scopeId),
    upsertSetting(env, `social_account:${accountId}:instagram_user_access_token`, account.userAccessToken, now, scopeId),
    ...(account.displayName?.trim()
      ? [upsertSetting(env, `social_account:${accountId}:display_name`, account.displayName.trim(), now, scopeId)]
      : []),
    ...(expiresAt ? [upsertSetting(env, `social_account:${accountId}:instagram_user_token_expires_at`, expiresAt, now, scopeId)] : []),
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

  const createMediaContainer = async (body: URLSearchParams) => {
    const mediaResponse = await fetch(`https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(instagramUserId)}/media`, {
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
  } else {
    const childIds = await Promise.all(images.map((imageUrl) => createMediaContainer(new URLSearchParams({
      image_url: imageUrl,
      is_carousel_item: "true",
      access_token: accessToken,
    }))));
    creationId = await createMediaContainer(new URLSearchParams({
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: post.content?.trim() ?? "",
      access_token: accessToken,
    }));
  }

  const publishBody = new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken,
  });
  const publishResponse = await fetch(`https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(instagramUserId)}/media_publish`, {
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
  if (!accessToken || !author) throw new Error("LinkedIn official API credentials are incomplete.");
  if (!text) throw new Error("LinkedIn official API publishing needs post text.");

  const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    }),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText || "LinkedIn publish failed.");
  }
  return response.headers.get("x-restli-id") || responseText || `linkedin:${Date.now()}`;
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
      const [credentialsReady, presentation] = await Promise.all([
        storedOfficialCredentialsReady(env, row.platform, row.id, scopeId),
        readAccountPresentationSettings(env, row.id, scopeId),
      ]);
      return {
        ...row,
        ...presentation,
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

export async function authorizeInstagramAccount(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const config = await instagramOAuthConfig(env, request.url, userId);
    const missingParts = [
      !config.appId ? "META_APP_ID" : "",
      !config.appSecret ? "META_APP_SECRET" : "",
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
      user_id: ownerId(userId),
      created_at: now,
    }), now, userId);

    const authUrl = new URL(`https://www.facebook.com/${graphApiVersion()}/dialog/oauth`);
    authUrl.searchParams.set("client_id", config.appId);
    authUrl.searchParams.set("redirect_uri", config.redirectUri);
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("response_type", "code");
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
      user_id?: number;
    };
    const pendingUserId = ownerId(pending.user_id);
    const config = await instagramOAuthConfig(env, url.toString(), pendingUserId);

    const tokenUrl = new URL(`https://graph.facebook.com/${graphApiVersion()}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", pending.app_id || config.appId);
    tokenUrl.searchParams.set("client_secret", config.appSecret);
    tokenUrl.searchParams.set("redirect_uri", pending.redirect_uri || config.redirectUri);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await fetch(tokenUrl.toString());
    const tokenPayload = await tokenResponse.json() as { access_token?: string; error?: { message?: string } };
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      return new Response(`<html><body><h1>Instagram token exchange failed</h1><p>${escapeHtml(tokenPayload.error?.message || "No access token returned.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const longTokenUrl = new URL(`https://graph.facebook.com/${graphApiVersion()}/oauth/access_token`);
    longTokenUrl.searchParams.set("grant_type", "fb_exchange_token");
    longTokenUrl.searchParams.set("client_id", pending.app_id || config.appId);
    longTokenUrl.searchParams.set("client_secret", config.appSecret);
    longTokenUrl.searchParams.set("fb_exchange_token", tokenPayload.access_token);
    const longTokenResponse = await fetch(longTokenUrl.toString());
    const longTokenPayload = await longTokenResponse.json() as { access_token?: string; expires_in?: number; error?: { message?: string } };
    const userAccessToken = longTokenPayload.access_token || tokenPayload.access_token;
    if (!longTokenResponse.ok && !userAccessToken) {
      return new Response(`<html><body><h1>Instagram long-lived token exchange failed</h1><p>${escapeHtml(longTokenPayload.error?.message || "No access token returned.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const accountsUrl = new URL(`https://graph.facebook.com/${graphApiVersion()}/me/accounts`);
    accountsUrl.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
    accountsUrl.searchParams.set("access_token", userAccessToken);
    const accountsResponse = await fetch(accountsUrl.toString());
    const accountsPayload = await accountsResponse.json() as { data?: InstagramPageConnection[]; error?: { message?: string } };
    if (!accountsResponse.ok) {
      return new Response(`<html><body><h1>Instagram account lookup failed</h1><p>${escapeHtml(accountsPayload.error?.message || "Could not load Facebook Pages.")}</p></body></html>`, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const page = (accountsPayload.data ?? []).find((item) => item.instagram_business_account?.id && item.access_token);
    if (!page?.instagram_business_account?.id || !page.access_token) {
      return new Response(
        "<html><body><h1>No Instagram professional account found</h1><p>Connect an Instagram Business or Creator account to a Facebook Page, then try again.</p></body></html>",
        { status: 400, headers: { "Content-Type": "text/html" } },
      );
    }

    const accountId = await upsertInstagramOAuthAccount(env, {
      username: page.instagram_business_account.username || page.name || page.instagram_business_account.id,
      displayName: page.name || page.instagram_business_account.username || page.instagram_business_account.id,
      accessToken: page.access_token,
      instagramUserId: page.instagram_business_account.id,
      pageId: page.id,
      appId: pending.app_id || config.appId,
      redirectUri: pending.redirect_uri || config.redirectUri,
      scopes: pending.scopes || config.scopes,
      userAccessToken,
      expiresIn: longTokenPayload.expires_in,
    }, pendingUserId);
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

export async function listInternalExtraSocialAccounts(env: Env) {
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
    const officialReady = await storedOfficialCredentialsReady(env, row.platform, row.id);
    return {
      ...row,
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

    await Promise.all(Object.entries(OFFICIAL_FIELD_SETTINGS[platform]).flatMap(([field, settingKey]) => {
      const value = String(payload[field as FieldName] ?? "").trim();
      return value ? [upsertSetting(env, `social_account:${accountId}:${settingKey}`, value, now, scopeId)] : [];
    }));

    return jsonResponse({
      id: accountId,
      platform,
      username,
      status,
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

    if (updates.length === 0 && accountUpdates.length === 0) {
      return errorResponse("No account fields to update", 400);
    }

    await Promise.all(updates);
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update social account", 500);
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

  try {
    const filters = ["id = ?", `platform IN (${EXTRA_SOCIAL_PLATFORMS.map(() => "?").join(", ")})`];
    const values: unknown[] = [id, ...EXTRA_SOCIAL_PLATFORMS];
    await appendScopedFilter(env, "social_posts", filters, values, scopeId);
    const post = await env.DB.prepare(
      `SELECT id, platform, content, image_url, status, account_id
       FROM social_posts
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(...values)
      .first<ExtraSocialPostRow>();
    if (!post) return errorResponse("Social post not found", 404);
    if (post.status === "posted") return errorResponse("Post is already published", 400);

    const account = await resolveExtraAccountForPost(env, post, scopeId);
    if (!account) return errorResponse(`No active ${post.platform} account is connected.`, 400);

    let externalId = "";
    if (post.platform === "instagram") {
      externalId = await publishInstagramOfficial(env, post, account.id, scopeId);
    } else if (post.platform === "linkedin") {
      externalId = await publishLinkedInOfficial(env, post, account.id, scopeId);
    } else {
      return errorResponse("YouTube official API publishing is not implemented yet.", 501);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE social_posts
       SET status = 'posted', posted_at = ?, external_id = ?, account_id = ?, updated_at = ?
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(now, externalId, account.id, now, ...values)
      .run();
    await markLinkedPlannerItemsPublished(env, id, now);
    return jsonResponse({ success: true, external_id: externalId, posted_at: now, account_id: account.id });
  } catch (error) {
    const now = new Date().toISOString();
    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "social_posts", filters, values, scopeId);
    await env.DB.prepare(`UPDATE social_posts SET status = 'failed', updated_at = ? WHERE ${filters.join(" AND ")}`)
      .bind(now, ...values)
      .run();
    return errorResponse(error instanceof Error ? error.message : "Failed to publish social post", 500);
  }
}
