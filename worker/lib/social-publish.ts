import type { Env } from "./types";

export function socialPublishErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (message || fallback).trim().slice(0, 2000) || fallback;
}

export function isTransientPublishInfrastructureError(error: unknown): boolean {
  const message = socialPublishErrorMessage(error, "").toLowerCase();
  return /\bd1_error\b|storage operation exceeded timeout|object to be reset|network connection lost|fetch failed|request timed out|timeout/.test(message);
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

export type SocialPostPublishClaim =
  | { status: "claimed" }
  | { status: "already_posted"; externalId: string; accountId: number | null }
  | { status: "in_progress" }
  | { status: "unavailable"; message: string };

export async function claimSocialPostForPublishing(
  env: Env,
  filters: string[],
  filterValues: unknown[],
  updatedAt: string,
): Promise<SocialPostPublishClaim> {
  if (filters.length === 0) throw new Error("Refusing to claim all social posts without a WHERE clause.");

  const claim = await env.DB.prepare(
    `UPDATE social_posts
     SET status = 'publishing', updated_at = ?
     WHERE ${filters.join(" AND ")}
       AND status NOT IN ('posted', 'publishing')`,
  )
    .bind(updatedAt, ...filterValues)
    .run() as { meta?: { changes?: number } };

  if (Number(claim.meta?.changes ?? 0) > 0) return { status: "claimed" };

  const current = await env.DB.prepare(
    `SELECT status, external_id, account_id
     FROM social_posts
     WHERE ${filters.join(" AND ")}
     LIMIT 1`,
  )
    .bind(...filterValues)
    .first<{ status: string; external_id: string | null; account_id: number | null }>();

  if (!current) return { status: "unavailable", message: "Social post not found." };
  if (current.status === "posted" && current.external_id?.trim()) {
    return { status: "already_posted", externalId: current.external_id.trim(), accountId: current.account_id ?? null };
  }
  if (current.status === "posted") return { status: "unavailable", message: "Post is already published." };
  if (current.status === "publishing") return { status: "in_progress" };
  return { status: "unavailable", message: `Post is not publishable from status "${current.status}".` };
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

export async function requeueSocialPostAfterTransientFailure(
  env: Env,
  socialPostId: number,
  updatedAt: string,
  message?: string,
): Promise<void> {
  const assignments = ["status = 'scheduled'", "updated_at = ?"];
  const values: unknown[] = [updatedAt];
  if (await socialPostsHaveLastError(env)) {
    assignments.push("last_error = ?");
    values.push(socialPublishErrorMessage(message, "Transient publishing failure; will retry."));
  }
  await env.DB.prepare(
    `UPDATE social_posts
     SET ${assignments.join(", ")}
     WHERE id = ?
       AND status IN ('scheduled', 'publishing', 'failed')`,
  )
    .bind(...values, socialPostId)
    .run();
}
