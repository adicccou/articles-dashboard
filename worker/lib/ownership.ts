import type { Env } from "./types";

export type DashboardUser = {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "inactive";
  timezone: string;
  created_at: string;
  updated_at: string;
  workspace_id?: number;
  workspace_role?: "owner" | "admin" | "member";
  workspace?: DashboardWorkspace;
};

export type DashboardWorkspace = {
  id: number;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived";
  plan: string;
  owner_user_id: number | null;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_USER_ID = 1;
export const DEFAULT_WORKSPACE_ID = 1;

const columnCache = new Map<string, boolean>();

export function ownerId(userId?: number | null): number {
  const parsed = Number(userId ?? DEFAULT_USER_ID);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USER_ID;
}

export function workspaceId(workspaceIdValue?: number | null): number {
  const parsed = Number(workspaceIdValue ?? DEFAULT_WORKSPACE_ID);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WORKSPACE_ID;
}

export function activeScopeId(userOrScope?: DashboardUser | number | null): number {
  if (typeof userOrScope === "object" && userOrScope !== null) {
    return workspaceId(userOrScope.workspace_id ?? DEFAULT_WORKSPACE_ID);
  }
  return workspaceId(userOrScope);
}

export async function tableHasColumn(env: Env, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key) ?? false;
  try {
    const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const hasColumn = (rows.results ?? []).some((row) => row.name === column);
    columnCache.set(key, hasColumn);
    return hasColumn;
  } catch {
    columnCache.set(key, false);
    return false;
  }
}

export async function tableHasUserId(env: Env, table: string): Promise<boolean> {
  return tableHasColumn(env, table, "user_id");
}

export async function tableHasWorkspaceId(env: Env, table: string): Promise<boolean> {
  return tableHasColumn(env, table, "workspace_id");
}

async function tableExists(env: Env, table: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(table)
      .first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

export async function ensureDefaultWorkspace(env: Env): Promise<DashboardWorkspace | null> {
  if (!(await tableExists(env, "workspaces"))) return null;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspaces (
      id, slug, name, status, plan, owner_user_id, timezone, created_at, updated_at
    )
    VALUES (?, 'default', 'Default Workspace', 'active', 'internal', ?, 'Asia/Kuala_Lumpur', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = CASE WHEN workspaces.status = 'archived' THEN 'active' ELSE workspaces.status END,
      updated_at = excluded.updated_at`,
  )
    .bind(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, now, now)
    .run();

  if (await tableExists(env, "workspace_members")) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_members (
        workspace_id, user_id, role, status, created_at, updated_at
      )
      VALUES (?, ?, 'owner', 'active', ?, ?)`,
    )
      .bind(DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, now, now)
      .run();
  }

  return env.DB.prepare("SELECT * FROM workspaces WHERE id = ?")
    .bind(DEFAULT_WORKSPACE_ID)
    .first<DashboardWorkspace>();
}

export async function getPrimaryWorkspaceForUser(
  env: Env,
  userId: number,
): Promise<{ workspace: DashboardWorkspace; role: "owner" | "admin" | "member" } | null> {
  const fallback = await ensureDefaultWorkspace(env);
  if (!(await tableExists(env, "workspace_members")) || !(await tableExists(env, "workspaces"))) {
    return fallback ? { workspace: fallback, role: "owner" } : null;
  }

  const row = await env.DB.prepare(
    `SELECT
       w.id, w.slug, w.name, w.status, w.plan, w.owner_user_id, w.timezone, w.created_at, w.updated_at,
       wm.role AS workspace_role
     FROM workspace_members wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = ? AND wm.status = 'active' AND w.status = 'active'
     ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, w.id ASC
     LIMIT 1`,
  )
    .bind(ownerId(userId))
    .first<DashboardWorkspace & { workspace_role: "owner" | "admin" | "member" }>();

  if (row) {
    const { workspace_role, ...workspace } = row;
    return { workspace, role: workspace_role };
  }

  if (fallback) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO workspace_members (
        workspace_id, user_id, role, status, created_at, updated_at
      )
      VALUES (?, ?, 'member', 'active', ?, ?)`,
    )
      .bind(DEFAULT_WORKSPACE_ID, ownerId(userId), now, now)
      .run();
    return { workspace: fallback, role: ownerId(userId) === DEFAULT_USER_ID ? "owner" : "member" };
  }

  return null;
}

export async function attachPrimaryWorkspace(env: Env, user: DashboardUser): Promise<DashboardUser> {
  const membership = await getPrimaryWorkspaceForUser(env, user.id);
  if (!membership) return user;
  return {
    ...user,
    workspace_id: membership.workspace.id,
    workspace_role: membership.role,
    workspace: membership.workspace,
  };
}

export async function scopedWhere(
  env: Env,
  table: string,
  scopeId?: number | null,
  alias?: string,
): Promise<{ clause: string; values: unknown[] }> {
  const prefix = alias ? `${alias}.` : "";
  if (await tableHasWorkspaceId(env, table)) {
    return { clause: `${prefix}workspace_id = ?`, values: [workspaceId(scopeId)] };
  }
  if (await tableHasUserId(env, table)) {
    return { clause: `${prefix}user_id = ?`, values: [ownerId(scopeId)] };
  }
  return { clause: "", values: [] };
}

export async function appendScopedFilter(
  env: Env,
  table: string,
  filters: string[],
  values: unknown[],
  scopeId?: number | null,
  alias?: string,
): Promise<void> {
  const scoped = await scopedWhere(env, table, scopeId, alias);
  if (scoped.clause) {
    filters.push(scoped.clause);
    values.push(...scoped.values);
  }
}

export async function scopedInsertColumns(
  env: Env,
  table: string,
  scopeId?: number | null,
): Promise<{ columns: string[]; values: unknown[] }> {
  if (await tableHasWorkspaceId(env, table)) {
    return { columns: ["workspace_id"], values: [workspaceId(scopeId)] };
  }
  if (await tableHasUserId(env, table)) {
    return { columns: ["user_id"], values: [ownerId(scopeId)] };
  }
  return { columns: [], values: [] };
}
