import { describe, expect, it } from "vitest";
import type { Env } from "./types";
import { claimSocialPostForPublishing } from "./social-publish";

function envWithClaimResult(changes: number, current?: { status: string; external_id: string | null; account_id: number | null }) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              run: async () => ({ meta: { changes } }),
              first: async () => current ?? null,
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, calls };
}

describe("social publish locking", () => {
  it("claims an unpublished post before external publishing starts", async () => {
    const { env, calls } = envWithClaimResult(1);
    const claim = await claimSocialPostForPublishing(env, ["id = ?", "platform = ?"], [42, "threads"], "2026-05-27T10:00:00.000Z");

    expect(claim).toEqual({ status: "claimed" });
    expect(calls[0]?.sql).toContain("status = 'publishing'");
    expect(calls[0]?.sql).toContain("status NOT IN ('posted', 'publishing')");
    expect(calls[0]?.values).toEqual(["2026-05-27T10:00:00.000Z", 42, "threads"]);
  });

  it("reports in-progress posts instead of letting a second publisher continue", async () => {
    const { env } = envWithClaimResult(0, { status: "publishing", external_id: null, account_id: 4 });
    await expect(claimSocialPostForPublishing(env, ["id = ?"], [42], "2026-05-27T10:00:00.000Z"))
      .resolves.toEqual({ status: "in_progress" });
  });

  it("treats already posted rows as idempotent success", async () => {
    const { env } = envWithClaimResult(0, { status: "posted", external_id: "external-1", account_id: 7 });
    await expect(claimSocialPostForPublishing(env, ["id = ?"], [42], "2026-05-27T10:00:00.000Z"))
      .resolves.toEqual({ status: "already_posted", externalId: "external-1", accountId: 7 });
  });
});
