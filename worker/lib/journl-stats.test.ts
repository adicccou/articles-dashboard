import { describe, expect, it } from "vitest";
import { summarizeJournlUsers } from "./journl-stats";

describe("summarizeJournlUsers", () => {
  it("aggregates plan, provider, and activity metrics from Supabase auth users", () => {
    const stats = summarizeJournlUsers([
      {
        email: "pro-google@example.com",
        created_at: "2026-06-05T08:00:00.000Z",
        last_sign_in_at: "2026-06-07T10:00:00.000Z",
        app_metadata: {
          provider: "google",
          billing: { subscriptionStatus: "active" },
        },
        user_metadata: { plan: "pro" },
      },
      {
        email: "lifetime-x@example.com",
        created_at: "2026-05-20T08:00:00.000Z",
        last_sign_in_at: "2026-06-02T10:00:00.000Z",
        app_metadata: {
          provider: "twitter",
        },
        user_metadata: { plan: "lifetime" },
      },
      {
        email: "free-email@example.com",
        created_at: "2026-05-01T08:00:00.000Z",
        last_sign_in_at: "2026-04-20T10:00:00.000Z",
        app_metadata: {
          provider: "email",
        },
        user_metadata: { plan: "free" },
      },
      {
        email: "cancelled-pro@example.com",
        created_at: "2026-06-06T08:00:00.000Z",
        last_sign_in_at: "2026-06-06T10:00:00.000Z",
        app_metadata: {
          provider: "google",
          billing: { subscriptionStatus: "cancelled" },
        },
        user_metadata: { plan: "pro" },
      },
      {
        email: "ignored-anon@example.com",
        is_anonymous: true,
        created_at: "2026-06-06T08:00:00.000Z",
        last_sign_in_at: "2026-06-06T10:00:00.000Z",
      },
    ], new Date("2026-06-07T12:00:00.000Z"));

    expect(stats.total_accounts).toBe(4);
    expect(stats.subscriptions).toBe(3);
    expect(stats.pro).toBe(2);
    expect(stats.lifetime).toBe(1);
    expect(stats.free).toBe(1);
    expect(stats.cancelled).toBe(1);
    expect(stats.active_7d).toBe(3);
    expect(stats.active_30d).toBe(3);
    expect(stats.new_7d).toBe(2);
    expect(stats.new_30d).toBe(3);
    expect(stats.plan_breakdown).toEqual([
      { key: "pro", label: "Pro", count: 2, share: 50 },
      { key: "free", label: "Free", count: 1, share: 25 },
      { key: "lifetime", label: "Lifetime", count: 1, share: 25 },
    ]);
    expect(stats.provider_breakdown).toEqual([
      { key: "google", label: "Google", count: 2, share: 50 },
      { key: "email", label: "Email", count: 1, share: 25 },
      { key: "x", label: "X", count: 1, share: 25 },
    ]);
    expect(stats.activity_breakdown).toEqual([
      { key: "active_7d", label: "Signed in within 7 days", count: 3, share: 75 },
      { key: "active_30d", label: "Signed in within 30 days", count: 3, share: 75 },
      { key: "inactive_30d", label: "No sign-in in 30 days", count: 1, share: 25 },
    ]);
  });
});
