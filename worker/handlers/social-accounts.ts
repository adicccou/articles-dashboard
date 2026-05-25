import type { Env } from "../lib/types";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { DEFAULT_USER_ID, appendScopedFilter, ownerId, scopedInsertColumns, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import { defaultPlaywrightProfileKey, playwrightUserSettingKey } from "../lib/playwright-accounts";

type ExtraSocialPlatform = "linkedin" | "instagram" | "youtube";
type AccountConnectionMode = "official_api" | "playwright";
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
  playwright_login?: string;
  playwright_password?: string;
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
  scopes?: string;
  access_token?: string;
  user_id?: string;
  page_id?: string;
  refresh_token?: string;
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
  instagram: ["client_id", "client_secret", "redirect_uri", "scopes", "access_token", "user_id", "page_id"],
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

function firstMediaUrl(raw: string | null): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return String(parsed.find((item) => String(item ?? "").trim()) ?? "").trim();
      }
    } catch {
      return value;
    }
  }
  return value.split(/[\n,]+/).map((item) => item.trim()).find(Boolean) ?? "";
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

async function resolveExtraAccountForPost(
  env: Env,
  post: ExtraSocialPostRow,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<{
  id: number;
  platform: ExtraSocialPlatform;
  username: string;
  connectionMode: AccountConnectionMode;
  playwright: { login: string; password: string; profileKey: string };
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

  const [connectionModeValue, playwright] = await Promise.all([
    readSetting(env, `social_account:${account.id}:connection_mode`, scopeId),
    readPlaywrightSettings(env, account.id, scopeId, dashboardUserId),
  ]);
  return {
    ...account,
    connectionMode: connectionModeValue === "playwright" ? "playwright" : "official_api",
    playwright,
  };
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
  const imageUrl = firstMediaUrl(post.image_url);
  if (!accessToken || !instagramUserId) throw new Error("Instagram official API credentials are incomplete.");
  if (!imageUrl) throw new Error("Instagram official API publishing needs an attached public image URL.");

  const mediaBody = new URLSearchParams({
    image_url: imageUrl,
    caption: post.content?.trim() ?? "",
    access_token: accessToken,
  });
  const mediaResponse = await fetch(`https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(instagramUserId)}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: mediaBody.toString(),
  });
  const mediaPayload = await mediaResponse.json() as { id?: string; error?: { message?: string } };
  if (!mediaResponse.ok || !mediaPayload.id) {
    throw new Error(mediaPayload.error?.message || "Instagram media container creation failed.");
  }

  const publishBody = new URLSearchParams({
    creation_id: mediaPayload.id,
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

function validateCreatePayload(payload: ExtraSocialAccountPayload, platform: ExtraSocialPlatform, connectionMode: AccountConnectionMode): string | null {
  const username = payload.username?.trim().replace(/^@+/, "");
  if (!username) return "Username is required";

  if (connectionMode === "playwright") {
    if (!payload.playwright_login?.trim()) return "Playwright login is required";
    if (!payload.playwright_password?.trim()) return "Playwright password is required";
    return null;
  }

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
      const [connectionMode, playwright] = await Promise.all([
        readSetting(env, `social_account:${row.id}:connection_mode`, scopeId),
        readPlaywrightSettings(env, row.id, scopeId, dashboardUserId),
      ]);
      const usesPlaywright = connectionMode === "playwright";
      const credentialsReady = usesPlaywright
        ? Boolean(playwright.login && playwright.password)
        : await storedOfficialCredentialsReady(env, row.platform, row.id, scopeId);
      return {
        ...row,
        connection_mode: usesPlaywright ? "playwright" : "official_api",
        status: row.status === "active" && credentialsReady ? "active" : "inactive",
        credentials_ready: credentialsReady ? 1 : 0,
        playwright_login: playwright.login || undefined,
        playwright_profile_key: playwright.profileKey || defaultPlaywrightProfileKey(row.platform, row.id, dashboardUserId),
        playwright_ready: Boolean(playwright.login && playwright.password),
      };
    }));

    return jsonResponse(results);
  } catch {
    return errorResponse("Failed to list social accounts", 500);
  }
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

    const connectionMode: AccountConnectionMode = payload.connection_mode === "playwright" ? "playwright" : "official_api";
    const validationError = validateCreatePayload(payload, platform, connectionMode);
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

    if (connectionMode === "playwright") {
      await Promise.all([
        upsertSetting(env, playwrightUserSettingKey("social_account", accountId, dashboardUserId, "login"), payload.playwright_login!.trim(), now, scopeId),
        upsertSetting(env, playwrightUserSettingKey("social_account", accountId, dashboardUserId, "password"), payload.playwright_password!.trim(), now, scopeId),
        upsertSetting(
          env,
          playwrightUserSettingKey("social_account", accountId, dashboardUserId, "profile_key"),
          defaultPlaywrightProfileKey(platform, accountId, dashboardUserId),
          now,
          scopeId,
        ),
      ]);
    } else {
      await Promise.all(Object.entries(OFFICIAL_FIELD_SETTINGS[platform]).flatMap(([field, settingKey]) => {
        const value = String(payload[field as FieldName] ?? "").trim();
        return value ? [upsertSetting(env, `social_account:${accountId}:${settingKey}`, value, now, scopeId)] : [];
      }));
    }

    return jsonResponse({
      id: accountId,
      platform,
      username,
      status,
      connection_mode: connectionMode,
      credentials_ready: 1,
      playwright_login: connectionMode === "playwright" ? payload.playwright_login!.trim() : undefined,
      playwright_profile_key: connectionMode === "playwright" ? defaultPlaywrightProfileKey(platform, accountId, dashboardUserId) : undefined,
      playwright_ready: connectionMode === "playwright",
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

    const connectionMode = payload.connection_mode === "playwright"
      ? "playwright"
      : payload.connection_mode === "official_api"
      ? "official_api"
      : null;
    const playwrightLogin = payload.playwright_login?.trim() ?? "";
    const playwrightPassword = payload.playwright_password?.trim() ?? "";

    if (connectionMode === "playwright" && !playwrightLogin) {
      const currentPlaywright = await readPlaywrightSettings(env, id, scopeId, dashboardUserId);
      if (!currentPlaywright.login) return errorResponse("Playwright login is required", 400);
    }

    const updates = [];
    if (connectionMode) {
      updates.push(upsertSetting(env, `social_account:${id}:connection_mode`, connectionMode, now, scopeId));
    }
    if (playwrightLogin) {
      updates.push(upsertSetting(env, playwrightUserSettingKey("social_account", id, dashboardUserId, "login"), playwrightLogin, now, scopeId));
    }
    if (playwrightPassword) {
      updates.push(upsertSetting(env, playwrightUserSettingKey("social_account", id, dashboardUserId, "password"), playwrightPassword, now, scopeId));
    }
    if (connectionMode === "playwright" || playwrightLogin || playwrightPassword) {
      updates.push(
        upsertSetting(
          env,
          playwrightUserSettingKey("social_account", id, dashboardUserId, "profile_key"),
          defaultPlaywrightProfileKey(existing.platform, id, dashboardUserId),
          now,
          scopeId,
        ),
      );
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

    const account = await resolveExtraAccountForPost(env, post, scopeId, dashboardUserId);
    if (!account) return errorResponse(`No active ${post.platform} account is connected.`, 400);

    if (account.connectionMode === "playwright") {
      const profileKey = account.playwright.profileKey || defaultPlaywrightProfileKey(post.platform, account.id, dashboardUserId);
      return errorResponse(
        `This ${post.platform} account is set to Playwright. Browser publishing must run through profile ${profileKey}; the Cloudflare Worker will not use official API credentials for it.`,
        501,
      );
    }

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
