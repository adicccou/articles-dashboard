import { createSessionCookie } from "../lib/auth";
import { errorResponse } from "../lib/http";
import type { Env } from "../lib/types";
import { configuredDashboardOwnerEmail, normalizeUsername, upsertGoogleDashboardUser } from "../lib/users";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_STATE_COOKIE = "dashboard_google_oauth_state";
const GOOGLE_SCOPES = "openid email profile";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfoResponse = {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
};

type GoogleStatePayload = {
  state: string;
  return_to?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get("Cookie") ?? "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";
}

function safeReturnPath(value: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "";
  try {
    const parsed = new URL(raw, "https://dashboard.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function encodeStateCookie(payload: GoogleStatePayload): string {
  return encodeURIComponent(JSON.stringify(payload));
}

function decodeStateCookie(value: string): GoogleStatePayload | null {
  const decoded = decodeURIComponent(value || "");
  try {
    const parsed = JSON.parse(decoded) as Partial<GoogleStatePayload>;
    return parsed.state ? { state: parsed.state, return_to: safeReturnPath(parsed.return_to ?? "") || undefined } : null;
  } catch {
    return decoded ? { state: decoded } : null;
  }
}

function stateCookie(state: string, returnTo = ""): string {
  return [
    `${GOOGLE_STATE_COOKIE}=${encodeStateCookie({ state, return_to: safeReturnPath(returnTo) || undefined })}`,
    "Path=/api/auth/google",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    "Secure",
  ].join("; ");
}

function clearStateCookie(): string {
  return [
    `${GOOGLE_STATE_COOKIE}=`,
    "Path=/api/auth/google",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Secure",
  ].join("; ");
}

function googleAuthError(message: string, status = 400): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Set-Cookie": clearStateCookie(),
  });
  return new Response(
    `<!doctype html><html><body><h1>Google sign-in failed</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to dashboard</a></p></body></html>`,
    { status, headers },
  );
}

export function resolveGoogleRedirectUri(env: Env, requestUrl: string): string {
  return env.GOOGLE_REDIRECT_URI?.trim() || new URL("/api/auth/google/callback", requestUrl).toString();
}

export function allowedGoogleEmails(env: Env): string[] {
  const raw = env.GOOGLE_ALLOWED_EMAILS?.trim() || configuredDashboardOwnerEmail(env);
  return raw
    .split(",")
    .map((email) => normalizeUsername(email))
    .filter(Boolean);
}

export function isGoogleEmailAllowed(env: Env, email: string): boolean {
  const allowed = allowedGoogleEmails(env);
  return allowed.length === 0 || allowed.includes(normalizeUsername(email));
}

export function isGoogleAuthConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function buildGoogleAuthorizationUrl(env: Env, requestUrl: string, state: string): string {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Google OAuth client ID is not configured.");
  const authUrl = new URL(GOOGLE_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", resolveGoogleRedirectUri(env, requestUrl));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");
  return authUrl.toString();
}

export async function authorizeGoogleDashboardLogin(request: Request, env: Env): Promise<Response> {
  if (!isGoogleAuthConfigured(env)) {
    const fallbackUrl = new URL("/", request.url);
    fallbackUrl.searchParams.set("auth_error", "google_not_configured");
    return new Response(null, {
      status: 303,
      headers: {
        Location: fallbackUrl.toString(),
        "Set-Cookie": clearStateCookie(),
      },
    });
  }

  const state = crypto.randomUUID();
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get("return_to"));
  const headers = new Headers({
    Location: buildGoogleAuthorizationUrl(env, request.url, state),
    "Set-Cookie": stateCookie(state, returnTo),
  });
  return new Response(null, { status: 302, headers });
}

export async function handleGoogleDashboardCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error") || url.searchParams.get("error_description");
  if (oauthError) return googleAuthError(oauthError);

  const state = url.searchParams.get("state")?.trim() || "";
  const expectedState = decodeStateCookie(cookieValue(request, GOOGLE_STATE_COOKIE));
  if (!state || !expectedState?.state || state !== expectedState.state) {
    return googleAuthError("Google sign-in state expired or did not match. Please try again.");
  }

  const code = url.searchParams.get("code")?.trim() || "";
  if (!code) return googleAuthError("Google did not return an authorization code.");

  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return googleAuthError("Google OAuth credentials are not configured.", 503);

  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: resolveGoogleRedirectUri(env, request.url),
    grant_type: "authorization_code",
  });
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  const tokenPayload = await tokenResponse.json() as GoogleTokenResponse;
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return googleAuthError(tokenPayload.error_description || tokenPayload.error || "Google token exchange failed.", 502);
  }

  const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  });
  const userInfo = await userInfoResponse.json() as GoogleUserInfoResponse;
  if (!userInfoResponse.ok) {
    return googleAuthError(userInfo.error_description || userInfo.error || "Could not read Google profile.", 502);
  }

  const email = normalizeUsername(userInfo.email);
  const emailVerified = userInfo.email_verified === true || userInfo.email_verified === "true";
  if (!userInfo.sub || !email) return googleAuthError("Google did not return a complete profile.");
  if (!emailVerified) return googleAuthError("Google email must be verified before dashboard sign-in.");
  if (!isGoogleEmailAllowed(env, email)) {
    return googleAuthError(`${email} is not allowed to access this dashboard.`, 403);
  }

  const user = await upsertGoogleDashboardUser(env, {
    sub: userInfo.sub,
    email,
    email_verified: emailVerified,
    name: userInfo.name,
    picture: userInfo.picture,
  });

  const headers = new Headers({ Location: expectedState.return_to || "/" });
  headers.append("Set-Cookie", await createSessionCookie(user, env, true));
  headers.append("Set-Cookie", clearStateCookie());
  return new Response(null, { status: 303, headers });
}
