import type { Env } from "../lib/types";
import { parseJson, jsonResponse, errorResponse } from "../lib/http";
import { DEFAULT_USER_ID, appendScopedFilter, ownerId, scopedInsertColumns, tableHasColumn, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import { defaultPlaywrightProfileKey, playwrightUserSettingKey } from "../lib/playwright-accounts";

interface OAuthState {
  accountName: string;
  timestamp: number;
}

const REDDIT_OAUTH_URL = "https://www.reddit.com/api/v1/authorize";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

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

export async function handleAuthorizeRequest(
  env: Env,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const payload = await parseJson<{ account_name: string }>(request);

    if (!payload.account_name || !payload.account_name.trim()) {
      return errorResponse("Account name is required", 400);
    }

    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
      return errorResponse("Reddit OAuth not configured", 500);
    }

    // Generate random state for CSRF protection
    const state = crypto.randomUUID();
    const stateData: OAuthState = {
      accountName: payload.account_name,
      timestamp: Date.now(),
    };

    // Store state in a temporary key (in production, use Redis or database)
    // For now, we'll pass it as encrypted data
    const stateJson = JSON.stringify(stateData);
    const stateKey = `oauth_state_${state}`;

    // Build Reddit OAuth URL
    const params = new URLSearchParams({
      client_id: env.REDDIT_CLIENT_ID,
      response_type: "code",
      state,
      redirect_uri: env.REDDIT_REDIRECT_URI || "http://localhost:5174/api/reddit/auth/callback",
      scope: "submit,edit,read",
      duration: "permanent",
    });

    const authUrl = `${REDDIT_OAUTH_URL}?${params.toString()}`;

    return jsonResponse(
      { auth_url: authUrl },
      {
        headers: {
          "Set-Cookie": `reddit_oauth_state=${state}.${ownerId(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
        },
      },
    );
  } catch (error) {
    return errorResponse("Failed to generate authorization URL", 500);
  }
}

export async function handleOAuthCallback(
  env: Env,
  url: URL,
  request: Request,
): Promise<Response> {
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`, {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (!code || !state) {
      return new Response("<html><body><h1>Invalid OAuth Callback</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    // Verify state from cookie
    const cookies = request.headers.get("cookie") || "";
    const stateMatch = cookies.match(/reddit_oauth_state=([^;]+)/);
    const [cookieState, ownerValue] = stateMatch ? stateMatch[1].split(".") : [null, null];
    const owner = ownerId(ownerValue ? Number(ownerValue) : DEFAULT_USER_ID);

    if (cookieState !== state) {
      return new Response("<html><body><h1>Invalid State Parameter</h1></body></html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
      return new Response(
        "<html><body><h1>Server Configuration Error</h1></body></html>",
        {
          status: 500,
          headers: { "Content-Type": "text/html" },
        },
      );
    }

    // Exchange code for access token
    const tokenResponse = await fetch(REDDIT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(
          `${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`,
        )}`,
        "User-Agent": "BlogPoster/1.0",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: env.REDDIT_REDIRECT_URI || "http://localhost:5174/api/reddit/auth/callback",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Reddit token exchange failed:", errorData);
      return new Response(
        "<html><body><h1>Token Exchange Failed</h1></body></html>",
        {
          status: 500,
          headers: { "Content-Type": "text/html" },
        },
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Get Reddit username
    const userResponse = await fetch("https://oauth.reddit.com/api/v1/me", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "BlogPoster/1.0",
      },
    });

    let redditUsername = "Unknown";
    if (userResponse.ok) {
      const userData = (await userResponse.json()) as { name: string };
      redditUsername = userData.name;
    }

    // Store account in database
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const now = new Date().toISOString();

    const scoped = await scopedInsertColumns(env, "reddit_accounts", owner);
    const result = await env.DB.prepare(
      `INSERT INTO reddit_accounts (${[...scoped.columns, "name", "access_token", "refresh_token", "token_expires_at", "status", "created_at", "updated_at"].join(", ")})
       VALUES (${[...scoped.columns.map(() => "?"), "?", "?", "?", "?", "'active'", "?", "?"].join(", ")})`,
    )
      .bind(
        ...scoped.values,
        redditUsername,
        tokenData.access_token,
        tokenData.refresh_token || "",
        expiresAt,
        now,
        now,
      )
      .run();
    const accountId = Number((result as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? 0);
    if (accountId) {
      await upsertSetting(env, `reddit_account:${accountId}:connection_mode`, "official_api", now, owner);
    }

    // Redirect back to app with success
    return new Response(
      `<html>
        <body>
          <h1>✓ Account Connected!</h1>
          <p>Reddit account <strong>${redditUsername}</strong> connected successfully.</p>
          <p>Closing this window...</p>
          <script>
            setTimeout(() => {
              window.close();
              // Fallback: redirect to parent
              window.location.href = '/';
            }, 2000);
          </script>
        </body>
      </html>`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie":
            "reddit_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        },
      },
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    return new Response(
      "<html><body><h1>Error Processing OAuth Callback</h1></body></html>",
      {
        status: 500,
        headers: { "Content-Type": "text/html" },
      },
    );
  }
}

export async function listRedditAccounts(
  env: Env,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const filters: string[] = [];
    const values: unknown[] = [];
    await appendScopedFilter(env, "reddit_accounts", filters, values, scopeId);
    const accounts = await env.DB.prepare(
      `SELECT id, name, status, created_at, updated_at FROM reddit_accounts ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY created_at DESC`,
    ).bind(...values).all();

    const results = await Promise.all((accounts.results || []).map(async (account) => {
      const accountId = Number((account as { id: number }).id);
      const [connectionMode, playwright] = await Promise.all([
        readSetting(env, `reddit_account:${accountId}:connection_mode`, scopeId),
        readPlaywrightSettings(env, accountId, scopeId, dashboardUserId),
      ]);
      return {
        ...account,
        connection_mode: connectionMode === "playwright" ? "playwright" : "official_api",
        playwright_login: playwright.login || undefined,
        playwright_profile_key: playwright.profileKey || defaultPlaywrightProfileKey("reddit", accountId, dashboardUserId),
        playwright_ready: Boolean(playwright.login && playwright.password),
      };
    }));
    return jsonResponse(results);
  } catch (error) {
    return errorResponse("Failed to fetch Reddit accounts", 500);
  }
}

async function readAllRedditPlaywrightUserSettings(
  env: Env,
  accountId: number,
): Promise<Array<{ dashboard_user_id: number; login: string; password: string; profile_key: string }>> {
  const rows = await env.DB.prepare("SELECT key, value FROM app_settings WHERE key LIKE ?")
    .bind(`reddit_account:${accountId}:playwright_user:%`)
    .all<{ key: string; value: string }>();
  const grouped = new Map<number, { dashboard_user_id: number; login: string; password: string; profile_key: string }>();
  const pattern = new RegExp(`^reddit_account:${accountId}:playwright_user:(\\d+):(login|password|profile_key)$`);

  for (const row of rows.results ?? []) {
    const match = String(row.key ?? "").match(pattern);
    if (!match) continue;
    const dashboardUserId = Number(match[1]);
    const field = match[2] as "login" | "password" | "profile_key";
    if (!dashboardUserId) continue;
    const entry = grouped.get(dashboardUserId) ?? {
      dashboard_user_id: dashboardUserId,
      login: "",
      password: "",
      profile_key: defaultPlaywrightProfileKey("reddit", accountId, dashboardUserId),
    };
    entry[field] = String(row.value ?? "").trim();
    grouped.set(dashboardUserId, entry);
  }

  return Array.from(grouped.values()).filter((entry) => entry.login || entry.password || entry.profile_key);
}

export async function listInternalRedditAccounts(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT id, name AS username, status, access_token, created_at, updated_at
     FROM reddit_accounts
     ORDER BY created_at DESC`,
  ).all<{
    id: number;
    username: string;
    status: "active" | "inactive";
    access_token: string | null;
    created_at: string;
    updated_at: string;
  }>();

  return Promise.all((rows.results ?? []).map(async (row) => {
    const [connectionMode, playwrightUsers] = await Promise.all([
      readSetting(env, `reddit_account:${row.id}:connection_mode`),
      readAllRedditPlaywrightUserSettings(env, row.id),
    ]);
    const usesPlaywright = connectionMode === "playwright";
    const readyPlaywrightUser = playwrightUsers.find((entry) => entry.login && entry.password) ?? playwrightUsers[0] ?? null;
    return {
      id: row.id,
      platform: "reddit",
      username: row.username,
      name: row.username,
      status: row.status,
      connection_mode: usesPlaywright ? "playwright" : "official_api",
      credentials_ready: usesPlaywright ? Boolean(readyPlaywrightUser?.login && readyPlaywrightUser.password) : Boolean(row.access_token?.trim()),
      playwright_login: readyPlaywrightUser?.login || undefined,
      playwright_password: readyPlaywrightUser?.password || undefined,
      playwright_profile_key: readyPlaywrightUser?.profile_key || undefined,
      playwright_ready: Boolean(readyPlaywrightUser?.login && readyPlaywrightUser.password),
      playwright_users: playwrightUsers,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }));
}

export async function addRedditAccount(
  env: Env,
  request: Request,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const payload = await parseJson<{
      name?: string;
      status?: "active" | "inactive";
      connection_mode?: "official_api" | "playwright";
      playwright_login?: string;
      playwright_password?: string;
    }>(request);
    const name = payload.name?.trim();
    if (!name) return errorResponse("Account name is required", 400);
    const status = payload.status === "inactive" ? "inactive" : "active";
    const connectionMode = payload.connection_mode === "playwright" ? "playwright" : "official_api";
    const playwrightLogin = payload.playwright_login?.trim() ?? "";
    const playwrightPassword = payload.playwright_password?.trim() ?? "";
    if (connectionMode === "playwright" && !playwrightLogin) return errorResponse("Playwright login is required", 400);
    if (connectionMode === "playwright" && !playwrightPassword) return errorResponse("Playwright password is required", 400);
    const now = new Date().toISOString();
    const scoped = await scopedInsertColumns(env, "reddit_accounts", scopeId);
    const result = await env.DB.prepare(
      `INSERT INTO reddit_accounts (${[...scoped.columns, "name", "access_token", "refresh_token", "token_expires_at", "status", "created_at", "updated_at"].join(", ")})
       VALUES (${[...scoped.columns.map(() => "?"), "?", "?", "?", "?", "?", "?", "?"].join(", ")})`,
    )
      .bind(...scoped.values, name, "", "", null, status, now, now)
      .run() as { meta: { last_row_id: number } };
    const accountId = result.meta.last_row_id;
    await Promise.all([
      upsertSetting(env, `reddit_account:${accountId}:connection_mode`, connectionMode, now, scopeId),
      ...(connectionMode === "playwright"
        ? [
            upsertSetting(env, playwrightUserSettingKey("reddit_account", accountId, dashboardUserId, "login"), playwrightLogin, now, scopeId),
            upsertSetting(env, playwrightUserSettingKey("reddit_account", accountId, dashboardUserId, "password"), playwrightPassword, now, scopeId),
            upsertSetting(
              env,
              playwrightUserSettingKey("reddit_account", accountId, dashboardUserId, "profile_key"),
              defaultPlaywrightProfileKey("reddit", accountId, dashboardUserId),
              now,
              scopeId,
            ),
          ]
        : []),
    ]);
    return jsonResponse({
      id: accountId,
      name,
      status,
      connection_mode: connectionMode,
      playwright_login: connectionMode === "playwright" ? playwrightLogin : undefined,
      playwright_profile_key: connectionMode === "playwright" ? defaultPlaywrightProfileKey("reddit", accountId, dashboardUserId) : undefined,
      playwright_ready: connectionMode === "playwright",
      created_at: now,
      updated_at: now,
    }, { status: 201 });
  } catch {
    return errorResponse("Failed to create Reddit account", 500);
  }
}

export async function updateRedditAccount(
  env: Env,
  accountId: string,
  request: Request,
  scopeId = DEFAULT_USER_ID,
  dashboardUserId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) {
      return errorResponse("Invalid account ID", 400);
    }

    const filters = ["id = ?"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "reddit_accounts", filters, filterValues, scopeId);
    const existing = await env.DB.prepare(`SELECT id FROM reddit_accounts WHERE ${filters.join(" AND ")}`)
      .bind(...filterValues)
      .first<{ id: number }>();
    if (!existing) return errorResponse("Reddit account not found", 404);

    const payload = await parseJson<{
      name?: string;
      status?: "active" | "inactive";
      connection_mode?: "official_api" | "playwright";
      playwright_login?: string;
      playwright_password?: string;
    }>(request);
    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.name !== undefined) {
      const name = payload.name.trim();
      if (!name) return errorResponse("Account name is required", 400);
      updates.push("name = ?");
      values.push(name);
    }
    if (payload.status !== undefined) {
      if (payload.status !== "active" && payload.status !== "inactive") {
        return errorResponse("Invalid account status", 400);
      }
      updates.push("status = ?");
      values.push(payload.status);
    }

    const playwrightLogin = payload.playwright_login?.trim() ?? "";
    const playwrightPassword = payload.playwright_password?.trim() ?? "";

    if (updates.length === 0 && !payload.connection_mode && !playwrightLogin && !playwrightPassword) {
      return errorResponse("No account fields to update", 400);
    }

    const now = new Date().toISOString();
    updates.push("updated_at = ?");
    values.push(now);
    await env.DB.prepare(`UPDATE reddit_accounts SET ${updates.join(", ")} WHERE ${filters.join(" AND ")}`)
      .bind(...values, ...filterValues)
      .run();
    if (payload.connection_mode === "playwright" && !playwrightLogin) {
      const currentPlaywright = await readPlaywrightSettings(env, id, scopeId, dashboardUserId);
      if (!currentPlaywright.login) return errorResponse("Playwright login is required", 400);
    }

    await Promise.all([
      ...(payload.connection_mode === "official_api" || payload.connection_mode === "playwright"
        ? [upsertSetting(env, `reddit_account:${id}:connection_mode`, payload.connection_mode, now, scopeId)]
        : []),
      ...(playwrightLogin
        ? [upsertSetting(env, playwrightUserSettingKey("reddit_account", id, dashboardUserId, "login"), playwrightLogin, now, scopeId)]
        : []),
      ...(playwrightPassword
        ? [upsertSetting(env, playwrightUserSettingKey("reddit_account", id, dashboardUserId, "password"), playwrightPassword, now, scopeId)]
        : []),
      ...(payload.connection_mode === "playwright" || playwrightLogin || playwrightPassword
        ? [
            upsertSetting(
              env,
              playwrightUserSettingKey("reddit_account", id, dashboardUserId, "profile_key"),
              defaultPlaywrightProfileKey("reddit", id, dashboardUserId),
              now,
              scopeId,
            ),
          ]
        : []),
    ]);

    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Reddit account", 500);
  }
}

export async function deleteRedditAccount(
  env: Env,
  accountId: string,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(accountId);
    if (isNaN(id)) {
      return errorResponse("Invalid account ID", 400);
    }

    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "reddit_accounts", filters, values, userId);
    const existing = await env.DB.prepare(`SELECT id FROM reddit_accounts WHERE ${filters.join(" AND ")}`)
      .bind(...values)
      .first<{ id: number }>();
    if (!existing) {
      return errorResponse("Reddit account not found", 404);
    }

    await env.DB.prepare(
      `DELETE FROM reddit_comments WHERE campaign_id IN (SELECT id FROM reddit_campaigns WHERE reddit_account_id = ?)`,
    )
      .bind(id)
      .run();
    await env.DB.prepare("DELETE FROM reddit_campaigns WHERE reddit_account_id = ?").bind(id).run();
    await env.DB.prepare("UPDATE social_posts SET account_id = NULL WHERE platform = 'reddit' AND account_id = ?")
      .bind(id)
      .run();
    if (await tableHasColumn(env, "planner_items", "account_id")) {
      await env.DB.prepare("UPDATE planner_items SET account_id = NULL WHERE platform = 'reddit' AND account_id = ?")
        .bind(id)
        .run();
    }
    await env.DB.prepare(`DELETE FROM reddit_accounts WHERE ${filters.join(" AND ")}`).bind(...values).run();
    const settingsHasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
    const settingsHasUserId = await tableHasUserId(env, "app_settings");
    await env.DB.prepare(settingsHasWorkspaceId
      ? "DELETE FROM app_settings WHERE workspace_id = ? AND key LIKE ?"
      : settingsHasUserId
      ? "DELETE FROM app_settings WHERE user_id = ? AND key LIKE ?"
      : "DELETE FROM app_settings WHERE key LIKE ?")
      .bind(...(settingsHasWorkspaceId ? [workspaceId(userId), `reddit_account:${id}:%`] : settingsHasUserId ? [ownerId(userId), `reddit_account:${id}:%`] : [`reddit_account:${id}:%`]))
      .run();

    return jsonResponse({ success: true });
  } catch (error) {
    return errorResponse("Failed to delete account", 500);
  }
}
