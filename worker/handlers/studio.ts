import type { Env } from "../lib/types";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { getSocialPostSchemaCapabilities } from "./twitter";
import { plannerHasSocialPostLinks } from "./planner";

type StudioStatus = "active" | "inactive" | "archived";
type StudioCampaignType = "post" | "reply";
type StudioCampaignStatus = "active" | "paused" | "archived";
type StudioCrawlerStatus = "pending" | "running" | "completed" | "failed";
type StudioPostStatus = "suggested" | "asset_needed" | "scheduled" | "posted" | "dismissed";
type StudioSignalStatus = "candidate" | "filtered" | "signal" | "rejected";

type StudioAppPayload = {
  name?: string;
  website_url?: string | null;
  app_store_url?: string | null;
  description?: string | null;
  ai_context?: string | null;
  status?: StudioStatus;
};

type StudioCampaignPayload = {
  app_id?: number;
  name?: string;
  campaign_type?: StudioCampaignType;
  account_refs?: unknown;
  platforms?: unknown;
  instructions?: string | null;
  status?: StudioCampaignStatus;
};

type StudioCrawlerPayload = {
  campaign_id?: number | null;
  app_id?: number;
  campaign_type?: StudioCampaignType;
  account_refs?: unknown;
  platforms?: unknown;
  instructions?: string | null;
  status?: StudioCrawlerStatus;
  crawler_summary?: string | null;
  raw_data?: unknown;
  signals?: StudioSignalPayload[];
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

type StudioSignalPayload = {
  platform?: string;
  source?: string;
  query?: string;
  title?: string;
  url?: string | null;
  author?: string | null;
  snippet?: string;
  pain_point?: string;
  audience?: string;
  evidence?: string;
  opportunity_score?: number;
  noise_reason?: string | null;
  status?: StudioSignalStatus;
  raw_data?: unknown;
};

type StudioSignalsBulkPayload = {
  crawler_run_id?: number;
  signals?: StudioSignalPayload[];
  replace_existing?: boolean;
  crawler_summary?: string | null;
  raw_data?: unknown;
  status?: StudioCrawlerStatus;
};

type StudioStrategistPostPayload = {
  platform?: string;
  post_text?: string;
  idea?: string;
  rationale?: string;
  target_url?: string | null;
  target_external_id?: string | null;
  target_author?: string | null;
  target_text?: string | null;
  media_type?: "none" | "photo" | "video";
  media_url?: string | null;
  status?: StudioPostStatus;
  social_post_id?: number | null;
  planner_item_id?: number | null;
  scheduled_at?: string | null;
};

type StudioStrategistBulkPayload = {
  crawler_run_id?: number;
  posts?: StudioStrategistPostPayload[];
};

type StudioNotificationPayload = {
  status?: "pending" | "sent" | "failed";
  error_message?: string | null;
};

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "Twitter",
  threads: "Threads",
  reddit: "Reddit",
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePlatform(platform: unknown): string {
  const value = String(platform ?? "").trim().toLowerCase();
  if (value === "x" || value === "twitter/x") return "twitter";
  if (value === "thread") return "threads";
  return value;
}

function normalizePlatforms(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim().startsWith("[")
      ? safeParseJson(value, [])
      : typeof value === "string"
        ? value.split(",")
        : [];
  const seen = new Set<string>();
  const platforms: string[] = [];
  for (const item of source) {
    const platform = normalizePlatform(item);
    if (!platform || !["twitter", "threads", "reddit"].includes(platform) || seen.has(platform)) continue;
    seen.add(platform);
    platforms.push(platform);
  }
  return platforms;
}

function normalizeRefs(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim().startsWith("[")
      ? safeParseJson(value, [])
      : typeof value === "string"
        ? value.split(",")
        : [];
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const item of source) {
    const ref = String(item ?? "").trim().toLowerCase();
    if (!/^(twitter|threads|reddit):\d+$/.test(ref) || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? []);
}

function decodeList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : safeParseJson<string[]>(value, []);
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSignalStatus(value: unknown): StudioSignalStatus {
  return value === "candidate" || value === "filtered" || value === "rejected" ? value : "signal";
}

function normalizeOpportunityScore(value: unknown): number {
  const score = Number(value ?? 0);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function accountIdForPlatform(accountRefs: string[], platform: string): number | null {
  const prefix = `${normalizePlatform(platform)}:`;
  const ref = accountRefs.find((value) => value.startsWith(prefix));
  if (!ref) return null;
  const id = Number(ref.slice(prefix.length));
  return Number.isFinite(id) && id > 0 ? id : null;
}

function extractSubreddit(value: unknown): string | null {
  const text = String(value ?? "");
  const prefixed = text.match(/\br\/([A-Za-z0-9_]{2,21})\b/i);
  if (prefixed?.[1]) return prefixed[1];
  const labelled = text.match(/\bsubreddit\s*[:=]\s*([A-Za-z0-9_]{2,21})\b/i);
  if (labelled?.[1]) return labelled[1];
  return null;
}

function mapApp(row: Record<string, unknown>) {
  return {
    ...row,
    website_url: row.website_url ?? "",
    app_store_url: row.app_store_url ?? "",
    description: row.description ?? "",
    ai_context: row.ai_context ?? "",
  };
}

function mapCampaign(row: Record<string, unknown>) {
  return {
    ...row,
    campaign_type: row.campaign_type || "post",
    account_refs: decodeList(row.account_refs),
    platforms: decodeList(row.platforms),
  };
}

function mapCrawlerRun(row: Record<string, unknown>) {
  return {
    ...row,
    campaign_type: row.campaign_type || "post",
    account_refs: decodeList(row.account_refs),
    platforms: decodeList(row.platforms),
    raw_data: safeParseJson(row.raw_data, null),
  };
}

function mapSignal(row: Record<string, unknown>) {
  return {
    ...row,
    platform: normalizePlatform(row.platform),
    source: row.source ?? "",
    query: row.query ?? "",
    title: row.title ?? "",
    url: row.url ?? "",
    author: row.author ?? "",
    snippet: row.snippet ?? "",
    pain_point: row.pain_point ?? "",
    audience: row.audience ?? "",
    evidence: row.evidence ?? "",
    opportunity_score: normalizeOpportunityScore(row.opportunity_score),
    noise_reason: row.noise_reason ?? "",
    raw_data: safeParseJson(row.raw_data, null),
  };
}

function mapStrategistPost(row: Record<string, unknown>) {
  return {
    ...row,
    media_url: row.media_url ?? "",
    target_url: row.target_url ?? "",
    target_external_id: row.target_external_id ?? "",
    target_author: row.target_author ?? "",
    target_text: row.target_text ?? "",
  };
}

async function replaceSignalsForRun(
  env: Env,
  run: Record<string, unknown>,
  signals: StudioSignalPayload[],
  now: string,
  replaceExisting = true,
): Promise<number[]> {
  const runId = Number(run.id);
  const campaignId = run.campaign_id ?? null;
  const appId = Number(run.app_id);
  const runPlatforms = decodeList(run.platforms);
  const createdIds: number[] = [];
  if (replaceExisting) {
    await env.DB.prepare("DELETE FROM studio_signals WHERE crawler_run_id = ?").bind(runId).run();
  }
  for (const signal of signals.slice(0, 100)) {
    const platform = normalizePlatform(signal.platform) || runPlatforms[0] || "threads";
    if (!["twitter", "threads", "reddit"].includes(platform)) continue;
    const title = cleanText(signal.title);
    const snippet = cleanText(signal.snippet);
    const painPoint = cleanText(signal.pain_point);
    const evidence = cleanText(signal.evidence);
    if (!title && !snippet && !painPoint && !evidence) continue;
    const result = await env.DB.prepare(
      `INSERT INTO studio_signals (
        crawler_run_id, campaign_id, app_id, platform, source, query, title, url, author,
        snippet, pain_point, audience, evidence, opportunity_score, noise_reason, status,
        raw_data, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        runId,
        campaignId,
        appId,
        platform,
        cleanText(signal.source),
        cleanText(signal.query),
        title,
        cleanText(signal.url) || null,
        cleanText(signal.author) || null,
        snippet,
        painPoint,
        cleanText(signal.audience),
        evidence,
        normalizeOpportunityScore(signal.opportunity_score),
        cleanText(signal.noise_reason) || null,
        normalizeSignalStatus(signal.status),
        signal.raw_data === undefined ? null : JSON.stringify(signal.raw_data),
        now,
        now,
      )
      .run() as { meta: { last_row_id: number } };
    createdIds.push(result.meta.last_row_id);
  }
  return createdIds;
}

async function readWorkspaceTimeZone(env: Env): Promise<string> {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'workspace_timezone'")
      .first<{ value: string }>();
    return row?.value?.trim() || "Asia/Kuala_Lumpur";
  } catch {
    return "Asia/Kuala_Lumpur";
  }
}

function timeZoneParts(date: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = timeZoneParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const parts = timeZoneParts(new Date(utcGuess), timeZone);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  return new Date(utcGuess - (zonedAsUtc - utcGuess));
}

async function socialPostsHaveReplyTargets(env: Env): Promise<boolean> {
  const capabilities = await getSocialPostSchemaCapabilities(env);
  return capabilities.hasReplyToId;
}

async function chooseAutoSchedule(
  env: Env,
  accountId: number | null,
  campaignType: StudioCampaignType,
): Promise<string> {
  const timeZone = await readWorkspaceTimeZone(env);
  const now = new Date();
  const minLead = new Date(now.getTime() + 45 * 60 * 1000);
  const hasReplyToId = await socialPostsHaveReplyTargets(env);
  const accountWhere = accountId ? "account_id = ?" : "account_id IS NULL";
  const socialTypeWhere = hasReplyToId
    ? campaignType === "reply"
      ? "reply_to_id IS NOT NULL"
      : "reply_to_id IS NULL"
    : "1 = 1";
  const activeSocialRows = accountId
    ? await env.DB.prepare(
      `SELECT scheduled_at AS value
       FROM social_posts
       WHERE scheduled_at IS NOT NULL
         AND status IN ('scheduled', 'approved')
         AND ${accountWhere}
         AND ${socialTypeWhere}`,
    ).bind(accountId).all<{ value: string }>()
    : await env.DB.prepare(
      `SELECT scheduled_at AS value
       FROM social_posts
       WHERE scheduled_at IS NOT NULL
         AND status IN ('scheduled', 'approved')
         AND ${accountWhere}
         AND ${socialTypeWhere}`,
    ).all<{ value: string }>();
  const hasSocialPostLinks = await plannerHasSocialPostLinks(env);
  const plannerRows = accountId
    ? await env.DB.prepare(
      `SELECT scheduled_for AS value
       FROM planner_items
       WHERE scheduled_for IS NOT NULL
         AND status IN ('planned', 'drafting', 'approved')
         AND account_id = ?
         ${hasSocialPostLinks ? "AND social_post_id IS NULL" : ""}`,
    ).bind(accountId).all<{ value: string }>()
    : await env.DB.prepare(
      `SELECT scheduled_for AS value
       FROM planner_items
       WHERE scheduled_for IS NOT NULL
         AND status IN ('planned', 'drafting', 'approved')
         AND account_id IS NULL
         ${hasSocialPostLinks ? "AND social_post_id IS NULL" : ""}`,
    ).all<{ value: string }>();
  const byDay = new Map<string, Date[]>();
  for (const row of [...(activeSocialRows.results ?? []), ...(plannerRows.results ?? [])]) {
    const parsed = new Date(row.value);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = localDateKey(parsed, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), parsed]);
  }

  const nowParts = timeZoneParts(now, timeZone);
  const baseLocalDay = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, 0, 0, 0, 0));
  const hours = campaignType === "reply"
    ? [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    : [10, 13, 16];
  const maxPerDay = campaignType === "reply" ? 10 : 1;
  const minGapMs = campaignType === "reply" ? 60 * 60 * 1000 : 0;
  for (let offset = 0; offset < 30; offset += 1) {
    const localDay = new Date(baseLocalDay);
    localDay.setUTCDate(baseLocalDay.getUTCDate() + offset);
    const year = localDay.getUTCFullYear();
    const month = localDay.getUTCMonth() + 1;
    const day = localDay.getUTCDate();
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayItems = (byDay.get(key) ?? []).sort((left, right) => left.getTime() - right.getTime());
    if (dayItems.length >= maxPerDay) continue;
    for (const hour of hours) {
      const candidate = zonedDateTimeToUtc(year, month, day, hour, 0, timeZone);
      if (candidate <= minLead) continue;
      if (minGapMs && dayItems.some((item) => Math.abs(item.getTime() - candidate.getTime()) < minGapMs)) continue;
      return candidate.toISOString();
    }
  }

  const fallbackDay = new Date(baseLocalDay);
  fallbackDay.setUTCDate(baseLocalDay.getUTCDate() + 31);
  return zonedDateTimeToUtc(
    fallbackDay.getUTCFullYear(),
    fallbackDay.getUTCMonth() + 1,
    fallbackDay.getUTCDate(),
    10,
    0,
    timeZone,
  ).toISOString();
}

async function enqueueStudioNotification(env: Env, text: string, relatedType: string, relatedId: number): Promise<void> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO studio_notifications (type, status, text, related_type, related_id, created_at, updated_at)
     VALUES ('studio_post_scheduled', 'pending', ?, ?, ?, ?, ?)`,
  )
    .bind(text, relatedType, relatedId, now, now)
    .run();
}

export async function listStudioAccounts(env: Env): Promise<Response> {
  try {
    const [socialRows, redditRows] = await Promise.all([
      env.DB.prepare(
        `SELECT id, platform, username, status, created_at, updated_at
         FROM social_accounts
         WHERE platform IN ('twitter', 'threads')
         ORDER BY platform ASC, updated_at DESC`,
      ).all<Record<string, unknown>>(),
      env.DB.prepare(
        `SELECT id, 'reddit' AS platform, name AS username, status, created_at, updated_at
         FROM reddit_accounts
         ORDER BY updated_at DESC`,
      ).all<Record<string, unknown>>(),
    ]);
    const accounts = [...(socialRows.results ?? []), ...(redditRows.results ?? [])].map((row) => {
      const platform = normalizePlatform(row.platform);
      const id = Number(row.id);
      return {
        id,
        platform,
        username: String(row.username ?? ""),
        status: row.status,
        ref: `${platform}:${id}`,
        label: `${PLATFORM_LABELS[platform] ?? platform}: @${row.username}`,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
    return jsonResponse(accounts);
  } catch {
    return errorResponse("Failed to load Studio accounts", 500);
  }
}

export async function listStudioApps(env: Env): Promise<Response> {
  try {
    const apps = await env.DB.prepare("SELECT * FROM studio_apps ORDER BY updated_at DESC, id DESC").all<Record<string, unknown>>();
    return jsonResponse((apps.results ?? []).map(mapApp));
  } catch {
    return errorResponse("Failed to load Studio apps", 500);
  }
}

export async function createStudioApp(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<StudioAppPayload>(request);
    const name = cleanText(payload.name);
    if (!name) return errorResponse("App name is required", 400);
    const now = nowIso();
    const app = await env.DB.prepare(
      `INSERT INTO studio_apps (name, website_url, app_store_url, description, ai_context, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
      .bind(
        name,
        cleanText(payload.website_url) || null,
        cleanText(payload.app_store_url) || null,
        cleanText(payload.description),
        cleanText(payload.ai_context),
        payload.status ?? "active",
        now,
        now,
      )
      .first<Record<string, unknown>>();
    return jsonResponse(mapApp(app ?? {}), { status: 201 });
  } catch {
    return errorResponse("Failed to create Studio app", 500);
  }
}

export async function updateStudioApp(env: Env, appId: string, request: Request): Promise<Response> {
  try {
    const id = Number(appId);
    if (!Number.isFinite(id)) return errorResponse("Invalid app ID", 400);
    const payload = await parseJson<StudioAppPayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.name !== undefined) { updates.push("name = ?"); values.push(cleanText(payload.name)); }
    if (payload.website_url !== undefined) { updates.push("website_url = ?"); values.push(cleanText(payload.website_url) || null); }
    if (payload.app_store_url !== undefined) { updates.push("app_store_url = ?"); values.push(cleanText(payload.app_store_url) || null); }
    if (payload.description !== undefined) { updates.push("description = ?"); values.push(cleanText(payload.description)); }
    if (payload.ai_context !== undefined) { updates.push("ai_context = ?"); values.push(cleanText(payload.ai_context)); }
    if (payload.status !== undefined) { updates.push("status = ?"); values.push(payload.status); }
    if (updates.length === 0) return errorResponse("No app fields to update", 400);
    const now = nowIso();
    updates.push("updated_at = ?");
    values.push(now, id);
    await env.DB.prepare(`UPDATE studio_apps SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Studio app", 500);
  }
}

export async function deleteStudioApp(env: Env, appId: string): Promise<Response> {
  try {
    const id = Number(appId);
    if (!Number.isFinite(id)) return errorResponse("Invalid app ID", 400);
    await env.DB.prepare("DELETE FROM studio_apps WHERE id = ?").bind(id).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete Studio app", 500);
  }
}

export async function listStudioCampaigns(env: Env): Promise<Response> {
  try {
    const campaigns = await env.DB.prepare(
      `SELECT sc.*, sa.name AS app_name
       FROM studio_campaigns sc
       JOIN studio_apps sa ON sa.id = sc.app_id
       ORDER BY sc.updated_at DESC, sc.id DESC`,
    ).all<Record<string, unknown>>();
    return jsonResponse((campaigns.results ?? []).map(mapCampaign));
  } catch {
    return errorResponse("Failed to load Studio campaigns", 500);
  }
}

export async function createStudioCampaign(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<StudioCampaignPayload>(request);
    const appId = Number(payload.app_id);
    const name = cleanText(payload.name);
    const campaignType: StudioCampaignType = payload.campaign_type === "reply" ? "reply" : "post";
    const platforms = normalizePlatforms(payload.platforms);
    const accountRefs = normalizeRefs(payload.account_refs);
    if (!Number.isFinite(appId) || appId <= 0) return errorResponse("App selection is required", 400);
    if (!name) return errorResponse("Campaign name is required", 400);
    if (platforms.length === 0) return errorResponse("Select at least one social platform", 400);
    if (accountRefs.length === 0) return errorResponse("Select at least one connected account", 400);
    const now = nowIso();
    const campaign = await env.DB.prepare(
      `INSERT INTO studio_campaigns (app_id, name, campaign_type, account_refs, platforms, instructions, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
      .bind(
        appId,
        name,
        campaignType,
        stringifyJson(accountRefs),
        stringifyJson(platforms),
        cleanText(payload.instructions),
        payload.status ?? "active",
        now,
        now,
      )
      .first<Record<string, unknown>>();
    return jsonResponse(mapCampaign(campaign ?? {}), { status: 201 });
  } catch {
    return errorResponse("Failed to create Studio campaign", 500);
  }
}

export async function updateStudioCampaign(env: Env, campaignId: string, request: Request): Promise<Response> {
  try {
    const id = Number(campaignId);
    if (!Number.isFinite(id)) return errorResponse("Invalid campaign ID", 400);
    const payload = await parseJson<StudioCampaignPayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.app_id !== undefined) { updates.push("app_id = ?"); values.push(Number(payload.app_id)); }
    if (payload.name !== undefined) { updates.push("name = ?"); values.push(cleanText(payload.name)); }
    if (payload.campaign_type !== undefined) { updates.push("campaign_type = ?"); values.push(payload.campaign_type === "reply" ? "reply" : "post"); }
    if (payload.account_refs !== undefined) { updates.push("account_refs = ?"); values.push(stringifyJson(normalizeRefs(payload.account_refs))); }
    if (payload.platforms !== undefined) { updates.push("platforms = ?"); values.push(stringifyJson(normalizePlatforms(payload.platforms))); }
    if (payload.instructions !== undefined) { updates.push("instructions = ?"); values.push(cleanText(payload.instructions)); }
    if (payload.status !== undefined) { updates.push("status = ?"); values.push(payload.status); }
    if (updates.length === 0) return errorResponse("No campaign fields to update", 400);
    const now = nowIso();
    updates.push("updated_at = ?");
    values.push(now, id);
    await env.DB.prepare(`UPDATE studio_campaigns SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Studio campaign", 500);
  }
}

export async function deleteStudioCampaign(env: Env, campaignId: string): Promise<Response> {
  try {
    const id = Number(campaignId);
    if (!Number.isFinite(id)) return errorResponse("Invalid campaign ID", 400);
    await env.DB.prepare("DELETE FROM studio_campaigns WHERE id = ?").bind(id).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete Studio campaign", 500);
  }
}

export async function listStudioCrawlerRuns(env: Env, url?: URL): Promise<Response> {
  try {
    const status = url?.searchParams.get("status")?.trim();
    const limit = Math.max(1, Math.min(Number(url?.searchParams.get("limit") || 100), 200));
    const where = status ? "WHERE scr.status = ?" : "";
    const query = `
      SELECT scr.*, sa.name AS app_name, sa.website_url AS app_website_url, sa.app_store_url AS app_store_url,
             sa.description AS app_description, sa.ai_context AS app_ai_context, sc.name AS campaign_name
      FROM studio_crawler_runs scr
      JOIN studio_apps sa ON sa.id = scr.app_id
      LEFT JOIN studio_campaigns sc ON sc.id = scr.campaign_id
      ${where}
      ORDER BY scr.created_at DESC
      LIMIT ?`;
    const statement = env.DB.prepare(query);
    const result = status
      ? await statement.bind(status, limit).all<Record<string, unknown>>()
      : await statement.bind(limit).all<Record<string, unknown>>();
    return jsonResponse((result.results ?? []).map(mapCrawlerRun));
  } catch {
    return errorResponse("Failed to load Studio crawler runs", 500);
  }
}

export async function createStudioCrawlerRun(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<StudioCrawlerPayload>(request);
    let appId = Number(payload.app_id || 0);
    let accountRefs = normalizeRefs(payload.account_refs);
    let platforms = normalizePlatforms(payload.platforms);
    let instructions = cleanText(payload.instructions);
    let campaignType: StudioCampaignType = payload.campaign_type === "reply" ? "reply" : "post";
    const campaignId = payload.campaign_id ? Number(payload.campaign_id) : null;
    if (campaignId) {
      const campaign = await env.DB.prepare("SELECT * FROM studio_campaigns WHERE id = ?")
        .bind(campaignId)
        .first<Record<string, unknown>>();
      if (!campaign) return errorResponse("Campaign not found", 404);
      appId = Number(campaign.app_id);
      if (accountRefs.length === 0) accountRefs = decodeList(campaign.account_refs);
      if (platforms.length === 0) platforms = decodeList(campaign.platforms);
      if (!instructions) instructions = cleanText(campaign.instructions);
      campaignType = campaign.campaign_type === "reply" ? "reply" : "post";
    }
    if (!Number.isFinite(appId) || appId <= 0) return errorResponse("App selection is required", 400);
    if (platforms.length === 0) return errorResponse("Select at least one social platform", 400);
    if (!instructions) return errorResponse("Crawler instructions are required", 400);
    const now = nowIso();
    const run = await env.DB.prepare(
      `INSERT INTO studio_crawler_runs (campaign_id, app_id, campaign_type, account_refs, platforms, instructions, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       RETURNING *`,
    )
      .bind(campaignId, appId, campaignType, stringifyJson(accountRefs), stringifyJson(platforms), instructions, now, now)
      .first<Record<string, unknown>>();
    return jsonResponse(mapCrawlerRun(run ?? {}), { status: 201 });
  } catch {
    return errorResponse("Failed to create Studio crawler run", 500);
  }
}

export async function updateStudioCrawlerRun(env: Env, runId: string, request: Request): Promise<Response> {
  try {
    const id = Number(runId);
    if (!Number.isFinite(id)) return errorResponse("Invalid crawler run ID", 400);
    const payload = await parseJson<StudioCrawlerPayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.status !== undefined) updates.push("status = ?"), values.push(payload.status);
    if (payload.crawler_summary !== undefined) updates.push("crawler_summary = ?"), values.push(cleanText(payload.crawler_summary) || null);
    if (payload.raw_data !== undefined) updates.push("raw_data = ?"), values.push(typeof payload.raw_data === "string" ? payload.raw_data : JSON.stringify(payload.raw_data));
    if (payload.error_message !== undefined) updates.push("error_message = ?"), values.push(cleanText(payload.error_message) || null);
    if (payload.started_at !== undefined) updates.push("started_at = ?"), values.push(payload.started_at);
    if (payload.finished_at !== undefined) updates.push("finished_at = ?"), values.push(payload.finished_at);
    if (updates.length === 0 && payload.signals === undefined) return errorResponse("No crawler fields to update", 400);
    const now = nowIso();
    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(now, id);
      await env.DB.prepare(`UPDATE studio_crawler_runs SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    }
    let signalIds: number[] = [];
    if (payload.signals !== undefined) {
      const run = await env.DB.prepare("SELECT * FROM studio_crawler_runs WHERE id = ?")
        .bind(id)
        .first<Record<string, unknown>>();
      if (!run) return errorResponse("Crawler run not found", 404);
      signalIds = await replaceSignalsForRun(env, run, Array.isArray(payload.signals) ? payload.signals : [], now);
    }
    return jsonResponse({ success: true, updated_at: now, signal_count: signalIds.length, signal_ids: signalIds });
  } catch {
    return errorResponse("Failed to update Studio crawler run", 500);
  }
}

export async function listStudioSignals(env: Env, url?: URL): Promise<Response> {
  try {
    const filters: string[] = [];
    const values: unknown[] = [];
    const runId = url?.searchParams.get("crawler_run_id");
    const campaignId = url?.searchParams.get("campaign_id");
    const status = url?.searchParams.get("status");
    if (runId) filters.push("ss.crawler_run_id = ?"), values.push(Number(runId));
    if (campaignId) filters.push("ss.campaign_id = ?"), values.push(Number(campaignId));
    if (status) filters.push("ss.status = ?"), values.push(status);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const signals = await env.DB.prepare(
      `SELECT ss.*, sa.name AS app_name, sc.name AS campaign_name, scr.status AS crawler_status
       FROM studio_signals ss
       JOIN studio_apps sa ON sa.id = ss.app_id
       LEFT JOIN studio_campaigns sc ON sc.id = ss.campaign_id
       LEFT JOIN studio_crawler_runs scr ON scr.id = ss.crawler_run_id
       ${where}
       ORDER BY ss.opportunity_score DESC, ss.created_at DESC, ss.id DESC
       LIMIT 200`,
    )
      .bind(...values)
      .all<Record<string, unknown>>();
    return jsonResponse((signals.results ?? []).map(mapSignal));
  } catch {
    return errorResponse("Failed to load Studio signals", 500);
  }
}

export async function createStudioSignals(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<StudioSignalsBulkPayload>(request);
    const runId = Number(payload.crawler_run_id);
    if (!Number.isFinite(runId) || runId <= 0) return errorResponse("Crawler run ID is required", 400);
    const run = await env.DB.prepare("SELECT * FROM studio_crawler_runs WHERE id = ?")
      .bind(runId)
      .first<Record<string, unknown>>();
    if (!run) return errorResponse("Crawler run not found", 404);
    const now = nowIso();
    const signalIds = await replaceSignalsForRun(
      env,
      run,
      Array.isArray(payload.signals) ? payload.signals : [],
      now,
      payload.replace_existing !== false,
    );
    const updates: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];
    const status = payload.status === "failed" ? "failed" : "completed";
    updates.push("status = ?");
    values.push(status);
    if (payload.crawler_summary !== undefined) {
      updates.push("crawler_summary = ?");
      values.push(cleanText(payload.crawler_summary) || null);
    }
    if (payload.raw_data !== undefined) {
      updates.push("raw_data = ?");
      values.push(typeof payload.raw_data === "string" ? payload.raw_data : JSON.stringify(payload.raw_data));
    }
    updates.push("finished_at = COALESCE(finished_at, ?)");
    values.push(now, runId);
    await env.DB.prepare(`UPDATE studio_crawler_runs SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    return jsonResponse({ success: true, count: signalIds.length, ids: signalIds });
  } catch {
    return errorResponse("Failed to save Studio signals", 500);
  }
}

export async function listStudioStrategistPosts(env: Env, url?: URL): Promise<Response> {
  try {
    const filters: string[] = [];
    const values: unknown[] = [];
    const runId = url?.searchParams.get("crawler_run_id");
    const campaignId = url?.searchParams.get("campaign_id");
    if (runId) filters.push("ssp.crawler_run_id = ?"), values.push(Number(runId));
    if (campaignId) filters.push("ssp.campaign_id = ?"), values.push(Number(campaignId));
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const posts = await env.DB.prepare(
      `SELECT ssp.*, sa.name AS app_name, sc.name AS campaign_name, scr.status AS crawler_status
       FROM studio_strategist_posts ssp
       JOIN studio_apps sa ON sa.id = ssp.app_id
       LEFT JOIN studio_campaigns sc ON sc.id = ssp.campaign_id
       LEFT JOIN studio_crawler_runs scr ON scr.id = ssp.crawler_run_id
       ${where}
       ORDER BY ssp.created_at DESC, ssp.id DESC`,
    )
      .bind(...values)
      .all<Record<string, unknown>>();
    return jsonResponse((posts.results ?? []).map(mapStrategistPost));
  } catch {
    return errorResponse("Failed to load Studio strategist posts", 500);
  }
}

export async function createStudioStrategistPosts(env: Env, request: Request): Promise<Response> {
  try {
    const payload = await parseJson<StudioStrategistBulkPayload>(request);
    const runId = Number(payload.crawler_run_id);
    if (!Number.isFinite(runId) || runId <= 0) return errorResponse("Crawler run ID is required", 400);
    const run = await env.DB.prepare("SELECT * FROM studio_crawler_runs WHERE id = ?")
      .bind(runId)
      .first<Record<string, unknown>>();
    if (!run) return errorResponse("Crawler run not found", 404);
    const posts = Array.isArray(payload.posts) ? payload.posts.slice(0, 10) : [];
    await env.DB.prepare("DELETE FROM studio_strategist_posts WHERE crawler_run_id = ?").bind(runId).run();
    const now = nowIso();
    const createdIds: number[] = [];
    for (const post of posts) {
      const platform = normalizePlatform(post.platform);
      const postText = cleanText(post.post_text);
      if (!platform || !postText) continue;
      const mediaType = post.media_type === "photo" || post.media_type === "video" ? post.media_type : "none";
      const status: StudioPostStatus = mediaType === "none" || cleanText(post.media_url) ? "suggested" : "asset_needed";
      const result = await env.DB.prepare(
        `INSERT INTO studio_strategist_posts (
          crawler_run_id, campaign_id, app_id, platform, post_text, idea, rationale,
          target_url, target_external_id, target_author, target_text,
          media_type, media_url, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          runId,
          run.campaign_id ?? null,
          run.app_id,
          platform,
          postText,
          cleanText(post.idea),
          cleanText(post.rationale),
          cleanText(post.target_url) || null,
          cleanText(post.target_external_id) || null,
          cleanText(post.target_author) || null,
          cleanText(post.target_text) || null,
          mediaType,
          cleanText(post.media_url) || null,
          status,
          now,
          now,
        )
        .run() as { meta: { last_row_id: number } };
      createdIds.push(result.meta.last_row_id);
    }
    return jsonResponse({ success: true, count: createdIds.length, ids: createdIds });
  } catch {
    return errorResponse("Failed to save Studio strategist posts", 500);
  }
}

export async function updateStudioStrategistPost(env: Env, postId: string, request: Request): Promise<Response> {
  try {
    const id = Number(postId);
    if (!Number.isFinite(id)) return errorResponse("Invalid strategist post ID", 400);
    const payload = await parseJson<StudioStrategistPostPayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.post_text !== undefined) updates.push("post_text = ?"), values.push(cleanText(payload.post_text));
    if (payload.idea !== undefined) updates.push("idea = ?"), values.push(cleanText(payload.idea));
    if (payload.rationale !== undefined) updates.push("rationale = ?"), values.push(cleanText(payload.rationale));
    if (payload.target_url !== undefined) updates.push("target_url = ?"), values.push(cleanText(payload.target_url) || null);
    if (payload.target_external_id !== undefined) updates.push("target_external_id = ?"), values.push(cleanText(payload.target_external_id) || null);
    if (payload.target_author !== undefined) updates.push("target_author = ?"), values.push(cleanText(payload.target_author) || null);
    if (payload.target_text !== undefined) updates.push("target_text = ?"), values.push(cleanText(payload.target_text) || null);
    if (payload.media_type !== undefined) updates.push("media_type = ?"), values.push(payload.media_type);
    if (payload.media_url !== undefined) updates.push("media_url = ?"), values.push(cleanText(payload.media_url) || null);
    if (payload.status !== undefined) updates.push("status = ?"), values.push(payload.status);
    if (updates.length === 0) return errorResponse("No strategist post fields to update", 400);
    const now = nowIso();
    updates.push("updated_at = ?");
    values.push(now, id);
    await env.DB.prepare(`UPDATE studio_strategist_posts SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Studio strategist post", 500);
  }
}

export async function scheduleStudioStrategistPost(env: Env, postId: string, request: Request): Promise<Response> {
  try {
    const id = Number(postId);
    if (!Number.isFinite(id)) return errorResponse("Invalid strategist post ID", 400);
    const payload = await parseJson<{ scheduled_at?: string | null; media_url?: string | null }>(request);
    const post = await env.DB.prepare(
      `SELECT ssp.*, scr.account_refs, scr.campaign_type, scr.instructions AS crawler_instructions
       FROM studio_strategist_posts ssp
       JOIN studio_crawler_runs scr ON scr.id = ssp.crawler_run_id
       WHERE ssp.id = ?`,
    )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!post) return errorResponse("Strategist post not found", 404);
    if (post.status === "scheduled") return errorResponse("Strategist post is already scheduled", 400);
    const mediaUrl = cleanText(payload.media_url) || cleanText(post.media_url) || null;
    if ((post.media_type === "photo" || post.media_type === "video") && !mediaUrl) {
      return errorResponse("Upload the requested media before scheduling this post", 400);
    }
    const platform = normalizePlatform(post.platform);
    const campaignType: StudioCampaignType = post.campaign_type === "reply" ? "reply" : "post";
    const now = nowIso();
    const accountRefs = decodeList(post.account_refs);
    const accountId = accountIdForPlatform(accountRefs, platform);
    const replyToId = cleanText(post.target_external_id);
    if (campaignType === "reply" && !replyToId) {
      return errorResponse("Reply suggestions need a target post/comment ID before scheduling.", 400);
    }
    const scheduledAt = payload.scheduled_at || await chooseAutoSchedule(env, accountId, campaignType);
    const subreddit = platform === "reddit"
      ? extractSubreddit(`${post.crawler_instructions ?? ""}\n${post.idea ?? ""}\n${post.rationale ?? ""}\n${post.post_text ?? ""}`)
      : null;
    if (campaignType === "post" && platform === "reddit" && !subreddit) {
      return errorResponse("Reddit Studio posts need a subreddit in the campaign or crawler instructions, for example r/SaaS or subreddit: SaaS.", 400);
    }
    const capabilities = await getSocialPostSchemaCapabilities(env);
    const columns = ["platform", "content", "image_url", "status", "scheduled_at", "created_by", "created_at", "updated_at"];
    const values: Array<string | number | null> = [
      platform,
      cleanText(post.post_text),
      mediaUrl,
      "scheduled",
      scheduledAt,
      "studio",
      now,
      now,
    ];
    if (capabilities.hasTitle) {
      columns.push("title");
      values.push(cleanText(post.idea) || null);
    }
    if (capabilities.hasSubreddit) {
      columns.push("subreddit");
      values.push(subreddit);
    }
    if (capabilities.hasAccountId) {
      columns.push("account_id");
      values.push(accountId);
    }
    if (capabilities.hasReplyToId) {
      columns.push("reply_to_id");
      values.push(campaignType === "reply" ? replyToId : null);
    }
    const socialResult = await env.DB.prepare(
      `INSERT INTO social_posts (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`,
    )
      .bind(...values)
      .run() as { meta: { last_row_id: number } };
    const socialPostId = socialResult.meta.last_row_id;
    let plannerItemId: number | null = null;
    const hasSocialPostLinks = await plannerHasSocialPostLinks(env);
    const plannerTitle = `${PLATFORM_LABELS[platform] ?? platform} ${campaignType}: ${cleanText(post.idea) || cleanText(post.post_text).slice(0, 72)}`;
    const plannerDescription = campaignType === "reply" && cleanText(post.target_url)
      ? `${cleanText(post.post_text)}\n\nTarget: ${cleanText(post.target_url)}`
      : cleanText(post.post_text);
    const plannerResult = hasSocialPostLinks
      ? await env.DB.prepare(
        `INSERT INTO planner_items (
          title, description, item_type, platform, status, scheduled_for, social_post_id, account_id, instruction, created_by, created_at, updated_at
        )
        VALUES (?, ?, 'post', ?, 'approved', ?, ?, ?, ?, 'studio', ?, ?)`,
      )
        .bind(plannerTitle, plannerDescription, platform, scheduledAt, socialPostId, accountId, cleanText(post.rationale), now, now)
        .run() as { meta: { last_row_id: number } }
      : await env.DB.prepare(
        `INSERT INTO planner_items (
          title, description, item_type, platform, status, scheduled_for, account_id, instruction, created_by, created_at, updated_at
        )
        VALUES (?, ?, 'post', ?, 'approved', ?, ?, ?, 'studio', ?, ?)`,
      )
        .bind(plannerTitle, plannerDescription, platform, scheduledAt, accountId, cleanText(post.rationale), now, now)
        .run() as { meta: { last_row_id: number } };
    plannerItemId = plannerResult.meta.last_row_id;
    await env.DB.prepare(
      `UPDATE studio_strategist_posts
       SET status = 'scheduled', media_url = ?, social_post_id = ?, planner_item_id = ?, scheduled_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(mediaUrl, socialPostId, plannerItemId, scheduledAt, now, id)
      .run();
    await enqueueStudioNotification(
      env,
      `"${cleanText(post.post_text)}" planned as "${PLATFORM_LABELS[platform] ?? platform}" ${campaignType} at ${scheduledAt}`,
      "studio_strategist_post",
      id,
    );
    return jsonResponse({
      success: true,
      strategist_post_id: id,
      social_post_id: socialPostId,
      planner_item_id: plannerItemId,
      scheduled_at: scheduledAt,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to schedule Studio post", 500);
  }
}

export async function listStudioNotifications(env: Env, url?: URL): Promise<Response> {
  try {
    const status = url?.searchParams.get("status") || "pending";
    const limit = Math.max(1, Math.min(Number(url?.searchParams.get("limit") || 20), 50));
    const rows = await env.DB.prepare(
      `SELECT * FROM studio_notifications
       WHERE status = ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
      .bind(status, limit)
      .all();
    return jsonResponse(rows.results ?? []);
  } catch {
    return errorResponse("Failed to load Studio notifications", 500);
  }
}

export async function updateStudioNotification(env: Env, notificationId: string, request: Request): Promise<Response> {
  try {
    const id = Number(notificationId);
    if (!Number.isFinite(id)) return errorResponse("Invalid notification ID", 400);
    const payload = await parseJson<StudioNotificationPayload>(request);
    const now = nowIso();
    await env.DB.prepare(
      `UPDATE studio_notifications
       SET status = ?, error_message = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ?
       WHERE id = ?`,
    )
      .bind(payload.status ?? "sent", cleanText(payload.error_message) || null, payload.status ?? "sent", now, now, id)
      .run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Studio notification", 500);
  }
}

export async function getStudioSummary(env: Env): Promise<Response> {
  const [accounts, apps, campaigns, crawlerRuns, signals, posts] = await Promise.all([
    listStudioAccounts(env).then((response) => response.json()),
    listStudioApps(env).then((response) => response.json()),
    listStudioCampaigns(env).then((response) => response.json()),
    listStudioCrawlerRuns(env).then((response) => response.json()),
    listStudioSignals(env).then((response) => response.json()),
    listStudioStrategistPosts(env).then((response) => response.json()),
  ]);
  return jsonResponse({ accounts, apps, campaigns, crawler_runs: crawlerRuns, signals, strategist_posts: posts });
}
