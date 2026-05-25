import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import type { DashboardUser } from "../lib/ownership";
import type { Env } from "../lib/types";
import { hashPassword, listDashboardUsers, normalizeUsername, publicUser } from "../lib/users";

type UserCreatePayload = {
  username?: string;
  password?: string;
  display_name?: string | null;
  email?: string | null;
  role?: "admin" | "member";
  timezone?: string | null;
};

type ProfileUpdatePayload = {
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  timezone?: string | null;
};

function canManageUsers(user: DashboardUser): boolean {
  return user.role === "owner" || user.role === "admin";
}

export async function getProfile(user: DashboardUser): Promise<Response> {
  return jsonResponse(publicUser(user));
}

export async function updateProfile(env: Env, user: DashboardUser, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<ProfileUpdatePayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.display_name !== undefined) {
      updates.push("display_name = ?");
      values.push(String(payload.display_name ?? "").trim() || user.username);
    }
    if (payload.email !== undefined) {
      updates.push("email = ?");
      values.push(String(payload.email ?? "").trim() || null);
    }
    if (payload.avatar_url !== undefined) {
      updates.push("avatar_url = ?");
      values.push(String(payload.avatar_url ?? "").trim() || null);
    }
    if (payload.timezone !== undefined) {
      updates.push("timezone = ?");
      values.push(String(payload.timezone ?? "").trim() || "Asia/Kuala_Lumpur");
    }

    if (updates.length === 0) return errorResponse("No profile fields to update", 400);

    const now = new Date().toISOString();
    updates.push("updated_at = ?");
    values.push(now, user.id);
    await env.DB.prepare(`UPDATE dashboard_users SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    const updated = await env.DB.prepare("SELECT * FROM dashboard_users WHERE id = ?")
      .bind(user.id)
      .first<DashboardUser>();
    return jsonResponse(updated ? publicUser(updated) : { ...user, updated_at: now });
  } catch {
    return errorResponse("Failed to update profile", 500);
  }
}

export async function listUsers(env: Env, user: DashboardUser): Promise<Response> {
  if (!canManageUsers(user)) return errorResponse("Only admins can manage users", 403);
  return jsonResponse(await listDashboardUsers(env));
}

export async function createUser(env: Env, user: DashboardUser, request: Request): Promise<Response> {
  try {
    if (!canManageUsers(user)) return errorResponse("Only admins can create users", 403);
    const payload = await parseJson<UserCreatePayload>(request);
    const username = normalizeUsername(payload.username);
    const password = String(payload.password ?? "");
    if (!username) return errorResponse("Username is required", 400);
    if (password.length < 8) return errorResponse("Password must be at least 8 characters", 400);

    const now = new Date().toISOString();
    const created = await env.DB.prepare(
      `INSERT INTO dashboard_users (
        username, password_hash, display_name, email, role, status, timezone, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
      RETURNING id, username, display_name, email, avatar_url, role, status, timezone, created_at, updated_at`,
    )
      .bind(
        username,
        await hashPassword(password),
        String(payload.display_name ?? "").trim() || username,
        String(payload.email ?? "").trim() || null,
        payload.role === "admin" ? "admin" : "member",
        String(payload.timezone ?? "").trim() || "Asia/Kuala_Lumpur",
        now,
        now,
      )
      .first<DashboardUser>();

    return jsonResponse(created ? publicUser(created) : { username }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message.toLowerCase().includes("unique")
      ? "Username or email already exists"
      : "Failed to create user";
    return errorResponse(message, 500);
  }
}
