import type { Env } from "../lib/types";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { callAiText } from "../lib/ai";
import { getSocialPostSchemaCapabilities } from "./twitter";
import { plannerHasSocialPostLinks } from "./planner";
import { DEFAULT_USER_ID, appendScopedFilter, ownerId, scopedInsertColumns, scopedInsertColumnsFromRecord, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";
import { readAccountTags } from "../lib/account-tags";

type StudioStatus = "active" | "inactive" | "archived";
type StudioCampaignType = "post" | "reply";
type StudioCampaignStatus = "active" | "paused" | "archived";
type StudioCrawlerStatus = "pending" | "running" | "completed" | "failed";
type StudioPostStatus = "suggested" | "asset_needed" | "scheduled" | "posted" | "dismissed";
type StudioSignalStatus = "candidate" | "filtered" | "signal" | "rejected";
type StudioPlatform = "twitter" | "threads" | "reddit" | "instagram" | "linkedin";

type StudioAppPayload = {
  name?: string;
  website_url?: string | null;
  app_store_url?: string | null;
  articles_api_url?: string | null;
  description?: string | null;
  ai_context?: string | null;
  status?: StudioStatus;
};

type StudioCampaignPayload = {
  app_id?: number;
  name?: string;
  campaign_type?: StudioCampaignType;
  result_limit?: number;
  account_refs?: unknown;
  platforms?: unknown;
  instructions?: string | null;
  status?: StudioCampaignStatus;
};

type StudioCrawlerPayload = {
  campaign_id?: number | null;
  app_id?: number;
  campaign_type?: StudioCampaignType;
  result_limit?: number;
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

type StudioAiSettings = {
  geminiApiKey: string;
  geminiFlashModel: string;
  geminiProModel: string;
  globalAiRules: string;
};

type StudioCrawlerBrief = {
  user_instructions: string;
  technical_instructions: string;
  search_queries: string[];
  negative_queries: string[];
  quality_rules: string[];
  retry_policy: {
    max_iterations: number;
    min_signal_count: number;
    min_unique_source_posts: number;
    min_opportunity_score: number;
    rerun_when: string[];
  };
  strategist_rules: {
    max_suggestions: number;
    max_replies_per_source_post: number;
    diversify_source_posts: boolean;
  };
};

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "Twitter/X",
  threads: "Threads",
  reddit: "Reddit",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

const STUDIO_PLATFORMS: StudioPlatform[] = ["twitter", "threads", "reddit", "instagram", "linkedin"];
const REPLY_CAPABLE_STUDIO_PLATFORMS = new Set<StudioPlatform>(["twitter", "threads", "reddit"]);

const columnCapabilityCache = new Map<string, boolean>();

function nowIso(): string {
  return new Date().toISOString();
}

async function tableHasColumn(env: Env, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  if (columnCapabilityCache.has(key)) return columnCapabilityCache.get(key) ?? false;
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const hasColumn = (rows.results ?? []).some((row) => row.name === column);
  columnCapabilityCache.set(key, hasColumn);
  return hasColumn;
}

function normalizePlatform(platform: unknown): string {
  const value = String(platform ?? "").trim().toLowerCase();
  if (value === "x" || value === "twitter/x") return "twitter";
  if (value === "thread") return "threads";
  if (value === "ig") return "instagram";
  if (value === "linked") return "linkedin";
  return value;
}

function isStudioPlatform(platform: string): platform is StudioPlatform {
  return STUDIO_PLATFORMS.includes(platform as StudioPlatform);
}

function isReplyCapableStudioPlatform(platform: string) {
  return isStudioPlatform(platform) && REPLY_CAPABLE_STUDIO_PLATFORMS.has(platform);
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
    if (!platform || !isStudioPlatform(platform) || seen.has(platform)) continue;
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

function safeParseJsonObject(value: string): Record<string, unknown> | null {
  const cleaned = value.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
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

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean).slice(0, 20);
}

function normalizeSignalStatus(value: unknown): StudioSignalStatus {
  return value === "candidate" || value === "filtered" || value === "rejected" ? value : "signal";
}

function normalizeOpportunityScore(value: unknown): number {
  const score = Number(value ?? 0);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeResultLimit(value: unknown, fallback = 10): number {
  const limit = Math.round(Number(value ?? fallback));
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(limit, 50));
}

function accountIdForPlatform(accountRefs: string[], platform: string): number | null {
  const prefix = `${normalizePlatform(platform)}:`;
  const ref = accountRefs.find((value) => value.startsWith(prefix));
  if (!ref) return null;
  const id = Number(ref.slice(prefix.length));
  return Number.isFinite(id) && id > 0 ? id : null;
}

function accountIdForSocialPosts(platform: string, accountId: number | null): number | null {
  return isStudioPlatform(normalizePlatform(platform)) ? accountId : null;
}

function extractSubreddit(value: unknown): string | null {
  const text = String(value ?? "");
  const prefixed = text.match(/\br\/([A-Za-z0-9_]{2,21})\b/i);
  if (prefixed?.[1]) return prefixed[1];
  const labelled = text.match(/\bsubreddit\s*[:=]\s*([A-Za-z0-9_]{2,21})\b/i);
  if (labelled?.[1]) return labelled[1];
  return null;
}

function sourcePostKey(platform: string, value: { target_url?: unknown; target_external_id?: unknown }): string {
  const normalizedPlatform = normalizePlatform(platform);
  const rawUrl = cleanText(value.target_url);
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const path = parsed.pathname.replace(/\/+$/, "");
      const redditMatch = path.match(/\/comments\/([A-Za-z0-9_]+)/i);
      if (redditMatch?.[1]) return `${normalizedPlatform}:post:${redditMatch[1].toLowerCase()}`;
      const statusMatch = path.match(/\/status(?:es)?\/(\d+)/i);
      if (statusMatch?.[1]) return `${normalizedPlatform}:post:${statusMatch[1]}`;
      const threadsMatch = path.match(/\/post\/([A-Za-z0-9_-]+)/i);
      if (threadsMatch?.[1]) return `${normalizedPlatform}:post:${threadsMatch[1]}`;
      return `${normalizedPlatform}:url:${parsed.hostname.toLowerCase()}${path.toLowerCase()}`;
    } catch {
      return `${normalizedPlatform}:url:${rawUrl.toLowerCase().split(/[?#]/)[0]}`;
    }
  }
  const externalId = cleanText(value.target_external_id);
  return externalId ? `${normalizedPlatform}:external:${externalId}` : `${normalizedPlatform}:unknown`;
}

async function readStudioAiSettings(env: Env, userId = DEFAULT_USER_ID): Promise<StudioAiSettings> {
  const hasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
  const hasUserId = await tableHasUserId(env, "app_settings");
  const rows = await env.DB.prepare(
    hasWorkspaceId
      ? "SELECT key, value FROM app_settings WHERE workspace_id = ? AND key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')"
      : hasUserId
      ? "SELECT key, value FROM app_settings WHERE user_id = ? AND key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')"
      : "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')",
  ).bind(...(hasWorkspaceId ? [workspaceId(userId)] : hasUserId ? [ownerId(userId)] : [])).all<{ key: string; value: string }>();

  const settings: StudioAiSettings = {
    geminiApiKey: "",
    geminiFlashModel: "gemini-3.1-flash-preview",
    geminiProModel: "gemini-3.1-pro-preview",
    globalAiRules: "",
  };

  for (const row of rows.results ?? []) {
    if (row.key === "gemini_api_key" && row.value) settings.geminiApiKey = row.value;
    if (row.key === "gemini_flash_model" && row.value) settings.geminiFlashModel = row.value;
    if (row.key === "gemini_pro_model" && row.value) settings.geminiProModel = row.value;
    if (row.key === "global_ai_rules" && row.value) settings.globalAiRules = row.value;
  }

  return settings;
}

function fallbackCrawlerBrief({
  app,
  campaignType,
  instructions,
  platforms,
  resultLimit,
}: {
  app: Record<string, unknown> | null;
  campaignType: StudioCampaignType;
  instructions: string;
  platforms: string[];
  resultLimit: number;
}): StudioCrawlerBrief {
  const appName = cleanText(app?.name) || "the selected app";
  const appContext = [cleanText(app?.description), cleanText(app?.ai_context)].filter(Boolean).join(" ");
  const replyMode = campaignType === "reply";
  const targetSuggestions = normalizeResultLimit(resultLimit);
  const baseSearches = replyMode
    ? [
      `"${appName}" question OR confused OR "what is this"`,
      `${appName} alternative pain point complaint`,
      `${appName} "how do I" OR "anyone know"`,
      `${instructions} comments discussion pain point`,
    ]
    : [
      `${appName} pain points discussion`,
      `${appName} alternative complaints workflow`,
      `${instructions} problem opportunity`,
      `${appContext || appName} user frustration`,
    ];

  return {
    user_instructions: instructions,
    technical_instructions: [
      `Interpret the user's request as the crawler objective for ${appName}.`,
      "Generate query variants from the intent, app positioning, target audience, synonyms, competitor alternatives, and concrete problem language.",
      "Fetch enough results across the selected platforms, then ask AI to filter noisy or off-topic results before saving signals.",
      "If the first result set is weak, broaden or rephrase the queries and run another search iteration before saving final signals.",
      replyMode
        ? "For reply campaigns, prioritize real posts with active comment threads where a helpful reply can naturally add value."
        : "For post campaigns, prioritize recurring user pains, objections, and product education opportunities.",
      "Reject spam, giveaways, generic engagement bait, bot-like posts, and results without clear evidence.",
    ].join("\n"),
    search_queries: baseSearches,
    negative_queries: ["giveaway", "airdrop", "promo code", "follow for follow", "bot spam", "unrelated news"],
    quality_rules: [
      "Each saved signal must have a clear pain point, evidence snippet, source URL when available, and opportunity score.",
      "Prefer recent, specific, human-written posts over generic SEO pages.",
      "Score higher when the pain repeats across more than one source or maps directly to the selected app.",
      replyMode ? "Keep at most two suggested replies under one source post." : "Diversify angles across awareness, pain, proof, and objection handling.",
    ],
    retry_policy: {
      max_iterations: 5,
      min_signal_count: Math.max(replyMode ? 8 : 6, Math.min(targetSuggestions, 20)),
      min_unique_source_posts: replyMode ? Math.max(4, Math.min(Math.ceil(targetSuggestions / 2), 20)) : 3,
      min_opportunity_score: 60,
      rerun_when: [
        "fewer than the minimum signal count passes filtering",
        "too many results come from the same source post",
        "top results are generic, off-topic, spammy, or lack evidence",
        "reply mode cannot find enough distinct posts with suitable comments",
      ],
    },
    strategist_rules: {
      max_suggestions: targetSuggestions,
      max_replies_per_source_post: 2,
      diversify_source_posts: true,
    },
  };
}

function crawlerBriefToInstructions(brief: StudioCrawlerBrief): string {
  return [
    "USER INSTRUCTIONS",
    brief.user_instructions,
    "",
    "AI CRAWLER PLAYBOOK",
    brief.technical_instructions,
    "",
    "SEARCH QUERIES",
    ...brief.search_queries.map((query) => `- ${query}`),
    "",
    "NEGATIVE QUERIES / FILTERS",
    ...brief.negative_queries.map((query) => `- ${query}`),
    "",
    "QUALITY RULES",
    ...brief.quality_rules.map((rule) => `- ${rule}`),
    "",
    "RETRY POLICY",
    `- Max iterations: ${brief.retry_policy.max_iterations}`,
    `- Minimum accepted signals: ${brief.retry_policy.min_signal_count}`,
    `- Minimum unique source posts: ${brief.retry_policy.min_unique_source_posts}`,
    `- Minimum opportunity score: ${brief.retry_policy.min_opportunity_score}`,
    ...brief.retry_policy.rerun_when.map((rule) => `- Rerun when ${rule}`),
    "",
    "STRATEGIST RULES",
    `- Create at most ${brief.strategist_rules.max_suggestions} suggestions.`,
    `- Reply campaigns: maximum ${brief.strategist_rules.max_replies_per_source_post} comment replies under one source post.`,
    "- If two replies are already suggested under one source post, search more distinct posts instead of adding a third.",
  ].join("\n");
}

function normalizeCrawlerBrief(value: Record<string, unknown>, fallback: StudioCrawlerBrief, resultLimit: number): StudioCrawlerBrief {
  const retry = typeof value.retry_policy === "object" && value.retry_policy ? value.retry_policy as Record<string, unknown> : {};
  const strategist = typeof value.strategist_rules === "object" && value.strategist_rules ? value.strategist_rules as Record<string, unknown> : {};
  const targetSuggestions = normalizeResultLimit(resultLimit, fallback.strategist_rules.max_suggestions);
  return {
    user_instructions: cleanText(value.user_instructions) || fallback.user_instructions,
    technical_instructions: cleanText(value.technical_instructions) || fallback.technical_instructions,
    search_queries: cleanList(value.search_queries).length ? cleanList(value.search_queries).slice(0, 12) : fallback.search_queries,
    negative_queries: cleanList(value.negative_queries).length ? cleanList(value.negative_queries).slice(0, 12) : fallback.negative_queries,
    quality_rules: cleanList(value.quality_rules).length ? cleanList(value.quality_rules).slice(0, 12) : fallback.quality_rules,
    retry_policy: {
      max_iterations: Math.max(1, Math.min(Number(retry.max_iterations ?? fallback.retry_policy.max_iterations), 8)),
      min_signal_count: Math.max(1, Math.min(Number(retry.min_signal_count ?? fallback.retry_policy.min_signal_count), 20)),
      min_unique_source_posts: Math.max(1, Math.min(Number(retry.min_unique_source_posts ?? fallback.retry_policy.min_unique_source_posts), 20)),
      min_opportunity_score: Math.max(0, Math.min(Number(retry.min_opportunity_score ?? fallback.retry_policy.min_opportunity_score), 100)),
      rerun_when: cleanList(retry.rerun_when).length ? cleanList(retry.rerun_when).slice(0, 8) : fallback.retry_policy.rerun_when,
    },
    strategist_rules: {
      max_suggestions: targetSuggestions,
      max_replies_per_source_post: 2,
      diversify_source_posts: strategist.diversify_source_posts !== false,
    },
  };
}

async function buildCrawlerBrief({
  env,
  app,
  campaignType,
  instructions,
  platforms,
  resultLimit,
}: {
  env: Env;
  app: Record<string, unknown> | null;
  campaignType: StudioCampaignType;
  instructions: string;
  platforms: string[];
  resultLimit: number;
}): Promise<{ brief: StudioCrawlerBrief; generatedByAi: boolean; aiError?: string }> {
  const fallback = fallbackCrawlerBrief({ app, campaignType, instructions, platforms, resultLimit });
  try {
    const settings = await readStudioAiSettings(env);
    if (!settings.geminiApiKey) return { brief: fallback, generatedByAi: false, aiError: "No Gemini API key configured" };
    const responseText = await callAiText({
      apiKey: settings.geminiApiKey,
      model: settings.geminiProModel,
      fallbackModel: settings.geminiFlashModel,
      maxTokens: 1800,
      system: [
        "You are the planning brain for a marketing crawler.",
        "Convert founder instructions into technical search guidance that a crawler runner can execute.",
        "The crawler can generate search queries, run search adapters or Playwright, filter noisy results with AI, extract pain points, score opportunity, and rerun search iterations when quality is weak.",
        "Reply campaigns must never suggest more than 2 comment replies under the same source post. If two comments under one post are already useful, search other posts.",
        "Respect the requested strategist suggestion count in strategist_rules.max_suggestions.",
        "Return JSON only with keys: user_instructions, technical_instructions, search_queries, negative_queries, quality_rules, retry_policy, strategist_rules.",
        settings.globalAiRules ? `Global AI rules: ${settings.globalAiRules}` : "",
      ].filter(Boolean).join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `Campaign type: ${campaignType}`,
            `Requested strategist suggestions: ${resultLimit}`,
            `Platforms: ${platforms.join(", ")}`,
            `App name: ${cleanText(app?.name) || "Unknown"}`,
            `App website: ${cleanText(app?.website_url) || "Unknown"}`,
            `App store URL: ${cleanText(app?.app_store_url) || "Unknown"}`,
            `Articles API: ${cleanText(app?.articles_api_url) || "Unknown"}`,
            `App description: ${cleanText(app?.description) || "None"}`,
            `App AI context: ${cleanText(app?.ai_context) || "None"}`,
            `Founder instructions: ${instructions}`,
            "Make the search plan specific, technical, and optimized for high-quality pain signals.",
          ].join("\n"),
        },
      ],
    });
    const parsed = safeParseJsonObject(responseText);
    if (!parsed) return { brief: fallback, generatedByAi: false, aiError: "AI response was not valid JSON" };
    return { brief: normalizeCrawlerBrief(parsed, fallback, resultLimit), generatedByAi: true };
  } catch (error) {
    return {
      brief: fallback,
      generatedByAi: false,
      aiError: error instanceof Error ? error.message : "AI crawler planning failed",
    };
  }
}

function assessCrawlerSignalQuality(
  run: Record<string, unknown>,
  signals: StudioSignalPayload[],
): { needs_more_search: boolean; reasons: string[]; signal_count: number; unique_source_posts: number; top_score: number; accepted_count: number } {
  const rawData = safeParseJson<Record<string, unknown>>(run.raw_data, {});
  const brief = typeof rawData.crawler_playbook === "object" && rawData.crawler_playbook
    ? rawData.crawler_playbook as Partial<StudioCrawlerBrief>
    : null;
  const retryPolicy = brief?.retry_policy;
  const campaignType: StudioCampaignType = run.campaign_type === "reply" ? "reply" : "post";
  const minSignalCount = Number(retryPolicy?.min_signal_count ?? (campaignType === "reply" ? 8 : 6));
  const minUniquePosts = Number(retryPolicy?.min_unique_source_posts ?? (campaignType === "reply" ? 4 : 3));
  const minScore = Number(retryPolicy?.min_opportunity_score ?? 60);
  const accepted = signals.filter((signal) => {
    const status = normalizeSignalStatus(signal.status);
    const hasEvidence = Boolean(cleanText(signal.pain_point) || cleanText(signal.evidence) || cleanText(signal.snippet));
    return status !== "rejected" && hasEvidence && normalizeOpportunityScore(signal.opportunity_score) >= minScore;
  });
  const sourceKeys = new Set(
    accepted
      .map((signal) => sourcePostKey(cleanText(signal.platform) || decodeList(run.platforms)[0] || "", {
        target_url: signal.url,
        target_external_id: signal.raw_data && typeof signal.raw_data === "object"
          ? (signal.raw_data as Record<string, unknown>).source_post_id ?? (signal.raw_data as Record<string, unknown>).post_id
          : "",
      }))
      .filter((key) => !key.endsWith(":unknown")),
  );
  const topScore = Math.max(0, ...signals.map((signal) => normalizeOpportunityScore(signal.opportunity_score)));
  const reasons: string[] = [];
  if (accepted.length < minSignalCount) reasons.push(`Only ${accepted.length} accepted signals; need ${minSignalCount}.`);
  if (sourceKeys.size < minUniquePosts) reasons.push(`Only ${sourceKeys.size} unique source posts; need ${minUniquePosts}.`);
  if (topScore < minScore) reasons.push(`Top opportunity score is ${topScore}; need ${minScore} or higher.`);
  return {
    needs_more_search: reasons.length > 0,
    reasons,
    signal_count: signals.length,
    unique_source_posts: sourceKeys.size,
    top_score: topScore,
    accepted_count: accepted.length,
  };
}

function mapApp(row: Record<string, unknown>) {
  return {
    ...row,
    website_url: row.website_url ?? "",
    app_store_url: row.app_store_url ?? "",
    articles_api_url: row.articles_api_url ?? "",
    description: row.description ?? "",
    ai_context: row.ai_context ?? "",
  };
}

function mapCampaign(row: Record<string, unknown>) {
  return {
    ...row,
    campaign_type: row.campaign_type || "post",
    result_limit: normalizeResultLimit(row.result_limit),
    account_refs: decodeList(row.account_refs),
    platforms: decodeList(row.platforms),
  };
}

function mapCrawlerRun(row: Record<string, unknown>) {
  const rawData = safeParseJson<Record<string, unknown>>(row.raw_data, {});
  return {
    ...row,
    campaign_type: row.campaign_type || "post",
    result_limit: normalizeResultLimit(row.result_limit ?? rawData.requested_results),
    account_refs: decodeList(row.account_refs),
    platforms: decodeList(row.platforms),
    raw_data: row.raw_data ? rawData : null,
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
  userId: number | null = DEFAULT_USER_ID,
): Promise<number[]> {
  const runId = Number(run.id);
  const campaignId = run.campaign_id ?? null;
  const appId = Number(run.app_id);
  const runPlatforms = decodeList(run.platforms);
  const createdIds: number[] = [];
  if (replaceExisting) {
    const deleteFilters = ["crawler_run_id = ?"];
    const deleteValues: unknown[] = [runId];
    await appendScopedFilter(env, "studio_signals", deleteFilters, deleteValues, userId);
    await env.DB.prepare(`DELETE FROM studio_signals WHERE ${deleteFilters.join(" AND ")}`).bind(...deleteValues).run();
  }
  const scoped = userId === null
    ? await scopedInsertColumnsFromRecord(env, "studio_signals", run)
    : await scopedInsertColumns(env, "studio_signals", userId);
  for (const signal of signals.slice(0, 100)) {
    const platform = normalizePlatform(signal.platform) || runPlatforms[0] || "threads";
    if (!isStudioPlatform(platform)) continue;
    const title = cleanText(signal.title);
    const snippet = cleanText(signal.snippet);
    const painPoint = cleanText(signal.pain_point);
    const evidence = cleanText(signal.evidence);
    if (!title && !snippet && !painPoint && !evidence) continue;
    const result = await env.DB.prepare(
      `INSERT INTO studio_signals (
        ${scoped.columns.length ? `${scoped.columns.join(", ")},` : ""}
        crawler_run_id, campaign_id, app_id, platform, source, query, title, url, author,
        snippet, pain_point, audience, evidence, opportunity_score, noise_reason, status,
        raw_data, created_at, updated_at
      )
      VALUES (${scoped.columns.length ? "?," : ""}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        ...scoped.values,
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
  platform: string,
  campaignType: StudioCampaignType,
  userId = DEFAULT_USER_ID,
): Promise<string> {
  const timeZone = await readWorkspaceTimeZone(env);
  const now = new Date();
  const minLead = new Date(now.getTime() + 45 * 60 * 1000);
  const hasReplyToId = await socialPostsHaveReplyTargets(env);
  const socialPostAccountId = accountIdForSocialPosts(platform, accountId);
  const accountWhere = socialPostAccountId ? "account_id = ?" : "account_id IS NULL";
  const socialTypeWhere = hasReplyToId
    ? campaignType === "reply"
      ? "reply_to_id IS NOT NULL"
      : "reply_to_id IS NULL"
    : "1 = 1";
  const hasSocialUserId = await tableHasUserId(env, "social_posts");
  const socialOwnerClause = hasSocialUserId ? "AND user_id = ?" : "";
  const socialOwnerValues = hasSocialUserId ? [ownerId(userId)] : [];
  let activeSocialRows: { results?: Array<{ value: string }> } = { results: [] };
  if (socialPostAccountId !== null) {
    activeSocialRows = await env.DB.prepare(
      `SELECT scheduled_at AS value
       FROM social_posts
       WHERE scheduled_at IS NOT NULL
         AND status IN ('scheduled', 'approved')
         AND ${accountWhere}
         AND ${socialTypeWhere}
         ${socialOwnerClause}`,
    ).bind(socialPostAccountId, ...socialOwnerValues).all<{ value: string }>();
  } else if (accountId === null) {
    activeSocialRows = await env.DB.prepare(
      `SELECT scheduled_at AS value
       FROM social_posts
       WHERE scheduled_at IS NOT NULL
         AND status IN ('scheduled', 'approved')
         AND ${accountWhere}
         AND ${socialTypeWhere}
         ${socialOwnerClause}`,
    ).bind(...socialOwnerValues).all<{ value: string }>();
  }
  const hasSocialPostLinks = await plannerHasSocialPostLinks(env);
  const plannerSocialLinkFilter = hasSocialPostLinks && socialPostAccountId === accountId
    ? "AND social_post_id IS NULL"
    : "";
  const hasPlannerUserId = await tableHasUserId(env, "planner_items");
  const plannerOwnerClause = hasPlannerUserId ? "AND user_id = ?" : "";
  const plannerOwnerValues = hasPlannerUserId ? [ownerId(userId)] : [];
  const plannerRows = accountId
    ? await env.DB.prepare(
      `SELECT scheduled_for AS value
       FROM planner_items
       WHERE scheduled_for IS NOT NULL
         AND status IN ('planned', 'drafting', 'approved')
         AND account_id = ?
         ${plannerSocialLinkFilter}
         ${plannerOwnerClause}`,
    ).bind(accountId, ...plannerOwnerValues).all<{ value: string }>()
    : await env.DB.prepare(
      `SELECT scheduled_for AS value
       FROM planner_items
       WHERE scheduled_for IS NOT NULL
         AND status IN ('planned', 'drafting', 'approved')
         AND account_id IS NULL
         ${plannerSocialLinkFilter}
         ${plannerOwnerClause}`,
    ).bind(...plannerOwnerValues).all<{ value: string }>();
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

async function enqueueStudioNotification(
  env: Env,
  text: string,
  relatedType: string,
  relatedId: number,
  userId = DEFAULT_USER_ID,
): Promise<void> {
  const now = nowIso();
  const scoped = await scopedInsertColumns(env, "studio_notifications", userId);
  await env.DB.prepare(
    `INSERT INTO studio_notifications (${[...scoped.columns, "type", "status", "text", "related_type", "related_id", "created_at", "updated_at"].join(", ")})
     VALUES (${[...scoped.columns.map(() => "?"), "'studio_post_scheduled'", "'pending'", "?", "?", "?", "?", "?"].join(", ")})`,
  )
    .bind(...scoped.values, text, relatedType, relatedId, now, now)
    .run();
}

export async function listStudioAccounts(env: Env, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const socialPlatforms: StudioPlatform[] = ["twitter", "threads", "instagram", "linkedin"];
    const socialFilters = [`platform IN (${socialPlatforms.map(() => "?").join(", ")})`];
    const socialValues: unknown[] = [...socialPlatforms];
    await appendScopedFilter(env, "social_accounts", socialFilters, socialValues, userId);
    const redditFilters: string[] = [];
    const redditValues: unknown[] = [];
    await appendScopedFilter(env, "reddit_accounts", redditFilters, redditValues, userId);
    const [socialRows, redditRows] = await Promise.all([
      env.DB.prepare(
        `SELECT id, platform, username, status, created_at, updated_at
         FROM social_accounts
          WHERE ${socialFilters.join(" AND ")}
         ORDER BY platform ASC, updated_at DESC`,
      ).bind(...socialValues).all<Record<string, unknown>>(),
      env.DB.prepare(
        `SELECT id,
                'reddit' AS platform,
                name AS username,
                CASE
                  WHEN status = 'active'
                   AND (
                    length(trim(coalesce(access_token, ''))) > 0
                    OR length(trim(coalesce(refresh_token, ''))) > 0
                   )
                  THEN 'active'
                  ELSE 'inactive'
                END AS status,
                created_at,
                updated_at
         FROM reddit_accounts
         ${redditFilters.length ? `WHERE ${redditFilters.join(" AND ")}` : ""}
         ORDER BY updated_at DESC`,
      ).bind(...redditValues).all<Record<string, unknown>>(),
    ]);
    const accounts = await Promise.all([...(socialRows.results ?? []), ...(redditRows.results ?? [])].map(async (row) => {
      const platform = normalizePlatform(row.platform);
      const id = Number(row.id);
      const tags = await readAccountTags(env, platform === "reddit" ? "reddit_account" : "social_account", id, userId);
      return {
        id,
        platform,
        username: String(row.username ?? ""),
        tags,
        status: row.status,
        ref: `${platform}:${id}`,
        label: `${PLATFORM_LABELS[platform] ?? platform}: @${row.username}${tags.length ? ` (${tags.join(", ")})` : ""}`,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }));
    return jsonResponse(accounts);
  } catch {
    return errorResponse("Failed to load Studio accounts", 500);
  }
}

export async function listStudioApps(env: Env, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const filters: string[] = [];
    const values: unknown[] = [];
    await appendScopedFilter(env, "studio_apps", filters, values, userId);
    const apps = await env.DB.prepare(
      `SELECT * FROM studio_apps ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC`,
    ).bind(...values).all<Record<string, unknown>>();
    return jsonResponse((apps.results ?? []).map(mapApp));
  } catch {
    return errorResponse("Failed to load Studio apps", 500);
  }
}

export async function createStudioApp(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<StudioAppPayload>(request);
    const name = cleanText(payload.name);
    if (!name) return errorResponse("App name is required", 400);
    const now = nowIso();
    const hasArticlesApiUrl = await tableHasColumn(env, "studio_apps", "articles_api_url");
    const scoped = await scopedInsertColumns(env, "studio_apps", userId);
    const columns = [...scoped.columns, "name", "website_url", "app_store_url"];
    const placeholders = [...scoped.columns.map(() => "?"), "?", "?", "?"];
    const values: unknown[] = [
      ...scoped.values,
      name,
      cleanText(payload.website_url) || null,
      cleanText(payload.app_store_url) || null,
    ];
    if (hasArticlesApiUrl) {
      columns.push("articles_api_url");
      placeholders.push("?");
      values.push(cleanText(payload.articles_api_url) || null);
    }
    columns.push("description", "ai_context", "status", "created_at", "updated_at");
    placeholders.push("?", "?", "?", "?", "?");
    values.push(
      cleanText(payload.description),
      cleanText(payload.ai_context),
      payload.status ?? "active",
      now,
      now,
    );
    const app = await env.DB.prepare(
      `INSERT INTO studio_apps (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
    )
      .bind(...values)
      .first<Record<string, unknown>>();
    return jsonResponse(mapApp(app ?? {}), { status: 201 });
  } catch (error) {
    console.error("Failed to create Studio app", error);
    return errorResponse("Failed to create Studio app", 500);
  }
}

export async function updateStudioApp(env: Env, appId: string, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(appId);
    if (!Number.isFinite(id)) return errorResponse("Invalid app ID", 400);
    const payload = await parseJson<StudioAppPayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.name !== undefined) { updates.push("name = ?"); values.push(cleanText(payload.name)); }
    if (payload.website_url !== undefined) { updates.push("website_url = ?"); values.push(cleanText(payload.website_url) || null); }
    if (payload.app_store_url !== undefined) { updates.push("app_store_url = ?"); values.push(cleanText(payload.app_store_url) || null); }
    if (payload.articles_api_url !== undefined && await tableHasColumn(env, "studio_apps", "articles_api_url")) {
      updates.push("articles_api_url = ?");
      values.push(cleanText(payload.articles_api_url) || null);
    }
    if (payload.description !== undefined) { updates.push("description = ?"); values.push(cleanText(payload.description)); }
    if (payload.ai_context !== undefined) { updates.push("ai_context = ?"); values.push(cleanText(payload.ai_context)); }
    if (payload.status !== undefined) { updates.push("status = ?"); values.push(payload.status); }
    if (updates.length === 0) return errorResponse("No app fields to update", 400);
    const now = nowIso();
    updates.push("updated_at = ?");
    values.push(now);
    const filters = ["id = ?"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "studio_apps", filters, filterValues, userId);
    await env.DB.prepare(`UPDATE studio_apps SET ${updates.join(", ")} WHERE ${filters.join(" AND ")}`)
      .bind(...values, ...filterValues)
      .run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Studio app", 500);
  }
}

export async function deleteStudioApp(env: Env, appId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(appId);
    if (!Number.isFinite(id)) return errorResponse("Invalid app ID", 400);
    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "studio_apps", filters, values, userId);
    await env.DB.prepare(`DELETE FROM studio_apps WHERE ${filters.join(" AND ")}`).bind(...values).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete Studio app", 500);
  }
}

export async function listStudioCampaigns(env: Env, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const filters: string[] = [];
    const values: unknown[] = [];
    await appendScopedFilter(env, "studio_campaigns", filters, values, userId, "sc");
    const campaigns = await env.DB.prepare(
      `SELECT sc.*, sa.name AS app_name
       FROM studio_campaigns sc
       JOIN studio_apps sa ON sa.id = sc.app_id
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY sc.updated_at DESC, sc.id DESC`,
    ).bind(...values).all<Record<string, unknown>>();
    return jsonResponse((campaigns.results ?? []).map(mapCampaign));
  } catch {
    return errorResponse("Failed to load Studio campaigns", 500);
  }
}

export async function createStudioCampaign(
  env: Env,
  request: Request,
  userId = DEFAULT_USER_ID,
  actorUserId?: number | null,
): Promise<Response> {
  try {
    const payload = await parseJson<StudioCampaignPayload>(request);
    const appId = Number(payload.app_id);
    const name = cleanText(payload.name);
    const campaignType: StudioCampaignType = payload.campaign_type === "reply" ? "reply" : "post";
    const resultLimit = normalizeResultLimit(payload.result_limit);
    const platforms = normalizePlatforms(payload.platforms);
    const accountRefs = normalizeRefs(payload.account_refs);
    if (!Number.isFinite(appId) || appId <= 0) return errorResponse("App selection is required", 400);
    if (!name) return errorResponse("Campaign name is required", 400);
    if (platforms.length === 0) return errorResponse("Select at least one social platform", 400);
    if (campaignType === "reply" && platforms.some((platform) => !isReplyCapableStudioPlatform(platform))) {
      return errorResponse("Reply campaigns are available for Twitter/X, Threads, and Reddit only.", 400);
    }
    if (accountRefs.length === 0) return errorResponse("Select at least one connected account", 400);
    const now = nowIso();
    const hasCampaignType = await tableHasColumn(env, "studio_campaigns", "campaign_type");
    const hasResultLimit = await tableHasColumn(env, "studio_campaigns", "result_limit");
    const hasCreatedByUserId = await tableHasColumn(env, "studio_campaigns", "created_by_user_id");
    const scoped = await scopedInsertColumns(env, "studio_campaigns", userId);
    const columns = [...scoped.columns];
    const placeholders = [...scoped.columns.map(() => "?")];
    const values: unknown[] = [...scoped.values];
    if (hasCreatedByUserId) {
      columns.push("created_by_user_id");
      placeholders.push("?");
      values.push(ownerId(actorUserId));
    }
    columns.push("app_id", "name");
    placeholders.push("?", "?");
    values.push(appId, name);
    if (hasCampaignType) {
      columns.push("campaign_type");
      placeholders.push("?");
      values.push(campaignType);
    }
    if (hasResultLimit) {
      columns.push("result_limit");
      placeholders.push("?");
      values.push(resultLimit);
    }
    columns.push("account_refs", "platforms", "instructions", "status", "created_at", "updated_at");
    placeholders.push("?", "?", "?", "?", "?", "?");
    values.push(
      stringifyJson(accountRefs),
      stringifyJson(platforms),
      cleanText(payload.instructions),
      payload.status ?? "active",
      now,
      now,
    );
    const campaign = await env.DB.prepare(
      `INSERT INTO studio_campaigns (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
    )
      .bind(...values)
      .first<Record<string, unknown>>();
    return jsonResponse(mapCampaign(campaign ?? {}), { status: 201 });
  } catch (error) {
    console.error("Failed to create Studio campaign", error);
    return errorResponse("Failed to create Studio campaign", 500);
  }
}

export async function updateStudioCampaign(env: Env, campaignId: string, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(campaignId);
    if (!Number.isFinite(id)) return errorResponse("Invalid campaign ID", 400);
    const payload = await parseJson<StudioCampaignPayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.app_id !== undefined) { updates.push("app_id = ?"); values.push(Number(payload.app_id)); }
    if (payload.name !== undefined) { updates.push("name = ?"); values.push(cleanText(payload.name)); }
    if (payload.campaign_type !== undefined && await tableHasColumn(env, "studio_campaigns", "campaign_type")) {
      updates.push("campaign_type = ?");
      values.push(payload.campaign_type === "reply" ? "reply" : "post");
    }
    if (payload.result_limit !== undefined && await tableHasColumn(env, "studio_campaigns", "result_limit")) {
      updates.push("result_limit = ?");
      values.push(normalizeResultLimit(payload.result_limit));
    }
    const nextCampaignType = payload.campaign_type === "reply" ? "reply" : payload.campaign_type === "post" ? "post" : undefined;
    const nextPlatforms = payload.platforms !== undefined ? normalizePlatforms(payload.platforms) : undefined;
    if (nextCampaignType === "reply" && nextPlatforms?.some((platform) => !isReplyCapableStudioPlatform(platform))) {
      return errorResponse("Reply campaigns are available for Twitter/X, Threads, and Reddit only.", 400);
    }
    if (payload.account_refs !== undefined) { updates.push("account_refs = ?"); values.push(stringifyJson(normalizeRefs(payload.account_refs))); }
    if (nextPlatforms !== undefined) { updates.push("platforms = ?"); values.push(stringifyJson(nextPlatforms)); }
    if (payload.instructions !== undefined) { updates.push("instructions = ?"); values.push(cleanText(payload.instructions)); }
    if (payload.status !== undefined) { updates.push("status = ?"); values.push(payload.status); }
    if (updates.length === 0) return errorResponse("No campaign fields to update", 400);
    const now = nowIso();
    updates.push("updated_at = ?");
    values.push(now);
    const filters = ["id = ?"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "studio_campaigns", filters, filterValues, userId);
    await env.DB.prepare(`UPDATE studio_campaigns SET ${updates.join(", ")} WHERE ${filters.join(" AND ")}`)
      .bind(...values, ...filterValues)
      .run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Studio campaign", 500);
  }
}

export async function deleteStudioCampaign(env: Env, campaignId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(campaignId);
    if (!Number.isFinite(id)) return errorResponse("Invalid campaign ID", 400);
    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "studio_campaigns", filters, values, userId);
    await env.DB.prepare(`DELETE FROM studio_campaigns WHERE ${filters.join(" AND ")}`).bind(...values).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete Studio campaign", 500);
  }
}

export async function listStudioCrawlerRuns(env: Env, url?: URL, userId: number | null = DEFAULT_USER_ID): Promise<Response> {
  try {
    const status = url?.searchParams.get("status")?.trim();
    const limit = Math.max(1, Math.min(Number(url?.searchParams.get("limit") || 100), 200));
    const filters: string[] = [];
    const values: unknown[] = [];
    if (status) filters.push("scr.status = ?"), values.push(status);
    await appendScopedFilter(env, "studio_crawler_runs", filters, values, userId, "scr");
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
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
    const result = await statement.bind(...values, limit).all<Record<string, unknown>>();
    return jsonResponse((result.results ?? []).map(mapCrawlerRun));
  } catch {
    return errorResponse("Failed to load Studio crawler runs", 500);
  }
}

export async function createStudioCrawlerRun(
  env: Env,
  request: Request,
  userId = DEFAULT_USER_ID,
  actorUserId?: number | null,
): Promise<Response> {
  try {
    const payload = await parseJson<StudioCrawlerPayload>(request);
    let appId = Number(payload.app_id || 0);
    let accountRefs = normalizeRefs(payload.account_refs);
    let platforms = normalizePlatforms(payload.platforms);
    let instructions = cleanText(payload.instructions);
    let campaignType: StudioCampaignType = payload.campaign_type === "reply" ? "reply" : "post";
    let resultLimit = normalizeResultLimit(payload.result_limit);
    let requestedByUserId = ownerId(actorUserId);
    const campaignId = payload.campaign_id ? Number(payload.campaign_id) : null;
    if (campaignId) {
      const campaignFilters = ["id = ?"];
      const campaignValues: unknown[] = [campaignId];
      await appendScopedFilter(env, "studio_campaigns", campaignFilters, campaignValues, userId);
      const campaign = await env.DB.prepare(`SELECT * FROM studio_campaigns WHERE ${campaignFilters.join(" AND ")}`)
        .bind(...campaignValues)
        .first<Record<string, unknown>>();
      if (!campaign) return errorResponse("Campaign not found", 404);
      appId = Number(campaign.app_id);
      if (accountRefs.length === 0) accountRefs = decodeList(campaign.account_refs);
      if (platforms.length === 0) platforms = decodeList(campaign.platforms);
      if (!instructions) instructions = cleanText(campaign.instructions);
      campaignType = campaign.campaign_type === "reply" ? "reply" : "post";
      resultLimit = normalizeResultLimit(campaign.result_limit, resultLimit);
      if (!actorUserId) {
        requestedByUserId = ownerId(Number(campaign.created_by_user_id ?? campaign.user_id ?? DEFAULT_USER_ID));
      }
    }
    if (!Number.isFinite(appId) || appId <= 0) return errorResponse("App selection is required", 400);
    if (platforms.length === 0) return errorResponse("Select at least one social platform", 400);
    if (campaignType === "reply" && platforms.some((platform) => !isReplyCapableStudioPlatform(platform))) {
      return errorResponse("Reply campaigns are available for Twitter/X, Threads, and Reddit only.", 400);
    }
    if (!instructions) return errorResponse("Crawler instructions are required", 400);
    const appFilters = ["id = ?"];
    const appValues: unknown[] = [appId];
    await appendScopedFilter(env, "studio_apps", appFilters, appValues, userId);
    const app = await env.DB.prepare(`SELECT * FROM studio_apps WHERE ${appFilters.join(" AND ")}`)
      .bind(...appValues)
      .first<Record<string, unknown>>();
    if (!app) return errorResponse("App not found", 404);
    const { brief, generatedByAi, aiError } = await buildCrawlerBrief({
      env,
      app,
      campaignType,
      instructions,
      platforms,
      resultLimit,
    });
    const crawlerInstructions = crawlerBriefToInstructions(brief);
    const now = nowIso();
    const rawData = JSON.stringify({
      user_instructions: instructions,
      requested_results: resultLimit,
      requested_by_user_id: requestedByUserId,
      crawler_playbook: brief,
      crawler_playbook_generated_by_ai: generatedByAi,
      crawler_playbook_error: aiError ?? null,
      quality_attempts: 0,
    });
    const hasCampaignType = await tableHasColumn(env, "studio_crawler_runs", "campaign_type");
    const hasResultLimit = await tableHasColumn(env, "studio_crawler_runs", "result_limit");
    const hasRequestedByUserId = await tableHasColumn(env, "studio_crawler_runs", "requested_by_user_id");
    const scoped = await scopedInsertColumns(env, "studio_crawler_runs", userId);
    const columns = [...scoped.columns];
    const placeholders = [...scoped.columns.map(() => "?")];
    const values: unknown[] = [...scoped.values];
    if (hasRequestedByUserId) {
      columns.push("requested_by_user_id");
      placeholders.push("?");
      values.push(requestedByUserId);
    }
    columns.push("campaign_id", "app_id");
    placeholders.push("?", "?");
    values.push(campaignId, appId);
    if (hasCampaignType) {
      columns.push("campaign_type");
      placeholders.push("?");
      values.push(campaignType);
    }
    if (hasResultLimit) {
      columns.push("result_limit");
      placeholders.push("?");
      values.push(resultLimit);
    }
    columns.push("account_refs", "platforms", "instructions", "status", "raw_data", "created_at", "updated_at");
    placeholders.push("?", "?", "?", "'pending'", "?", "?", "?");
    values.push(
      stringifyJson(accountRefs),
      stringifyJson(platforms),
      crawlerInstructions,
      rawData,
      now,
      now,
    );
    const run = await env.DB.prepare(
      `INSERT INTO studio_crawler_runs (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
    )
      .bind(...values)
      .first<Record<string, unknown>>();
    return jsonResponse(mapCrawlerRun(run ?? {}), { status: 201 });
  } catch (error) {
    console.error("Failed to create Studio crawler run", error);
    return errorResponse("Failed to create Studio crawler run", 500);
  }
}

export async function updateStudioCrawlerRun(env: Env, runId: string, request: Request, userId: number | null = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(runId);
    if (!Number.isFinite(id)) return errorResponse("Invalid crawler run ID", 400);
    const payload = await parseJson<StudioCrawlerPayload>(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.status !== undefined) updates.push("status = ?"), values.push(payload.status);
    if (payload.result_limit !== undefined && await tableHasColumn(env, "studio_crawler_runs", "result_limit")) {
      updates.push("result_limit = ?");
      values.push(normalizeResultLimit(payload.result_limit));
    }
    if (payload.crawler_summary !== undefined) updates.push("crawler_summary = ?"), values.push(cleanText(payload.crawler_summary) || null);
    if (payload.raw_data !== undefined) updates.push("raw_data = ?"), values.push(typeof payload.raw_data === "string" ? payload.raw_data : JSON.stringify(payload.raw_data));
    if (payload.error_message !== undefined) updates.push("error_message = ?"), values.push(cleanText(payload.error_message) || null);
    if (payload.started_at !== undefined) updates.push("started_at = ?"), values.push(payload.started_at);
    if (payload.finished_at !== undefined) updates.push("finished_at = ?"), values.push(payload.finished_at);
    if (updates.length === 0 && payload.signals === undefined) return errorResponse("No crawler fields to update", 400);
    const now = nowIso();
    if (updates.length > 0) {
      updates.push("updated_at = ?");
      values.push(now);
      const filters = ["id = ?"];
      const filterValues: unknown[] = [id];
      await appendScopedFilter(env, "studio_crawler_runs", filters, filterValues, userId);
      await env.DB.prepare(`UPDATE studio_crawler_runs SET ${updates.join(", ")} WHERE ${filters.join(" AND ")}`)
        .bind(...values, ...filterValues)
        .run();
    }
    let signalIds: number[] = [];
    if (payload.signals !== undefined) {
      const filters = ["id = ?"];
      const values: unknown[] = [id];
      await appendScopedFilter(env, "studio_crawler_runs", filters, values, userId);
      const run = await env.DB.prepare(`SELECT * FROM studio_crawler_runs WHERE ${filters.join(" AND ")}`)
        .bind(...values)
        .first<Record<string, unknown>>();
      if (!run) return errorResponse("Crawler run not found", 404);
      signalIds = await replaceSignalsForRun(env, run, Array.isArray(payload.signals) ? payload.signals : [], now, true, userId);
    }
    return jsonResponse({ success: true, updated_at: now, signal_count: signalIds.length, signal_ids: signalIds });
  } catch {
    return errorResponse("Failed to update Studio crawler run", 500);
  }
}

export async function listStudioSignals(env: Env, url?: URL, userId: number | null = DEFAULT_USER_ID): Promise<Response> {
  try {
    const filters: string[] = [];
    const values: unknown[] = [];
    const runId = url?.searchParams.get("crawler_run_id");
    const campaignId = url?.searchParams.get("campaign_id");
    const status = url?.searchParams.get("status");
    if (runId) filters.push("ss.crawler_run_id = ?"), values.push(Number(runId));
    if (campaignId) filters.push("ss.campaign_id = ?"), values.push(Number(campaignId));
    if (status) filters.push("ss.status = ?"), values.push(status);
    await appendScopedFilter(env, "studio_signals", filters, values, userId, "ss");
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

export async function deleteStudioSignal(env: Env, signalId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(signalId);
    if (!Number.isFinite(id) || id <= 0) return errorResponse("Invalid signal ID", 400);
    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "studio_signals", filters, values, userId);
    const existing = await env.DB.prepare(`SELECT id FROM studio_signals WHERE ${filters.join(" AND ")}`)
      .bind(...values)
      .first<{ id: number }>();
    if (!existing) return errorResponse("Crawler result not found", 404);
    await env.DB.prepare(`DELETE FROM studio_signals WHERE ${filters.join(" AND ")}`).bind(...values).run();
    return jsonResponse({ success: true });
  } catch {
    return errorResponse("Failed to delete crawler result", 500);
  }
}

export async function createStudioSignals(env: Env, request: Request, userId: number | null = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<StudioSignalsBulkPayload>(request);
    const runId = Number(payload.crawler_run_id);
    if (!Number.isFinite(runId) || runId <= 0) return errorResponse("Crawler run ID is required", 400);
    const runFilters = ["id = ?"];
    const runValues: unknown[] = [runId];
    await appendScopedFilter(env, "studio_crawler_runs", runFilters, runValues, userId);
    const run = await env.DB.prepare(`SELECT * FROM studio_crawler_runs WHERE ${runFilters.join(" AND ")}`)
      .bind(...runValues)
      .first<Record<string, unknown>>();
    if (!run) return errorResponse("Crawler run not found", 404);
    const now = nowIso();
    const incomingSignals = Array.isArray(payload.signals) ? payload.signals : [];
    const signalIds = await replaceSignalsForRun(
      env,
      run,
      incomingSignals,
      now,
      payload.replace_existing !== false,
      userId,
    );
    const existingRawData = safeParseJson<Record<string, unknown>>(run.raw_data, {});
    const quality = assessCrawlerSignalQuality(run, incomingSignals);
    const brief = typeof existingRawData.crawler_playbook === "object" && existingRawData.crawler_playbook
      ? existingRawData.crawler_playbook as Partial<StudioCrawlerBrief>
      : null;
    const maxIterations = Number(brief?.retry_policy?.max_iterations ?? 5);
    const qualityAttempts = Number(existingRawData.quality_attempts ?? 0) + 1;
    const exhaustedSearch = quality.needs_more_search && qualityAttempts >= maxIterations;
    const requestedStatus = payload.status;
    const status: StudioCrawlerStatus = requestedStatus === "failed"
      ? "failed"
      : requestedStatus === "completed"
        ? "completed"
        : quality.needs_more_search && !exhaustedSearch
          ? "pending"
          : "completed";
    const nextRawData = {
      ...existingRawData,
      ...(payload.raw_data !== undefined
        ? {
          runner_raw_data: typeof payload.raw_data === "string"
            ? safeParseJson(payload.raw_data, payload.raw_data)
            : payload.raw_data,
        }
        : {}),
      quality_attempts: qualityAttempts,
      last_quality_assessment: quality,
      needs_more_search: status === "pending",
      search_exhausted: exhaustedSearch,
    };
    const updates: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];
    updates.push("status = ?");
    values.push(status);
    if (payload.crawler_summary !== undefined) {
      updates.push("crawler_summary = ?");
      values.push(cleanText(payload.crawler_summary) || null);
    }
    updates.push("raw_data = ?");
    values.push(JSON.stringify(nextRawData));
    if (status === "completed" || status === "failed") {
      updates.push("finished_at = COALESCE(finished_at, ?)");
      values.push(now);
    }
    await env.DB.prepare(`UPDATE studio_crawler_runs SET ${updates.join(", ")} WHERE ${runFilters.join(" AND ")}`)
      .bind(...values, ...runValues)
      .run();
    return jsonResponse({
      success: true,
      count: signalIds.length,
      ids: signalIds,
      status,
      needs_more_search: status === "pending",
      quality,
    });
  } catch {
    return errorResponse("Failed to save Studio signals", 500);
  }
}

export async function listStudioStrategistPosts(env: Env, url?: URL, userId: number | null = DEFAULT_USER_ID): Promise<Response> {
  try {
    const filters: string[] = [];
    const values: unknown[] = [];
    const runId = url?.searchParams.get("crawler_run_id");
    const campaignId = url?.searchParams.get("campaign_id");
    if (runId) filters.push("ssp.crawler_run_id = ?"), values.push(Number(runId));
    if (campaignId) filters.push("ssp.campaign_id = ?"), values.push(Number(campaignId));
    await appendScopedFilter(env, "studio_strategist_posts", filters, values, userId, "ssp");
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

export async function createStudioStrategistPosts(env: Env, request: Request, userId: number | null = DEFAULT_USER_ID): Promise<Response> {
  try {
    const payload = await parseJson<StudioStrategistBulkPayload>(request);
    const runId = Number(payload.crawler_run_id);
    if (!Number.isFinite(runId) || runId <= 0) return errorResponse("Crawler run ID is required", 400);
    const runFilters = ["id = ?"];
    const runValues: unknown[] = [runId];
    await appendScopedFilter(env, "studio_crawler_runs", runFilters, runValues, userId);
    const run = await env.DB.prepare(`SELECT * FROM studio_crawler_runs WHERE ${runFilters.join(" AND ")}`)
      .bind(...runValues)
      .first<Record<string, unknown>>();
    if (!run) return errorResponse("Crawler run not found", 404);
    const rawPosts = Array.isArray(payload.posts) ? payload.posts : [];
    const campaignType: StudioCampaignType = run.campaign_type === "reply" ? "reply" : "post";
    const rawData = safeParseJson<Record<string, unknown>>(run.raw_data, {});
    const rawBrief = typeof rawData.crawler_playbook === "object" && rawData.crawler_playbook
      ? rawData.crawler_playbook as Partial<StudioCrawlerBrief>
      : null;
    const maxSuggestions = normalizeResultLimit(run.result_limit ?? rawBrief?.strategist_rules?.max_suggestions ?? 10);
    const perSourcePostCount = new Map<string, number>();
    const posts: StudioStrategistPostPayload[] = [];
    let skippedBySourcePostLimit = 0;
    for (const post of rawPosts) {
      if (posts.length >= maxSuggestions) break;
      const platform = normalizePlatform(post.platform);
      if (campaignType === "reply") {
        const key = sourcePostKey(platform, post);
        const count = perSourcePostCount.get(key) ?? 0;
        if (count >= 2) {
          skippedBySourcePostLimit += 1;
          continue;
        }
        perSourcePostCount.set(key, count + 1);
      }
      posts.push(post);
    }
    const deleteFilters = ["crawler_run_id = ?"];
    const deleteValues: unknown[] = [runId];
    await appendScopedFilter(env, "studio_strategist_posts", deleteFilters, deleteValues, userId);
    await env.DB.prepare(`DELETE FROM studio_strategist_posts WHERE ${deleteFilters.join(" AND ")}`).bind(...deleteValues).run();
    const now = nowIso();
    const scoped = userId === null
      ? await scopedInsertColumnsFromRecord(env, "studio_strategist_posts", run)
      : await scopedInsertColumns(env, "studio_strategist_posts", userId);
    const createdIds: number[] = [];
    for (const post of posts) {
      const platform = normalizePlatform(post.platform);
      const postText = cleanText(post.post_text);
      if (!platform || !postText) continue;
      const mediaType = post.media_type === "photo" || post.media_type === "video" ? post.media_type : "none";
      const status: StudioPostStatus = mediaType === "none" || cleanText(post.media_url) ? "suggested" : "asset_needed";
      const result = await env.DB.prepare(
        `INSERT INTO studio_strategist_posts (
          ${scoped.columns.length ? `${scoped.columns.join(", ")},` : ""}
          crawler_run_id, campaign_id, app_id, platform, post_text, idea, rationale,
          target_url, target_external_id, target_author, target_text,
          media_type, media_url, status, created_at, updated_at
        )
        VALUES (${scoped.columns.length ? "?," : ""}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          ...scoped.values,
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
    return jsonResponse({
      success: true,
      count: createdIds.length,
      ids: createdIds,
      skipped_by_source_post_limit: skippedBySourcePostLimit,
    });
  } catch {
    return errorResponse("Failed to save Studio strategist posts", 500);
  }
}

export async function updateStudioStrategistPost(
  env: Env,
  postId: string,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
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
    values.push(now);
    const filters = ["id = ?"];
    const filterValues: unknown[] = [id];
    await appendScopedFilter(env, "studio_strategist_posts", filters, filterValues, userId);
    await env.DB.prepare(`UPDATE studio_strategist_posts SET ${updates.join(", ")} WHERE ${filters.join(" AND ")}`)
      .bind(...values, ...filterValues)
      .run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Studio strategist post", 500);
  }
}

export async function regenerateStudioStrategistPost(env: Env, postId: string, userId = DEFAULT_USER_ID): Promise<Response> {
  try {
    const id = Number(postId);
    if (!Number.isFinite(id)) return errorResponse("Invalid strategist post ID", 400);
    const filters = ["ssp.id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "studio_strategist_posts", filters, values, userId, "ssp");
    const post = await env.DB.prepare(
      `SELECT ssp.*, sa.name AS app_name, sa.description AS app_description, sa.ai_context AS app_ai_context,
              sc.name AS campaign_name, sc.instructions AS campaign_instructions,
              scr.instructions AS crawler_instructions, scr.campaign_type AS crawler_campaign_type
       FROM studio_strategist_posts ssp
       JOIN studio_apps sa ON sa.id = ssp.app_id
       LEFT JOIN studio_campaigns sc ON sc.id = ssp.campaign_id
       LEFT JOIN studio_crawler_runs scr ON scr.id = ssp.crawler_run_id
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(...values)
      .first<Record<string, unknown>>();
    if (!post) return errorResponse("Strategist post not found", 404);
    if (post.status === "posted") return errorResponse("Posted suggestions cannot be regenerated.", 400);

    const settings = await readStudioAiSettings(env, userId);
    if (!settings.geminiApiKey) return errorResponse("No Gemini API key is configured", 500);

    const campaignType: StudioCampaignType = post.crawler_campaign_type === "reply" ? "reply" : "post";
    const isReply = campaignType === "reply"
      || Boolean(cleanText(post.target_external_id) || cleanText(post.target_url) || cleanText(post.target_text));
    const promptLines = isReply
      ? [
          `Platform: ${normalizePlatform(post.platform)}`,
          `App: ${cleanText(post.app_name)}`,
          `App description: ${cleanText(post.app_description) || "None"}`,
          `App AI context: ${cleanText(post.app_ai_context) || "None"}`,
          `Campaign: ${cleanText(post.campaign_name) || "Unknown"}`,
          `Campaign instructions: ${cleanText(post.campaign_instructions) || cleanText(post.crawler_instructions) || "None"}`,
          `Comment author: ${cleanText(post.target_author) || "Unknown"}`,
          `Comment link: ${cleanText(post.target_url) || "Unknown"}`,
          `Comment text: ${cleanText(post.target_text) || "Unknown"}`,
          `Previous reply suggestion: ${cleanText(post.post_text) || "None"}`,
          "Generate a stronger alternative reply suggestion.",
        ]
      : [
          `Platform: ${normalizePlatform(post.platform)}`,
          `App: ${cleanText(post.app_name)}`,
          `App description: ${cleanText(post.app_description) || "None"}`,
          `App AI context: ${cleanText(post.app_ai_context) || "None"}`,
          `Campaign: ${cleanText(post.campaign_name) || "Unknown"}`,
          `Campaign instructions: ${cleanText(post.campaign_instructions) || cleanText(post.crawler_instructions) || "None"}`,
          `Previous post suggestion: ${cleanText(post.post_text) || "None"}`,
          "Generate a stronger alternative post suggestion for this campaign.",
        ];

    const responseText = await callAiText({
      apiKey: settings.geminiApiKey,
      model: settings.geminiProModel,
      fallbackModel: settings.geminiFlashModel,
      maxTokens: 700,
      system: [
        "You are a senior social media strategist.",
        isReply
          ? "Regenerate one better reply suggestion for the same target comment."
          : "Regenerate one better social post suggestion for this campaign.",
        isReply
          ? "Keep it natural, useful, concise, non-spammy, and specific to the comment context."
          : "Keep it natural, useful, concise, non-spammy, and specific to the campaign context.",
        "Do not mention that you are AI. Do not use hashtags unless the context clearly needs them.",
        "Return JSON only: {\"post_text\":\"...\",\"idea\":\"...\",\"rationale\":\"...\"}.",
        settings.globalAiRules ? `Global AI rules: ${settings.globalAiRules}` : "",
      ].filter(Boolean).join("\n"),
      messages: [
        {
          role: "user",
          content: promptLines.join("\n"),
        },
      ],
    });
    const parsed = safeParseJsonObject(responseText);
    const postText = cleanText(parsed?.post_text);
    if (!postText) return errorResponse(`AI did not return a valid ${isReply ? "reply" : "post"} suggestion`, 502);
    const now = nowIso();
    await env.DB.prepare(
      `UPDATE studio_strategist_posts
       SET post_text = ?, idea = ?, rationale = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        postText,
        cleanText(parsed?.idea) || cleanText(post.idea),
        cleanText(parsed?.rationale) || (isReply
          ? "Regenerated by AI for the same target comment."
          : "Regenerated by AI for the post campaign."),
        post.media_type === "photo" || post.media_type === "video"
          ? cleanText(post.media_url) ? "suggested" : "asset_needed"
          : "suggested",
        now,
        id,
      )
      .run();
    const updated = await env.DB.prepare(
      `SELECT ssp.*, sa.name AS app_name, sc.name AS campaign_name, scr.status AS crawler_status
       FROM studio_strategist_posts ssp
       JOIN studio_apps sa ON sa.id = ssp.app_id
       LEFT JOIN studio_campaigns sc ON sc.id = ssp.campaign_id
       LEFT JOIN studio_crawler_runs scr ON scr.id = ssp.crawler_run_id
       WHERE ssp.id = ?`,
    )
      .bind(id)
      .first<Record<string, unknown>>();
    return jsonResponse(mapStrategistPost(updated ?? {}));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate Studio strategist post";
    return errorResponse(message, 500);
  }
}

export async function scheduleStudioStrategistPost(
  env: Env,
  postId: string,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(postId);
    if (!Number.isFinite(id)) return errorResponse("Invalid strategist post ID", 400);
    const payload = await parseJson<{ scheduled_at?: string | null; media_url?: string | null }>(request);
    const postFilters = ["ssp.id = ?"];
    const postValues: unknown[] = [id];
    await appendScopedFilter(env, "studio_strategist_posts", postFilters, postValues, userId, "ssp");
    const post = await env.DB.prepare(
      `SELECT ssp.*, scr.account_refs, scr.campaign_type, scr.instructions AS crawler_instructions
       FROM studio_strategist_posts ssp
       JOIN studio_crawler_runs scr ON scr.id = ssp.crawler_run_id
       WHERE ${postFilters.join(" AND ")}`,
    )
      .bind(...postValues)
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
    if (!isStudioPlatform(platform)) {
      return errorResponse("This Studio platform is not supported for scheduling.", 400);
    }
    if (campaignType === "reply" && !isReplyCapableStudioPlatform(platform)) {
      return errorResponse("Reply campaigns are available for Twitter/X, Threads, and Reddit only.", 400);
    }
    if (campaignType === "reply" && !replyToId) {
      return errorResponse("Reply suggestions need a target post/comment ID before scheduling.", 400);
    }
    if (campaignType === "post" && platform === "instagram" && !mediaUrl) {
      return errorResponse("Instagram Studio posts need an attached image before scheduling.", 400);
    }
    const scheduledAt = payload.scheduled_at || await chooseAutoSchedule(env, accountId, platform, campaignType, userId);
    const subreddit = platform === "reddit"
      ? extractSubreddit(`${post.crawler_instructions ?? ""}\n${post.idea ?? ""}\n${post.rationale ?? ""}\n${post.post_text ?? ""}`)
      : null;
    if (campaignType === "post" && platform === "reddit" && !subreddit) {
      return errorResponse("Reddit Studio posts need a subreddit in the campaign or crawler instructions, for example r/SaaS or subreddit: SaaS.", 400);
    }
    const capabilities = await getSocialPostSchemaCapabilities(env);
    const scopedSocial = await scopedInsertColumns(env, "social_posts", userId);
    const columns = [...scopedSocial.columns, "platform", "content", "image_url", "status", "scheduled_at", "created_by", "created_at", "updated_at"];
    const values: Array<string | number | null> = [
      ...(scopedSocial.values as number[]),
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
      values.push(accountIdForSocialPosts(platform, accountId));
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
    const scopedPlanner = await scopedInsertColumns(env, "planner_items", userId);
    const plannerTitle = `${PLATFORM_LABELS[platform] ?? platform} ${campaignType}: ${cleanText(post.idea) || cleanText(post.post_text).slice(0, 72)}`;
    const plannerDescription = campaignType === "reply" && cleanText(post.target_url)
      ? `${cleanText(post.post_text)}\n\nTarget: ${cleanText(post.target_url)}`
      : cleanText(post.post_text);
    const plannerResult = hasSocialPostLinks
      ? await env.DB.prepare(
        `INSERT INTO planner_items (
          ${scopedPlanner.columns.length ? `${scopedPlanner.columns.join(", ")},` : ""}
          title, description, item_type, platform, status, scheduled_for, social_post_id, account_id, instruction, created_by, created_at, updated_at
        )
        VALUES (${scopedPlanner.columns.length ? "?," : ""}?, ?, 'post', ?, 'approved', ?, ?, ?, ?, 'studio', ?, ?)`,
      )
        .bind(...scopedPlanner.values, plannerTitle, plannerDescription, platform, scheduledAt, socialPostId, accountId, cleanText(post.rationale), now, now)
        .run() as { meta: { last_row_id: number } }
      : await env.DB.prepare(
        `INSERT INTO planner_items (
          ${scopedPlanner.columns.length ? `${scopedPlanner.columns.join(", ")},` : ""}
          title, description, item_type, platform, status, scheduled_for, account_id, instruction, created_by, created_at, updated_at
        )
        VALUES (${scopedPlanner.columns.length ? "?," : ""}?, ?, 'post', ?, 'approved', ?, ?, ?, 'studio', ?, ?)`,
      )
        .bind(...scopedPlanner.values, plannerTitle, plannerDescription, platform, scheduledAt, accountId, cleanText(post.rationale), now, now)
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
      userId,
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

export async function unpostStudioStrategistPost(
  env: Env,
  postId: string,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(postId);
    if (!Number.isFinite(id)) return errorResponse("Invalid strategist post ID", 400);

    const postFilters = ["id = ?"];
    const postValues: unknown[] = [id];
    await appendScopedFilter(env, "studio_strategist_posts", postFilters, postValues, userId);
    const post = await env.DB.prepare(`SELECT * FROM studio_strategist_posts WHERE ${postFilters.join(" AND ")}`)
      .bind(...postValues)
      .first<Record<string, unknown>>();
    if (!post) return errorResponse("Strategist post not found", 404);
    if (post.status === "posted") return errorResponse("Already posted suggestions cannot be unposted from Studio.", 400);

    const socialPostId = Number(post.social_post_id ?? 0) || null;
    const plannerItemId = Number(post.planner_item_id ?? 0) || null;
    const hasPlannerSocialPostLinks = socialPostId ? await plannerHasSocialPostLinks(env) : false;

    if (socialPostId) {
      const socialFilters = ["id = ?"];
      const socialValues: unknown[] = [socialPostId];
      await appendScopedFilter(env, "social_posts", socialFilters, socialValues, userId);
      const socialPost = await env.DB.prepare(
        `SELECT id, status, external_id FROM social_posts WHERE ${socialFilters.join(" AND ")}`,
      )
        .bind(...socialValues)
        .first<Record<string, unknown>>();
      if (socialPost?.status === "posted" || cleanText(socialPost?.external_id)) {
        return errorResponse("This suggestion is already published and cannot be unposted from Studio.", 400);
      }
    }

    if (plannerItemId) {
      const plannerFilters = ["id = ?"];
      const plannerValues: unknown[] = [plannerItemId];
      await appendScopedFilter(env, "planner_items", plannerFilters, plannerValues, userId);
      await env.DB.prepare(`DELETE FROM planner_items WHERE ${plannerFilters.join(" AND ")}`)
        .bind(...plannerValues)
        .run();
    }

    if (socialPostId && hasPlannerSocialPostLinks) {
      const linkedPlannerFilters = ["social_post_id = ?"];
      const linkedPlannerValues: unknown[] = [socialPostId];
      await appendScopedFilter(env, "planner_items", linkedPlannerFilters, linkedPlannerValues, userId);
      await env.DB.prepare(`DELETE FROM planner_items WHERE ${linkedPlannerFilters.join(" AND ")}`)
        .bind(...linkedPlannerValues)
        .run();
    }

    if (socialPostId) {
      const socialFilters = ["id = ?"];
      const socialValues: unknown[] = [socialPostId];
      await appendScopedFilter(env, "social_posts", socialFilters, socialValues, userId);
      await env.DB.prepare(`DELETE FROM social_posts WHERE ${socialFilters.join(" AND ")}`)
        .bind(...socialValues)
        .run();
    }

    const nextStatus: StudioPostStatus = (post.media_type === "photo" || post.media_type === "video") && !cleanText(post.media_url)
      ? "asset_needed"
      : "suggested";
    const now = nowIso();
    await env.DB.prepare(
      `UPDATE studio_strategist_posts
       SET status = ?, social_post_id = NULL, planner_item_id = NULL, scheduled_at = NULL, updated_at = ?
       WHERE ${postFilters.join(" AND ")}`,
    )
      .bind(nextStatus, now, ...postValues)
      .run();

    await enqueueStudioNotification(
      env,
      `"${cleanText(post.post_text)}" returned to Studio suggestions.`,
      "studio_strategist_post",
      id,
      userId,
    );

    return jsonResponse({
      success: true,
      strategist_post_id: id,
      status: nextStatus,
      deleted_social_post_id: socialPostId,
      deleted_planner_item_id: plannerItemId,
      updated_at: now,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to unpost Studio suggestion", 500);
  }
}

export async function listStudioNotifications(env: Env, url?: URL, userId: number | null = DEFAULT_USER_ID): Promise<Response> {
  try {
    const status = url?.searchParams.get("status") || "pending";
    const limit = Math.max(1, Math.min(Number(url?.searchParams.get("limit") || 20), 50));
    const filters = ["status = ?"];
    const values: unknown[] = [status];
    await appendScopedFilter(env, "studio_notifications", filters, values, userId);
    const rows = await env.DB.prepare(
      `SELECT * FROM studio_notifications
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at ASC
       LIMIT ?`,
    )
      .bind(...values, limit)
      .all();
    return jsonResponse(rows.results ?? []);
  } catch {
    return errorResponse("Failed to load Studio notifications", 500);
  }
}

export async function updateStudioNotification(
  env: Env,
  notificationId: string,
  request: Request,
  userId = DEFAULT_USER_ID,
): Promise<Response> {
  try {
    const id = Number(notificationId);
    if (!Number.isFinite(id)) return errorResponse("Invalid notification ID", 400);
    const payload = await parseJson<StudioNotificationPayload>(request);
    const now = nowIso();
    const filters = ["id = ?"];
    const values: unknown[] = [id];
    await appendScopedFilter(env, "studio_notifications", filters, values, userId);
    await env.DB.prepare(
      `UPDATE studio_notifications
       SET status = ?, error_message = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ?
       WHERE ${filters.join(" AND ")}`,
    )
      .bind(payload.status ?? "sent", cleanText(payload.error_message) || null, payload.status ?? "sent", now, now, ...values)
      .run();
    return jsonResponse({ success: true, updated_at: now });
  } catch {
    return errorResponse("Failed to update Studio notification", 500);
  }
}

export async function getStudioSummary(env: Env, userId = DEFAULT_USER_ID): Promise<Response> {
  const [accounts, apps, campaigns, crawlerRuns, signals, posts] = await Promise.all([
    listStudioAccounts(env, userId).then((response) => response.json()),
    listStudioApps(env, userId).then((response) => response.json()),
    listStudioCampaigns(env, userId).then((response) => response.json()),
    listStudioCrawlerRuns(env, undefined, userId).then((response) => response.json()),
    listStudioSignals(env, undefined, userId).then((response) => response.json()),
    listStudioStrategistPosts(env, undefined, userId).then((response) => response.json()),
  ]);
  return jsonResponse({ accounts, apps, campaigns, crawler_runs: crawlerRuns, signals, strategist_posts: posts });
}
