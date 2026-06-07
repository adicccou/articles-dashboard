import type { Env, JournlBreakdownItem, JournlStats } from "./types";

const JOURNL_SUPABASE_URL = "https://lgzikhbuutggpkdxalfk.supabase.co";
const USERS_PER_PAGE = 1000;
const MAX_PAGES = 50;

type JournlPlan = "free" | "pro" | "lifetime";

type JournlAuthIdentity = {
  provider?: string | null;
};

type JournlAuthUser = {
  app_metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  email?: string | null;
  identities?: JournlAuthIdentity[] | null;
  is_anonymous?: boolean | null;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeJournlPlan(value: unknown): JournlPlan {
  return value === "pro" || value === "lifetime" ? value : "free";
}

function normalizeProvider(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "twitter") return "x";
  return normalized;
}

function providerLabel(provider: string): string {
  if (provider === "x") return "X";
  if (provider === "google") return "Google";
  if (provider === "email") return "Email";
  if (provider === "apple") return "Apple";
  if (provider === "github") return "GitHub";
  if (provider === "linkedin") return "LinkedIn";
  if (provider === "unknown") return "Unknown";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function planLabel(plan: string): string {
  if (plan === "free") return "Free";
  if (plan === "pro") return "Pro";
  if (plan === "lifetime") return "Lifetime";
  return plan;
}

function parseIsoDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isWithinDays(value: string | null | undefined, now: number, days: number): boolean {
  const timestamp = parseIsoDate(value);
  if (timestamp === null) return false;
  return timestamp >= now - (days * 24 * 60 * 60 * 1000);
}

function percent(count: number, total: number): number {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function toBreakdownItems(counts: Map<string, number>, total: number, labelForKey: (key: string) => string): JournlBreakdownItem[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || labelForKey(left[0]).localeCompare(labelForKey(right[0])))
    .map(([key, count]) => ({
      key,
      label: labelForKey(key),
      count,
      share: percent(count, total),
    }));
}

function extractPlan(user: JournlAuthUser): JournlPlan {
  const userMetadata = asRecord(user.user_metadata);
  const appMetadata = asRecord(user.app_metadata);
  return normalizeJournlPlan(userMetadata?.plan ?? appMetadata?.plan);
}

function extractSubscriptionStatus(user: JournlAuthUser): string | null {
  const userMetadata = asRecord(user.user_metadata);
  const appMetadata = asRecord(user.app_metadata);
  const userBilling = asRecord(userMetadata?.billing);
  const appBilling = asRecord(appMetadata?.billing);
  const raw = userBilling?.subscriptionStatus ?? appBilling?.subscriptionStatus;
  return typeof raw === "string" ? raw.toLowerCase() : null;
}

function extractProvider(user: JournlAuthUser): string {
  const appMetadata = asRecord(user.app_metadata);
  const provider = typeof appMetadata?.provider === "string"
    ? appMetadata.provider
    : Array.isArray(appMetadata?.providers) && typeof appMetadata.providers[0] === "string"
      ? String(appMetadata.providers[0])
      : Array.isArray(user.identities) && typeof user.identities[0]?.provider === "string"
        ? String(user.identities[0]?.provider)
        : user.email
          ? "email"
          : "unknown";
  return normalizeProvider(provider);
}

export function summarizeJournlUsers(users: JournlAuthUser[], now = new Date()): JournlStats {
  const activeUsers = users.filter((user) => !user.is_anonymous);
  const providerCounts = new Map<string, number>();
  const planCounts = new Map<string, number>();
  const nowMs = now.getTime();

  let totalAccounts = 0;
  let subscriptions = 0;
  let pro = 0;
  let lifetime = 0;
  let free = 0;
  let cancelled = 0;
  let active7d = 0;
  let active30d = 0;
  let new7d = 0;
  let new30d = 0;

  for (const user of activeUsers) {
    totalAccounts += 1;

    const plan = extractPlan(user);
    const provider = extractProvider(user);
    const subscriptionStatus = extractSubscriptionStatus(user);

    planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1);
    providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);

    if (plan === "pro") {
      pro += 1;
      subscriptions += 1;
    } else if (plan === "lifetime") {
      lifetime += 1;
      subscriptions += 1;
    } else {
      free += 1;
    }

    if (plan === "pro" && subscriptionStatus === "cancelled") {
      cancelled += 1;
    }
    if (isWithinDays(user.last_sign_in_at, nowMs, 7)) active7d += 1;
    if (isWithinDays(user.last_sign_in_at, nowMs, 30)) active30d += 1;
    if (isWithinDays(user.created_at, nowMs, 7)) new7d += 1;
    if (isWithinDays(user.created_at, nowMs, 30)) new30d += 1;
  }

  return {
    total_accounts: totalAccounts,
    subscriptions,
    pro,
    lifetime,
    free,
    cancelled,
    active_7d: active7d,
    active_30d: active30d,
    new_7d: new7d,
    new_30d: new30d,
    plan_breakdown: toBreakdownItems(planCounts, totalAccounts, planLabel),
    provider_breakdown: toBreakdownItems(providerCounts, totalAccounts, providerLabel),
    activity_breakdown: [
      {
        key: "active_7d",
        label: "Signed in within 7 days",
        count: active7d,
        share: percent(active7d, totalAccounts),
      },
      {
        key: "active_30d",
        label: "Signed in within 30 days",
        count: active30d,
        share: percent(active30d, totalAccounts),
      },
      {
        key: "inactive_30d",
        label: "No sign-in in 30 days",
        count: Math.max(totalAccounts - active30d, 0),
        share: percent(Math.max(totalAccounts - active30d, 0), totalAccounts),
      },
    ],
  };
}

export async function fetchJournlStats(env: Env): Promise<JournlStats> {
  const serviceRoleKey = env.JOURNL_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("JOURNL_SERVICE_ROLE_KEY not configured");
  }

  const users: JournlAuthUser[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL("/auth/v1/admin/users", JOURNL_SUPABASE_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(USERS_PER_PAGE));

    const response = await fetch(url.toString(), {
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase error: ${await response.text()}`);
    }

    const payload = await response.json() as { users?: JournlAuthUser[] };
    const batch = Array.isArray(payload.users) ? payload.users : [];
    users.push(...batch);

    if (batch.length < USERS_PER_PAGE) {
      return summarizeJournlUsers(users);
    }
  }

  throw new Error(`Supabase error: Journl user export exceeded ${MAX_PAGES} pages`);
}
