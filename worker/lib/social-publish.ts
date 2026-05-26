import type { Env } from "./types";

export async function markLinkedPlannerItemsPublished(env: Env, socialPostId: number, publishedAt: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE planner_items SET status = 'published', scheduled_for = COALESCE(scheduled_for, ?), updated_at = ? WHERE social_post_id = ?",
  )
    .bind(publishedAt, publishedAt, socialPostId)
    .run();
}

export async function markSocialPostFailed(env: Env, socialPostId: number, updatedAt: string): Promise<void> {
  await env.DB.prepare("UPDATE social_posts SET status = 'failed', updated_at = ? WHERE id = ?")
    .bind(updatedAt, socialPostId)
    .run();
}
