import type { Env } from "./types";
import type { DashboardUser } from "./ownership";
import { attachPrimaryWorkspace } from "./ownership";
import { authenticateDashboardUser, ensureDefaultUser, getUserById, normalizeUsername } from "./users";

const encoder = new TextEncoder();

async function hmacSha256(input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buffer = await crypto.subtle.sign("HMAC", key, encoder.encode(input));
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(value: string, secret: string): Promise<string> {
  return hmacSha256(value, secret);
}

function configuredSessionSecret(env: Env): string | null {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret || secret === "dev-session-secret" || secret === "replace-me") {
    return null;
  }
  return secret;
}

function timingSafeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

export async function validateSession(request: Request, env: Env): Promise<boolean> {
  return Boolean(await getSessionUser(request, env));
}

export async function getSessionUser(request: Request, env: Env): Promise<DashboardUser | null> {
  const sessionSecret = configuredSessionSecret(env);
  if (!sessionSecret) return null;

  const cookie = request.headers.get("Cookie") ?? "";
  const sessionCookie = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("article_dashboard_session="));

  if (!sessionCookie) return null;
  const raw = sessionCookie.slice("article_dashboard_session=".length);
  if (!raw) return null;

  let decoded = "";
  try {
    decoded = atob(raw);
  } catch {
    return null;
  }

  const parts = decoded.split(":");
  if (parts.length === 3) {
    const [idValue, username, signature] = parts;
    const id = Number(idValue);
    if (!Number.isFinite(id) || !username || !signature) return null;
    const expected = await sign(`${id}:${username}`, sessionSecret);
    if (!timingSafeEqual(expected, signature)) return null;
    const user = await getUserById(env, id);
    if (user?.status === "active" && normalizeUsername(user.username) === normalizeUsername(username)) {
      return attachPrimaryWorkspace(env, user);
    }
    if (id === 1) {
      const defaultUser = await ensureDefaultUser(env);
      return normalizeUsername(defaultUser.username) === normalizeUsername(username) ? defaultUser : null;
    }
    return null;
  }

  const [username, signature, extra] = parts;
  if (extra !== undefined) return null;
  if (!username || !signature) return null;
  if (normalizeUsername(username) !== normalizeUsername(env.ADMIN_USERNAME)) return null;

  const expected = await sign(username, sessionSecret);
  if (!timingSafeEqual(expected, signature)) return null;
  return ensureDefaultUser(env);
}

export async function createSessionCookie(userOrUsername: DashboardUser | string, env: Env, remember = true): Promise<string> {
  const sessionSecret = configuredSessionSecret(env);
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const user = typeof userOrUsername === "string"
    ? await ensureDefaultUser(env)
    : userOrUsername;
  const payload = `${user.id}:${user.username}`;
  const signature = await sign(payload, sessionSecret);
  const value = btoa(`${payload}:${signature}`);
  const parts = [
    `article_dashboard_session=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
  ];
  if (remember) parts.push("Max-Age=604800");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  return [
    "article_dashboard_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Secure",
  ].join("; ");
}

export async function checkCredentials(
  username: string,
  password: string,
  env: Env,
): Promise<boolean> {
  return Boolean(await authenticateDashboardUser(env, username, password));
}
