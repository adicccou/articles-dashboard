import type { Env } from "./types";

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
  const sessionSecret = configuredSessionSecret(env);
  if (!sessionSecret) return false;

  const cookie = request.headers.get("Cookie") ?? "";
  const sessionCookie = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("article_dashboard_session="));

  if (!sessionCookie) return false;
  const raw = sessionCookie.slice("article_dashboard_session=".length);
  if (!raw) return false;

  let decoded = "";
  try {
    decoded = atob(raw);
  } catch {
    return false;
  }

  const [username, signature, extra] = decoded.split(":");
  if (extra !== undefined) return false;
  if (!username || !signature) return false;
  if (username !== env.ADMIN_USERNAME) return false;

  const expected = await sign(username, sessionSecret);
  return timingSafeEqual(expected, signature);
}

export async function createSessionCookie(username: string, env: Env, remember = true): Promise<string> {
  const sessionSecret = configuredSessionSecret(env);
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const signature = await sign(username, sessionSecret);
  const value = btoa(`${username}:${signature}`);
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
  if (username !== env.ADMIN_USERNAME) return false;
  if (!env.ADMIN_PASSWORD) return false;
  return timingSafeEqual(password, env.ADMIN_PASSWORD);
}
