import type { Env } from "./types";

const encoder = new TextEncoder();

async function sha256(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(value: string, secret: string): Promise<string> {
  return sha256(`${value}.${secret}`);
}

export async function validateSession(request: Request, env: Env): Promise<boolean> {
  const cookie = request.headers.get("Cookie") ?? "";
  const sessionCookie = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("article_dashboard_session="));

  if (!sessionCookie) return false;
  const raw = sessionCookie.split("=")[1];
  if (!raw) return false;

  const decoded = atob(raw);
  const [username, signature] = decoded.split(":");
  if (!username || !signature) return false;

  const expected = await sign(username, env.SESSION_SECRET ?? "dev-session-secret");
  return username === env.ADMIN_USERNAME && expected === signature;
}

export async function createSessionCookie(username: string, env: Env, remember = true): Promise<string> {
  const signature = await sign(username, env.SESSION_SECRET ?? "dev-session-secret");
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
  if (!env.ADMIN_PASSWORD) {
    return password === "changeme";
  }
  return password === env.ADMIN_PASSWORD;
}
