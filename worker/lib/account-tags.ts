import type { Env } from "./types";
import { DEFAULT_USER_ID, ownerId, tableHasUserId, tableHasWorkspaceId, workspaceId } from "./ownership";

export type AccountTagNamespace = "social_account" | "reddit_account";

function cleanTag(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 32);
}

export function normalizeAccountTags(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
    ? raw.split(/[,\n]+/)
    : [];
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const tag = cleanTag(value);
    if (!tag || seen.has(tag)) continue;
    tags.push(tag);
    seen.add(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function tagsKey(namespace: AccountTagNamespace, accountId: number): string {
  return `${namespace}:${accountId}:tags`;
}

async function readSetting(env: Env, key: string, userId = DEFAULT_USER_ID): Promise<string> {
  const hasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
  const hasUserId = await tableHasUserId(env, "app_settings");
  const row = await env.DB.prepare(hasWorkspaceId
    ? "SELECT value FROM app_settings WHERE workspace_id = ? AND key = ?"
    : hasUserId
    ? "SELECT value FROM app_settings WHERE user_id = ? AND key = ?"
    : "SELECT value FROM app_settings WHERE key = ?")
    .bind(...(hasWorkspaceId ? [workspaceId(userId), key] : hasUserId ? [ownerId(userId), key] : [key]))
    .first<{ value: string }>();
  return row?.value ?? "";
}

async function upsertSetting(env: Env, key: string, value: string, updatedAt: string, userId = DEFAULT_USER_ID): Promise<void> {
  if (await tableHasWorkspaceId(env, "app_settings")) {
    await env.DB.prepare(
      `INSERT INTO app_settings (workspace_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(workspaceId(userId), key, value, updatedAt)
      .run();
    return;
  }

  if (await tableHasUserId(env, "app_settings")) {
    await env.DB.prepare(
      `INSERT INTO app_settings (user_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(ownerId(userId), key, value, updatedAt)
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, updatedAt)
    .run();
}

export async function readAccountTags(
  env: Env,
  namespace: AccountTagNamespace,
  accountId: number,
  userId = DEFAULT_USER_ID,
): Promise<string[]> {
  const raw = await readSetting(env, tagsKey(namespace, accountId), userId);
  if (!raw.trim()) return [];
  try {
    return normalizeAccountTags(JSON.parse(raw));
  } catch {
    return normalizeAccountTags(raw);
  }
}

export async function upsertAccountTags(
  env: Env,
  namespace: AccountTagNamespace,
  accountId: number,
  rawTags: unknown,
  updatedAt: string,
  userId = DEFAULT_USER_ID,
): Promise<string[]> {
  const tags = normalizeAccountTags(rawTags);
  await upsertSetting(env, tagsKey(namespace, accountId), JSON.stringify(tags), updatedAt, userId);
  return tags;
}
