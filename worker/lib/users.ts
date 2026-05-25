import type { Env } from "./types";
import type { DashboardUser } from "./ownership";
import { DEFAULT_USER_ID } from "./ownership";

const PASSWORD_HASH_PREFIX = "pbkdf2-sha256";
const PASSWORD_ITERATIONS = 120000;
const encoder = new TextEncoder();

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function timingSafeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

export function normalizeUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function publicUser(row: DashboardUser): DashboardUser {
  return {
    id: Number(row.id),
    username: row.username,
    display_name: row.display_name || row.username,
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    role: row.role,
    status: row.status,
    timezone: row.timezone || "Asia/Kuala_Lumpur",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function usersTableExists(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_users'")
      .first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

export async function getUserById(env: Env, id: number): Promise<DashboardUser | null> {
  if (!(await usersTableExists(env))) return null;
  const row = await env.DB.prepare("SELECT * FROM dashboard_users WHERE id = ?")
    .bind(id)
    .first<DashboardUser>();
  return row ? publicUser(row) : null;
}

export async function getUserByUsername(env: Env, username: string): Promise<DashboardUser | null> {
  if (!(await usersTableExists(env))) return null;
  const row = await env.DB.prepare("SELECT * FROM dashboard_users WHERE LOWER(username) = LOWER(?)")
    .bind(username)
    .first<DashboardUser>();
  return row ? publicUser(row) : null;
}

export async function ensureDefaultUser(env: Env): Promise<DashboardUser> {
  const now = new Date().toISOString();
  const username = normalizeUsername(env.ADMIN_USERNAME || "admin") || "admin";
  if (!(await usersTableExists(env))) {
    return {
      id: DEFAULT_USER_ID,
      username,
      display_name: username,
      email: null,
      avatar_url: null,
      role: "owner",
      status: "active",
      timezone: "Asia/Kuala_Lumpur",
      created_at: now,
      updated_at: now,
    };
  }

  await env.DB.prepare(
    `INSERT INTO dashboard_users (
      id, username, display_name, role, status, timezone, created_at, updated_at
    )
    VALUES (?, ?, ?, 'owner', 'active', 'Asia/Kuala_Lumpur', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      display_name = COALESCE(NULLIF(dashboard_users.display_name, ''), excluded.display_name),
      role = CASE WHEN dashboard_users.role = 'owner' THEN dashboard_users.role ELSE 'owner' END,
      status = 'active',
      updated_at = excluded.updated_at`,
  )
    .bind(DEFAULT_USER_ID, username, username, now, now)
    .run();

  const user = await getUserById(env, DEFAULT_USER_ID);
  if (!user) throw new Error("Default dashboard user could not be created");
  return user;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: exactArrayBuffer(salt),
      iterations: PASSWORD_ITERATIONS,
    },
    key,
    256,
  );
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  if (!passwordHash) return false;
  const [prefix, iterationValue, saltValue, hashValue] = passwordHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !iterationValue || !saltValue || !hashValue) return false;
  const iterations = Number(iterationValue);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = base64ToBytes(saltValue);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: exactArrayBuffer(salt), iterations },
    key,
    256,
  );
  return timingSafeEqual(bytesToBase64(new Uint8Array(bits)), hashValue);
}

export async function authenticateDashboardUser(
  env: Env,
  usernameInput: string,
  password: string,
): Promise<DashboardUser | null> {
  const username = normalizeUsername(usernameInput);
  if (!username || !password) return null;

  const user = await getUserByUsername(env, username);
  if (user?.status === "active") {
    const row = await env.DB.prepare("SELECT password_hash FROM dashboard_users WHERE id = ?")
      .bind(user.id)
      .first<{ password_hash: string | null }>();
    if (row?.password_hash && await verifyPassword(password, row.password_hash)) return user;
  }

  if (username === normalizeUsername(env.ADMIN_USERNAME) && env.ADMIN_PASSWORD && timingSafeEqual(password, env.ADMIN_PASSWORD)) {
    return ensureDefaultUser(env);
  }

  return null;
}

export async function listDashboardUsers(env: Env): Promise<DashboardUser[]> {
  await ensureDefaultUser(env);
  if (!(await usersTableExists(env))) return [await ensureDefaultUser(env)];
  const rows = await env.DB.prepare(
    `SELECT id, username, display_name, email, avatar_url, role, status, timezone, created_at, updated_at
     FROM dashboard_users
     ORDER BY created_at ASC, id ASC`,
  ).all<DashboardUser>();
  return (rows.results ?? []).map(publicUser);
}
