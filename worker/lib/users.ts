import type { Env } from "./types";
import type { DashboardUser } from "./ownership";
import { DEFAULT_USER_ID, attachPrimaryWorkspace, ensureDefaultWorkspace, tableHasColumn } from "./ownership";

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

export function configuredDashboardOwnerEmail(env: Env): string {
  return normalizeUsername(env.DASHBOARD_OWNER_EMAIL || "adiccou@gmail.com");
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
    workspace_id: row.workspace_id,
    workspace_role: row.workspace_role,
    workspace: row.workspace,
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

export async function getUserByEmail(env: Env, email: string): Promise<DashboardUser | null> {
  if (!(await usersTableExists(env))) return null;
  const row = await env.DB.prepare("SELECT * FROM dashboard_users WHERE LOWER(email) = LOWER(?)")
    .bind(normalizeUsername(email))
    .first<DashboardUser>();
  return row ? publicUser(row) : null;
}

export async function ensureDefaultUser(env: Env): Promise<DashboardUser> {
  const now = new Date().toISOString();
  const ownerEmail = configuredDashboardOwnerEmail(env);
  const username = ownerEmail || normalizeUsername(env.ADMIN_USERNAME || "admin") || "admin";
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

  if (ownerEmail) {
    try {
      await env.DB.prepare(
        "UPDATE dashboard_users SET email = ?, updated_at = ? WHERE id = ? AND (email IS NULL OR LOWER(email) != LOWER(?))",
      )
        .bind(ownerEmail, now, DEFAULT_USER_ID, ownerEmail)
        .run();
    } catch {
      // Keep auth usable even if an older schema or duplicate email blocks the owner-email sync.
    }
  }

  const user = await getUserById(env, DEFAULT_USER_ID);
  if (!user) throw new Error("Default dashboard user could not be created");
  await ensureDefaultWorkspace(env);
  return attachPrimaryWorkspace(env, user);
}

export type GoogleDashboardProfile = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string | null;
  picture?: string | null;
};

export async function upsertGoogleDashboardUser(env: Env, profile: GoogleDashboardProfile): Promise<DashboardUser> {
  if (!profile.sub?.trim()) throw new Error("Google account did not return a stable subject id.");
  const email = normalizeUsername(profile.email);
  if (!email) throw new Error("Google account did not return an email address.");

  await ensureDefaultUser(env);

  const now = new Date().toISOString();
  const ownerEmail = configuredDashboardOwnerEmail(env);
  const displayName = String(profile.name ?? "").trim() || email;
  const avatarUrl = String(profile.picture ?? "").trim() || null;
  const hasGoogleSub = await tableHasColumn(env, "dashboard_users", "google_sub");
  const hasGoogleEmailVerified = await tableHasColumn(env, "dashboard_users", "google_email_verified");
  const hasAuthProvider = await tableHasColumn(env, "dashboard_users", "auth_provider");

  let target = hasGoogleSub
    ? await env.DB.prepare("SELECT * FROM dashboard_users WHERE google_sub = ?")
      .bind(profile.sub)
      .first<DashboardUser>()
    : null;
  if (!target) {
    target = await env.DB.prepare("SELECT * FROM dashboard_users WHERE LOWER(email) = LOWER(?)")
      .bind(email)
      .first<DashboardUser>();
  }
  if (!target && email === ownerEmail) {
    target = await env.DB.prepare("SELECT * FROM dashboard_users WHERE id = ?")
      .bind(DEFAULT_USER_ID)
      .first<DashboardUser>();
  }

  if (target) {
    const updates = [
      "username = ?",
      "email = ?",
      "display_name = ?",
      "avatar_url = COALESCE(?, avatar_url)",
      "status = 'active'",
      "updated_at = ?",
    ];
    const values: unknown[] = [email, email, displayName, avatarUrl, now];
    if (email === ownerEmail) updates.push("role = 'owner'");
    if (hasGoogleSub) updates.push("google_sub = ?"), values.push(profile.sub);
    if (hasGoogleEmailVerified) updates.push("google_email_verified = ?"), values.push(profile.email_verified ? 1 : 0);
    if (hasAuthProvider) updates.push("auth_provider = ?"), values.push("google");
    values.push(target.id);
    await env.DB.prepare(`UPDATE dashboard_users SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  } else {
    const columns = ["username", "email", "display_name", "avatar_url", "role", "status", "timezone", "created_at", "updated_at"];
    const placeholders = ["?", "?", "?", "?", "?", "'active'", "?", "?", "?"];
    const values: unknown[] = [
      email,
      email,
      displayName,
      avatarUrl,
      email === ownerEmail ? "owner" : "member",
      "Asia/Kuala_Lumpur",
      now,
      now,
    ];
    if (hasGoogleSub) columns.push("google_sub"), placeholders.push("?"), values.push(profile.sub);
    if (hasGoogleEmailVerified) columns.push("google_email_verified"), placeholders.push("?"), values.push(profile.email_verified ? 1 : 0);
    if (hasAuthProvider) columns.push("auth_provider"), placeholders.push("?"), values.push("google");

    await env.DB.prepare(
      `INSERT INTO dashboard_users (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
    )
      .bind(...values)
      .run();
  }

  const user = await getUserByEmail(env, email);
  if (!user) throw new Error("Google dashboard user could not be loaded after sign-in.");
  await ensureDefaultWorkspace(env);
  return attachPrimaryWorkspace(env, user);
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
    if (row?.password_hash && await verifyPassword(password, row.password_hash)) {
      return attachPrimaryWorkspace(env, user);
    }
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
  return Promise.all((rows.results ?? []).map((user) => attachPrimaryWorkspace(env, publicUser(user))));
}
