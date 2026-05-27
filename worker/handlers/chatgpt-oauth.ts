import { getSessionUser } from "../lib/auth";
import { jsonResponse, errorResponse } from "../lib/http";
import type { DashboardUser } from "../lib/ownership";
import { activeScopeId } from "../lib/ownership";
import type { Env } from "../lib/types";

export const CHATGPT_OAUTH_SCOPES = ["posts.read", "posts.write", "posts.publish"] as const;

type OAuthClientRow = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: string;
  grant_types: string;
  response_types: string;
  scope: string | null;
};

type OAuthCodeRow = {
  user_id: number;
  workspace_id: number;
  client_id: string;
  redirect_uri: string;
  scope: string;
  resource: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: string;
  consumed_at: string | null;
};

type OAuthTokenRow = {
  user_id: number;
  workspace_id: number;
  client_id: string;
  scope: string;
  resource: string;
  expires_at: string;
  revoked_at: string | null;
  user_status: string | null;
  membership_status: string | null;
};

export type ChatGptAccessContext = {
  authMode: "oauth";
  userId: number;
  scopeId: number;
  workspaceId: number;
  scopes: string[];
  clientId: string;
};

type TokenValidation =
  | { ok: true; context: ChatGptAccessContext }
  | { ok: false; error: string; description: string };

const TOKEN_TTL_SECONDS = 60 * 60 * 8;
const AUTH_CODE_TTL_SECONDS = 10 * 60;

const encoder = new TextEncoder();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64Url(new Uint8Array(digest));
}

export async function createPkceS256Challenge(verifier: string): Promise<string> {
  return sha256Base64Url(verifier);
}

async function hashSecret(value: string): Promise<string> {
  return sha256Base64Url(value);
}

function randomUrlToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64Url(buffer);
}

function jsonNoStore(data: unknown, init: ResponseInit = {}): Response {
  return jsonResponse(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...(init.headers ?? {}),
    },
  });
}

function originFor(request: Request): string {
  return new URL(request.url).origin;
}

export function chatGptMcpResource(request: Request): string {
  return new URL("/mcp", originFor(request)).toString();
}

export function chatGptProtectedResourceMetadataUrl(request: Request): string {
  return new URL("/.well-known/oauth-protected-resource", originFor(request)).toString();
}

export function chatGptOAuthChallenge(request: Request, error = "invalid_token", description = "Connect Oilor Studio to continue."): string {
  const escapedDescription = description.replace(/"/g, "'");
  return `Bearer resource_metadata="${chatGptProtectedResourceMetadataUrl(request)}", error="${error}", error_description="${escapedDescription}"`;
}

function oauthMetadata(request: Request) {
  const origin = originFor(request);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: CHATGPT_OAUTH_SCOPES,
  };
}

function protectedResourceMetadata(request: Request) {
  return {
    resource: chatGptMcpResource(request),
    authorization_servers: [originFor(request)],
    scopes_supported: CHATGPT_OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: new URL("/legal/privacy", originFor(request)).toString(),
  };
}

async function parseOAuthBody(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = await request.json() as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

function safeJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readRedirectUris(params: URLSearchParams): string[] {
  const values = params.getAll("redirect_uris");
  if (values.length === 1 && values[0].trim().startsWith("[")) {
    return safeJsonList(values[0]);
  }
  return values.length ? values : safeJsonList(params.get("redirect_uris"));
}

function normalizeScopes(raw: string | null | undefined): string {
  const requested = String(raw ?? "").split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  const allowed = new Set<string>(CHATGPT_OAUTH_SCOPES);
  const scopes = requested.length ? requested.filter((scope) => allowed.has(scope)) : [...CHATGPT_OAUTH_SCOPES];
  return Array.from(new Set(scopes)).join(" ");
}

function hasRequiredScopes(granted: string, requiredScopes: string[]): boolean {
  const grantedSet = new Set(granted.split(/\s+/).filter(Boolean));
  return requiredScopes.every((scope) => grantedSet.has(scope));
}

function isLocalRedirect(url: URL): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function isKnownChatGptRedirect(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  return (
    url.hostname === "chatgpt.com" ||
    url.hostname.endsWith(".chatgpt.com") ||
    url.hostname === "chat.openai.com" ||
    url.hostname.endsWith(".chat.openai.com")
  );
}

function isAcceptableRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash) return false;
    if (isLocalRedirect(url)) return true;
    return isKnownChatGptRedirect(url);
  } catch {
    return false;
  }
}

async function readClient(env: Env, clientId: string): Promise<OAuthClientRow | null> {
  return env.DB.prepare("SELECT * FROM chatgpt_oauth_clients WHERE client_id = ?")
    .bind(clientId)
    .first<OAuthClientRow>();
}

async function isRedirectAllowed(env: Env, clientId: string, redirectUri: string): Promise<boolean> {
  const client = await readClient(env, clientId);
  if (!client) return isAcceptableRedirectUri(redirectUri);
  return safeJsonList(client.redirect_uris).includes(redirectUri);
}

function redirectWithOAuthError(redirectUri: string, state: string, error: string, description: string): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

function renderOAuthPage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | Oilor Studio</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7fb; color: #171b26; }
      main { width: min(520px, calc(100vw - 32px)); background: #fff; border: 1px solid #dfe3ee; border-radius: 14px; padding: 28px; box-shadow: 0 18px 50px rgba(20, 28, 45, 0.12); }
      h1 { margin: 0 0 10px; font-size: 1.55rem; line-height: 1.2; }
      p, li { color: #576174; line-height: 1.6; }
      ul { padding-left: 20px; }
      form, .actions { display: grid; gap: 12px; margin-top: 20px; }
      button, a.button { border: 0; border-radius: 10px; padding: 12px 16px; background: #174cff; color: white; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer; }
      a.secondary { color: #174cff; text-align: center; text-decoration: none; }
      code { background: #eef2ff; border-radius: 6px; padding: 2px 5px; }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
}

function renderLoginRequired(request: Request): Response {
  const returnTo = new URL(request.url);
  const fallback = new URL("/fallbacksign", request.url);
  fallback.searchParams.set("return_to", `${returnTo.pathname}${returnTo.search}`);
  const google = new URL("/api/auth/google/authorize", request.url);
  google.searchParams.set("return_to", `${returnTo.pathname}${returnTo.search}`);
  return renderOAuthPage("Sign in to connect ChatGPT", `
    <h1>Sign in to connect ChatGPT</h1>
    <p>ChatGPT needs your Oilor Studio dashboard account before it can manage posts in your workspace.</p>
    <div class="actions">
      <a class="button" href="${escapeHtml(google.toString())}">Continue with Google</a>
      <a class="secondary" href="${escapeHtml(fallback.toString())}">Use password fallback</a>
    </div>
  `, 401);
}

function renderConsentPage(request: Request, user: DashboardUser, params: URLSearchParams): Response {
  return renderOAuthPage("Connect ChatGPT", `
    <h1>Connect ChatGPT to Oilor Studio</h1>
    <p>Signed in as <strong>${escapeHtml(user.display_name || user.username)}</strong>.</p>
    <p>ChatGPT will be able to work with social posts in this workspace:</p>
    <ul>
      <li>Read queued and scheduled posts</li>
      <li>Create, edit, schedule, and delete dashboard posts</li>
      <li>Publish posts only after ChatGPT asks for explicit confirmation</li>
    </ul>
    <form method="post" action="/oauth/authorize">
      ${Array.from(params.entries()).map(([key, value]) => hidden(key, value)).join("")}
      <button type="submit">Allow ChatGPT</button>
      <a class="secondary" href="/">Cancel and return to dashboard</a>
    </form>
  `);
}

async function completeAuthorization(request: Request, env: Env, params: URLSearchParams, user: DashboardUser): Promise<Response> {
  const responseType = params.get("response_type") ?? "";
  const clientId = params.get("client_id")?.trim() ?? "";
  const redirectUri = params.get("redirect_uri")?.trim() ?? "";
  const state = params.get("state")?.trim() ?? "";
  const codeChallenge = params.get("code_challenge")?.trim() ?? "";
  const codeChallengeMethod = params.get("code_challenge_method")?.trim() || "plain";
  const requestedResource = params.get("resource")?.trim() || chatGptMcpResource(request);
  const expectedResource = chatGptMcpResource(request);
  const scope = normalizeScopes(params.get("scope"));

  if (responseType !== "code") return errorResponse("Unsupported response_type", 400);
  if (!clientId) return errorResponse("Missing client_id", 400);
  if (!redirectUri || !(await isRedirectAllowed(env, clientId, redirectUri))) {
    return errorResponse("Invalid redirect_uri", 400);
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return redirectWithOAuthError(redirectUri, state, "invalid_request", "PKCE S256 is required.");
  }
  if (requestedResource !== expectedResource) {
    return redirectWithOAuthError(redirectUri, state, "invalid_target", "OAuth resource did not match this MCP server.");
  }

  const code = randomUrlToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_CODE_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO chatgpt_oauth_codes (
      code_hash, user_id, workspace_id, client_id, redirect_uri, scope, resource,
      code_challenge, code_challenge_method, expires_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await hashSecret(code),
      user.id,
      activeScopeId(user),
      clientId,
      redirectUri,
      scope,
      expectedResource,
      codeChallenge,
      codeChallengeMethod,
      expiresAt,
      now.toISOString(),
    )
    .run();

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: redirect.toString() } });
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) return renderLoginRequired(request);
  const params = request.method === "POST" ? await parseOAuthBody(request) : new URL(request.url).searchParams;
  if (request.method === "GET") return renderConsentPage(request, user, params);
  return completeAuthorization(request, env, params, user);
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const params = await parseOAuthBody(request);
  const redirectUris = readRedirectUris(params);
  const cleanRedirectUris = Array.from(new Set(redirectUris.map((uri) => uri.trim()).filter(Boolean)));
  if (cleanRedirectUris.length === 0 || cleanRedirectUris.some((uri) => !isAcceptableRedirectUri(uri))) {
    return jsonNoStore({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const clientId = `oilor-chatgpt-${crypto.randomUUID()}`;
  const scope = normalizeScopes(params.get("scope"));
  await env.DB.prepare(
    `INSERT INTO chatgpt_oauth_clients (
      client_id, client_name, redirect_uris, token_endpoint_auth_method,
      grant_types, response_types, scope, created_at, updated_at
    )
    VALUES (?, ?, ?, 'none', ?, ?, ?, ?, ?)`,
  )
    .bind(
      clientId,
      params.get("client_name")?.trim() || "ChatGPT",
      JSON.stringify(cleanRedirectUris),
      JSON.stringify(["authorization_code"]),
      JSON.stringify(["code"]),
      scope,
      now,
      now,
    )
    .run();

  return jsonNoStore({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.parse(now) / 1000),
    client_name: params.get("client_name")?.trim() || "ChatGPT",
    redirect_uris: cleanRedirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope,
  }, { status: 201 });
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  const params = await parseOAuthBody(request);
  const grantType = params.get("grant_type") ?? "";
  const code = params.get("code")?.trim() ?? "";
  const clientId = params.get("client_id")?.trim() ?? "";
  const redirectUri = params.get("redirect_uri")?.trim() ?? "";
  const codeVerifier = params.get("code_verifier")?.trim() ?? "";
  const resource = params.get("resource")?.trim() || chatGptMcpResource(request);

  if (grantType !== "authorization_code") return jsonNoStore({ error: "unsupported_grant_type" }, { status: 400 });
  if (!code || !clientId || !redirectUri || !codeVerifier) return jsonNoStore({ error: "invalid_request" }, { status: 400 });

  const codeHash = await hashSecret(code);
  const row = await env.DB.prepare("SELECT * FROM chatgpt_oauth_codes WHERE code_hash = ?")
    .bind(codeHash)
    .first<OAuthCodeRow>();
  if (!row || row.consumed_at) return jsonNoStore({ error: "invalid_grant" }, { status: 400 });
  if (Date.parse(row.expires_at) <= Date.now()) return jsonNoStore({ error: "invalid_grant", error_description: "Authorization code expired." }, { status: 400 });
  if (row.client_id !== clientId || row.redirect_uri !== redirectUri || row.resource !== resource) {
    return jsonNoStore({ error: "invalid_grant" }, { status: 400 });
  }
  if (row.code_challenge_method !== "S256" || await createPkceS256Challenge(codeVerifier) !== row.code_challenge) {
    return jsonNoStore({ error: "invalid_grant", error_description: "PKCE verification failed." }, { status: 400 });
  }

  const now = new Date();
  const consumed = await env.DB.prepare(
    "UPDATE chatgpt_oauth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL",
  )
    .bind(now.toISOString(), codeHash)
    .run() as { meta: { changes?: number } };
  if ((consumed.meta.changes ?? 0) !== 1) return jsonNoStore({ error: "invalid_grant" }, { status: 400 });

  const accessToken = randomUrlToken(32);
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO chatgpt_oauth_tokens (
      token_hash, user_id, workspace_id, client_id, scope, resource, expires_at, created_at, last_used_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await hashSecret(accessToken),
      row.user_id,
      row.workspace_id,
      row.client_id,
      row.scope,
      row.resource,
      expiresAt,
      now.toISOString(),
      now.toISOString(),
    )
    .run();

  return jsonNoStore({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: row.scope,
  });
}

export async function validateChatGptAccessToken(
  env: Env,
  token: string,
  expectedResource: string,
  requiredScopes: string[],
): Promise<TokenValidation> {
  if (!token) {
    return { ok: false, error: "invalid_token", description: "No access token provided." };
  }

  const tokenHash = await hashSecret(token);
  const row = await env.DB.prepare(
    `SELECT
      t.user_id,
      t.workspace_id,
      t.client_id,
      t.scope,
      t.resource,
      t.expires_at,
      t.revoked_at,
      u.status AS user_status,
      wm.status AS membership_status
    FROM chatgpt_oauth_tokens t
    JOIN dashboard_users u ON u.id = t.user_id
    LEFT JOIN workspace_members wm ON wm.user_id = t.user_id AND wm.workspace_id = t.workspace_id
    WHERE t.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<OAuthTokenRow>();

  if (!row || row.revoked_at) {
    return { ok: false, error: "invalid_token", description: "Access token is invalid." };
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, error: "invalid_token", description: "Access token expired." };
  }
  if (row.user_status !== "active" || row.membership_status !== "active") {
    return { ok: false, error: "invalid_token", description: "Dashboard user or workspace membership is inactive." };
  }
  if (row.resource !== expectedResource) {
    return { ok: false, error: "invalid_target", description: "Access token was not issued for this MCP resource." };
  }
  if (!hasRequiredScopes(row.scope, requiredScopes)) {
    return { ok: false, error: "insufficient_scope", description: "Access token does not include the required Oilor Studio scopes." };
  }

  await env.DB.prepare("UPDATE chatgpt_oauth_tokens SET last_used_at = ? WHERE token_hash = ?")
    .bind(new Date().toISOString(), tokenHash)
    .run();

  return {
    ok: true,
    context: {
      authMode: "oauth",
      userId: row.user_id,
      workspaceId: row.workspace_id,
      scopeId: row.workspace_id,
      scopes: row.scope.split(/\s+/).filter(Boolean),
      clientId: row.client_id,
    },
  };
}

export async function handleChatGptOAuthRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/oauth-protected-resource" && request.method === "GET") {
    return jsonNoStore(protectedResourceMetadata(request));
  }
  if (
    (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration")
    && request.method === "GET"
  ) {
    return jsonNoStore(oauthMetadata(request));
  }
  if (url.pathname === "/oauth/register" && request.method === "POST") {
    return handleRegister(request, env);
  }
  if (url.pathname === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) {
    return handleAuthorize(request, env);
  }
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    return handleToken(request, env);
  }
  return null;
}
