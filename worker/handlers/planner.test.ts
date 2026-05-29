import { describe, expect, it } from "vitest";
import type { Env } from "../lib/types";
import { updatePlannerItem } from "./planner";

function plannerSyncEnv() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const currentPlannerItem = {
    id: 45,
    title: "Threads post: every small business will eventually have an AI worker",
    description: "every small business will eventually have an AI worker not a chatbot a worker",
    image_url: null,
    item_type: "post",
    platform: "threads",
    status: "planned",
    scheduled_for: "2026-05-29T12:00:00.000Z",
    social_post_id: null,
    account_id: 4,
    instruction: null,
    interval_minutes: null,
    duration_start: null,
    duration_end: null,
    related_strategy_id: null,
  };
  const tableInfo = (table: string) => {
    if (table === "planner_items") {
      return ["id", "title", "description", "image_url", "item_type", "platform", "status", "scheduled_for", "social_post_id", "account_id"];
    }
    if (table === "social_posts") {
      return ["id", "platform", "content", "image_url", "status", "scheduled_at", "account_id", "title", "subreddit", "last_error"];
    }
    return [];
  };
  const env = {
    DB: {
      prepare(sql: string) {
        const all = async () => {
          const match = sql.match(/PRAGMA table_info\(([^)]+)\)/);
          return { results: match ? tableInfo(match[1]).map((name) => ({ name })) : [] };
        };
        return {
          all,
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              all,
              first: async () => {
                if (sql.includes("FROM social_posts sp")) return { id: 36 };
                if (sql.includes("FROM planner_items") && sql.includes("LIMIT 1")) return currentPlannerItem;
                return null;
              },
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, calls };
}

describe("planner social queue sync", () => {
  it("reattaches a legacy unlinked planner post to the matching queued social post when rescheduled", async () => {
    const { env, calls } = plannerSyncEnv();

    const response = await updatePlannerItem(
      env,
      "45",
      new Request("https://oilor.app/api/planner/items/45", {
        method: "PUT",
        body: JSON.stringify({ scheduled_for: "2026-05-29T14:00:00.000Z", status: "planned" }),
      }),
    );

    expect(response.ok).toBe(true);
    const socialUpdate = calls.find((call) => call.sql.includes("UPDATE social_posts SET"));
    expect(socialUpdate?.sql).toContain("last_error = NULL");
    expect(socialUpdate?.values).toContain("threads");
    expect(socialUpdate?.values).toContain("scheduled");
    expect(socialUpdate?.values).toContain("2026-05-29T14:00:00.000Z");
    expect(socialUpdate?.values).toContain(36);

    const plannerUpdate = calls.find((call) => call.sql.includes("UPDATE planner_items SET"));
    expect(plannerUpdate?.sql).toContain("social_post_id = ?");
    expect(plannerUpdate?.values).toContain(36);
  });
});
