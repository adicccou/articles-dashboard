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
};

export const DEFAULT_USER_ID = 1;

const userColumnCache = new Map<string, boolean>();

export function ownerId(userId?: number | null): number {
  const parsed = Number(userId ?? DEFAULT_USER_ID);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USER_ID;
}

export async function tableHasUserId(env: Env, table: string): Promise<boolean> {
  const key = `${table}.user_id`;
  if (userColumnCache.has(key)) return userColumnCache.get(key) ?? false;
  try {
    const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const hasColumn = (rows.results ?? []).some((row) => row.name === "user_id");
    userColumnCache.set(key, hasColumn);
    return hasColumn;
  } catch {
    userColumnCache.set(key, false);
    return false;
  }
}

export async function scopedWhere(
  env: Env,
  table: string,
  userId?: number | null,
  alias?: string,
): Promise<{ clause: string; values: unknown[] }> {
  if (!(await tableHasUserId(env, table))) return { clause: "", values: [] };
  const prefix = alias ? `${alias}.` : "";
  return { clause: `${prefix}user_id = ?`, values: [ownerId(userId)] };
}

export async function appendScopedFilter(
  env: Env,
  table: string,
  filters: string[],
  values: unknown[],
  userId?: number | null,
  alias?: string,
): Promise<void> {
  const scoped = await scopedWhere(env, table, userId, alias);
  if (scoped.clause) {
    filters.push(scoped.clause);
    values.push(...scoped.values);
  }
}

export async function scopedInsertColumns(
  env: Env,
  table: string,
  userId?: number | null,
): Promise<{ columns: string[]; values: unknown[] }> {
  if (!(await tableHasUserId(env, table))) return { columns: [], values: [] };
  return { columns: ["user_id"], values: [ownerId(userId)] };
}
