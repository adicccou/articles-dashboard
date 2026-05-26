import type { Env } from "./types";

export function socialPublishErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (message || fallback).trim().slice(0, 2000) || fallback;
}

export async function socialPostsHaveLastError(env: Env): Promise<boolean> {
  try {
    const columns = await env.DB.prepare("PRAGMA table_info(social_posts)").all<{ name: string }>();
    return (columns.results ?? []).some((column) => String(column.name || "").toLowerCase() === "last_error");
  } catch {
    return false;
  }
}

export async function markLinkedPlannerItemsPublished(env: Env, socialPostId: number, publishedAt: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE planner_items SET status = 'published', scheduled_for = COALESCE(scheduled_for, ?), updated_at = ? WHERE social_post_id = ?",
  )
    .bind(publishedAt, publishedAt, socialPostId)
    .run();
}

export async function markSocialPostsFailed(
  env: Env,
  filters: string[],
  filterValues: unknown[],
  updatedAt: string,
  message?: string,
): Promise<void> {
  if (filters.length === 0) throw new Error("Refusing to mark all social posts failed without a WHERE clause.");
  const assignments = ["status = 'failed'", "updated_at = ?"];
  const values: unknown[] = [updatedAt];
  if (await socialPostsHaveLastError(env)) {
    assignments.push("last_error = ?");
    values.push(socialPublishErrorMessage(message, "Publishing failed"));
  }
  await env.DB.prepare(`UPDATE social_posts SET ${assignments.join(", ")} WHERE ${filters.join(" AND ")}`)
    .bind(...values, ...filterValues)
    .run();
}

export async function markSocialPostFailed(env: Env, socialPostId: number, updatedAt: string, message?: string): Promise<void> {
  await markSocialPostsFailed(env, ["id = ?"], [socialPostId], updatedAt, message);
}
