import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import type { Env } from "../lib/types";
import {
  createSocialPost,
  deleteSocialPost,
  listSocialPosts,
  publishTwitterPost,
  updateSocialPost,
} from "./twitter";
import {
  createPlannerItem,
  deletePlannerItem,
  listPlannerItems,
  plannerHasSocialPostLinks,
  updatePlannerItem,
} from "./planner";
import {
  createStudioApp,
  createStudioCampaign,
  createStudioCrawlerRun,
  createStudioStrategistPosts,
  deleteStudioApp,
  deleteStudioCampaign,
  deleteStudioSignal,
  getStudioSummary,
  listStudioAccounts,
  listStudioApps,
  listStudioCampaigns,
  listStudioCrawlerRuns,
  listStudioSignals,
  listStudioStrategistPosts,
  regenerateStudioStrategistPost,
  scheduleStudioStrategistPost,
  updateStudioApp,
  updateStudioCampaign,
  updateStudioStrategistPost,
} from "./studio";
import { publishThreadsPost } from "./threads";
import { publishRedditPost } from "./reddit";
import { publishExtraSocialPost } from "./social-accounts";
import { DEFAULT_USER_ID, appendScopedFilter } from "../lib/ownership";
import {
  CHATGPT_OAUTH_SCOPES,
  chatGptMcpResource,
  chatGptOAuthChallenge,
  handleChatGptOAuthRequest,
  validateChatGptAccessToken,
} from "./chatgpt-oauth";
import { requireMcpScopes } from "./mcp-scopes";

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type McpAuthContext = {
  authMode: "internal" | "oauth";
  userId: number;
  scopeId: number;
  workspaceId: number;
  scopes: string[];
};

const SOCIAL_PLATFORMS = ["threads", "twitter", "reddit", "instagram"] as const;
const STUDIO_CAMPAIGN_TYPES = ["post", "reply"] as const;
const STUDIO_APP_STATUSES = ["active", "inactive", "archived"] as const;
const STUDIO_CAMPAIGN_STATUSES = ["active", "paused", "archived"] as const;
const STUDIO_POST_STATUSES = ["suggested", "asset_needed", "scheduled", "posted", "dismissed"] as const;
const STUDIO_MEDIA_TYPES = ["none", "photo", "video"] as const;
const ACTIVE_PLANNER_STATUSES = new Set(["planned", "drafting", "approved"]);
const ACTIVE_SOCIAL_STATUSES = new Set(["draft", "approved", "scheduled"]);
const KL_OFFSET = "+08:00";
const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const PLANNING_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const DESTRUCTIVE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const EXTERNAL_DESTRUCTIVE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;
const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: [...CHATGPT_OAUTH_SCOPES] }] as const;
const OAUTH_TOOL_META = {
  securitySchemes: OAUTH_SECURITY_SCHEMES,
} as const;

const SOCIAL_POST_UPDATE_INPUT_SCHEMA = {
  post_id: z.number().int().positive(),
  content: z.string().optional(),
  scheduled_at: z.string().nullable().optional(),
  status: z.string().optional(),
  image_url: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  title: z.string().nullable().optional(),
  subreddit: z.string().nullable().optional(),
  account_id: z.number().int().positive().nullable().optional(),
  reply_to_id: z.string().nullable().optional(),
} as const;

function normalizePlatform(platform: string): (typeof SOCIAL_PLATFORMS)[number] {
  const normalized = platform.trim().toLowerCase();
  if (normalized === "thread") return "threads";
  if (normalized === "x" || normalized === "twitter/x") return "twitter";
  if (normalized === "ig") return "instagram";
  if (SOCIAL_PLATFORMS.includes(normalized as (typeof SOCIAL_PLATFORMS)[number])) {
    return normalized as (typeof SOCIAL_PLATFORMS)[number];
  }
  throw new Error("Unsupported platform. Use threads, twitter, reddit, or instagram.");
}

async function responseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    const message = typeof parsed === "object" && parsed && "error" in parsed
      ? String((parsed as { error?: unknown }).error)
      : raw || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return parsed as T;
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function urlWithParams(requestUrl: string, params: Record<string, string | number | null | undefined>): URL {
  const url = new URL(requestUrl);
  url.search = "";
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function toolText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function presentSocialPost(post: Record<string, unknown>, fallbackPlatform?: string) {
  return {
    id: post.id ?? null,
    post_id: post.id ?? null,
    platform: post.platform ?? fallbackPlatform ?? null,
    status: post.status ?? null,
    content: post.content ?? "",
    title: post.title ?? null,
    subreddit: post.subreddit ? `r/${String(post.subreddit).replace(/^r\//i, "")}` : null,
    image_url: post.image_url ?? null,
    scheduled_at: post.scheduled_at ?? null,
    posted_at: post.posted_at ?? null,
    last_error: post.last_error ?? null,
    created_at: post.created_at ?? null,
    updated_at: post.updated_at ?? null,
  };
}

function presentSocialPostsByPlatform(posts: Record<string, Record<string, unknown>[]>) {
  return Object.fromEntries(
    Object.entries(posts).map(([platform, values]) => [
      platform,
      values.map((post) => presentSocialPost(post, platform)),
    ]),
  );
}

function presentPlannerItem(item: Record<string, unknown> | null) {
  if (!item) return null;
  return {
    id: item.id ?? null,
    planner_item_id: item.id ?? null,
    social_post_id: item.social_post_id ?? null,
    title: item.title ?? null,
    description: item.description ?? null,
    item_type: item.item_type ?? null,
    platform: item.platform ?? null,
    status: item.status ?? null,
    scheduled_for: item.scheduled_for ?? null,
    created_at: item.created_at ?? null,
    updated_at: item.updated_at ?? null,
  };
}

async function configuredAgentToken(env: Env): Promise<string> {
  if (env.TRADING_AGENT_SYNC_SECRET) return env.TRADING_AGENT_SYNC_SECRET;

  const row = await env.DB.prepare(
    "SELECT value FROM app_settings WHERE key = 'trading_agent_token' ORDER BY updated_at DESC LIMIT 1",
  ).first<{ value: string }>();
  return row?.value ?? "";
}

async function configuredMcpToken(env: Env): Promise<string> {
  if (env.MCP_CONNECTOR_TOKEN) return env.MCP_CONNECTOR_TOKEN;
  return configuredAgentToken(env);
}

function timingSafeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function hasSharedMcpToken(request: Request, env: Env): Promise<boolean> {
  const acceptedTokens = new Set(
    [await configuredMcpToken(env), await configuredAgentToken(env)].map((value) => value.trim()).filter(Boolean),
  );
  const authHeader = request.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  const urlToken = new URL(request.url).searchParams.get("token")?.trim() ?? "";

  for (const token of acceptedTokens) {
    if ((bearerToken && timingSafeEqual(bearerToken, token)) || (urlToken && timingSafeEqual(urlToken, token))) {
      return true;
    }
  }
  return false;
}

async function resolveMcpAuthContext(request: Request, env: Env): Promise<McpAuthContext | Response> {
  if (await hasSharedMcpToken(request, env)) {
    return {
      authMode: "internal",
      userId: DEFAULT_USER_ID,
      scopeId: DEFAULT_USER_ID,
      workspaceId: DEFAULT_USER_ID,
      scopes: [...CHATGPT_OAUTH_SCOPES],
    };
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  const tokenValidation = await validateChatGptAccessToken(env, bearerToken, chatGptMcpResource(request), []);
  if (tokenValidation.ok) {
    return {
      authMode: "oauth",
      userId: tokenValidation.context.userId,
      scopeId: tokenValidation.context.scopeId,
      workspaceId: tokenValidation.context.workspaceId,
      scopes: tokenValidation.context.scopes,
    };
  }

  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": chatGptOAuthChallenge(request, tokenValidation.error, tokenValidation.description),
    },
  });
}

async function readJsonFromHandler<T>(handlerResponse: Promise<Response>): Promise<T> {
  return responseJson<T>(await handlerResponse);
}

async function listPostsForPlatform(env: Env, platform: string, scopeId = DEFAULT_USER_ID) {
  return readJsonFromHandler<Record<string, unknown>[]>(
    listSocialPosts(env, normalizePlatform(platform), scopeId),
  );
}

async function allSocialPosts(env: Env, scopeId = DEFAULT_USER_ID) {
  const entries = await Promise.all(
    SOCIAL_PLATFORMS.map(async (platform) => [platform, await listPostsForPlatform(env, platform, scopeId)] as const),
  );
  return Object.fromEntries(entries);
}

function dateKey(value: string): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

async function occupiedSocialDates(env: Env, scopeId = DEFAULT_USER_ID): Promise<Set<string>> {
  const occupied = new Set<string>();
  const socialPosts = await allSocialPosts(env, scopeId);

  for (const posts of Object.values(socialPosts)) {
    for (const post of posts) {
      const status = String(post.status ?? "").toLowerCase();
      const scheduledAt = typeof post.scheduled_at === "string" ? post.scheduled_at : "";
      const postedAt = typeof post.posted_at === "string" ? post.posted_at : "";
      const dateSource = status === "posted" ? postedAt || scheduledAt : scheduledAt;
      const key = dateSource && (ACTIVE_SOCIAL_STATUSES.has(status) || status === "posted") ? dateKey(dateSource) : null;
      if (key) occupied.add(key);
    }
  }

  const plannerItems = await readJsonFromHandler<Record<string, unknown>[]>(
    listPlannerItems(env, scopeId),
  );
  for (const item of plannerItems) {
    const itemType = String(item.item_type ?? "");
    const status = String(item.status ?? "").toLowerCase();
    const platform = String(item.platform ?? "").toLowerCase();
    const scheduledFor = typeof item.scheduled_for === "string" ? item.scheduled_for : "";
    if (
      itemType === "post"
      && ACTIVE_PLANNER_STATUSES.has(status)
      && ["threads", "thread", "twitter", "x", "twitter/x", "reddit", "instagram", "ig"].includes(platform)
    ) {
      const key = scheduledFor ? dateKey(scheduledFor) : null;
      if (key) occupied.add(key);
    }
  }

  return occupied;
}

function localDateParts(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function addDays(parts: { year: number; month: number; day: number }, days: number) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 0, 0, 0));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function formatDate(parts: { year: number; month: number; day: number }) {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

async function findNextFreeSlot(
  env: Env,
  scopeId = DEFAULT_USER_ID,
  startDate?: string | null,
  preferredTime = "09:00",
  timezoneOffset = KL_OFFSET,
) {
  const occupied = await occupiedSocialDates(env, scopeId);
  const normalizedStart = startDate?.trim()
    ? dateKey(startDate.trim()) ?? startDate.trim().slice(0, 10)
    : formatDate(localDateParts(new Date()));
  const [year, month, day] = normalizedStart.split("-").map(Number);
  const cleanTime = /^\d{2}:\d{2}$/.test(preferredTime) ? preferredTime : "09:00";
  const cleanOffset = /^[+-]\d{2}:\d{2}$/.test(timezoneOffset) ? timezoneOffset : KL_OFFSET;

  for (let offset = 0; offset < 60; offset += 1) {
    const candidate = addDays({ year, month, day }, offset);
    const candidateDate = formatDate(candidate);
    const scheduledAt = `${candidateDate}T${cleanTime}:00${cleanOffset}`;
    if (!occupied.has(candidateDate) && new Date(scheduledAt).getTime() > Date.now()) {
      return {
        scheduled_at: scheduledAt,
        date: candidateDate,
        skipped_dates: Array.from(occupied).sort().filter((value) => value >= normalizedStart && value < candidateDate),
      };
    }
  }

  throw new Error("No free social posting day found in the next 60 days.");
}

async function createLinkedPlannerItem(
  env: Env,
  requestUrl: string,
  post: Record<string, unknown>,
  scheduledAt: string,
  scopeId = DEFAULT_USER_ID,
) {
  const socialPostId = Number(post.id ?? 0);
  if (!scheduledAt || !socialPostId || !(await plannerHasSocialPostLinks(env))) return null;

  const platform = normalizePlatform(String(post.platform ?? "threads"));
  const content = String(post.content ?? "");
  const titleSource = platform === "reddit" ? String(post.title ?? "").trim() || content : content;
  return readJsonFromHandler<Record<string, unknown>>(
    createPlannerItem(
      env,
      jsonRequest(requestUrl, {
        title: `${platform[0].toUpperCase()}${platform.slice(1)} post: ${titleSource.slice(0, 80) || "Scheduled post"}`,
        description: content || null,
        item_type: "post",
        platform,
        status: "planned",
        scheduled_for: scheduledAt,
        social_post_id: socialPostId,
      }),
      scopeId,
    ),
  );
}

async function plannerItemForPost(env: Env, postId: number, scopeId = DEFAULT_USER_ID) {
  const items = await readJsonFromHandler<Record<string, unknown>[]>(listPlannerItems(env, scopeId));
  return items.find((item) => Number(item.social_post_id ?? 0) === postId) ?? null;
}

async function syncPlannerSchedule(env: Env, requestUrl: string, postId: number, scheduledAt: string, status = "approved", scopeId = DEFAULT_USER_ID) {
  const post = await getPostById(env, postId, scopeId);
  const existing = await plannerItemForPost(env, postId, scopeId);
  if (existing?.id) {
    return readJsonFromHandler<Record<string, unknown>>(
      updatePlannerItem(
        env,
        String(existing.id),
        jsonRequest(requestUrl, {
          status,
          scheduled_for: scheduledAt,
          platform: post.platform,
          title: `${String(post.platform)[0].toUpperCase()}${String(post.platform).slice(1)} post: ${String(post.content ?? "").slice(0, 80) || "Scheduled post"}`,
          description: post.content || null,
          social_post_id: postId,
        }),
        scopeId,
      ),
    );
  }
  return createLinkedPlannerItem(env, requestUrl, post, scheduledAt, scopeId);
}

async function getPostById(env: Env, id: number, scopeId = DEFAULT_USER_ID): Promise<Record<string, unknown>> {
  for (const [platform, posts] of Object.entries(await allSocialPosts(env, scopeId))) {
    const post = posts.find((item) => Number(item.id ?? 0) === id);
    if (post) return { ...post, platform };
  }
  throw new Error(`Social post #${id} was not found.`);
}

async function getStudioStrategistPostById(env: Env, id: number, scopeId = DEFAULT_USER_ID): Promise<Record<string, unknown>> {
  const filters = ["id = ?"];
  const values: unknown[] = [id];
  await appendScopedFilter(env, "studio_strategist_posts", filters, values, scopeId);
  const post = await env.DB.prepare(`SELECT * FROM studio_strategist_posts WHERE ${filters.join(" AND ")}`)
    .bind(...values)
    .first<Record<string, unknown>>();
  if (!post) throw new Error(`Studio strategist post #${id} was not found.`);
  return post;
}

async function deleteStudioStrategistPost(env: Env, postId: number, deleteLinkedSocialPost: boolean, scopeId = DEFAULT_USER_ID) {
  const post = await getStudioStrategistPostById(env, postId, scopeId);
  const socialPostId = Number(post.social_post_id ?? 0);
  const plannerItemId = Number(post.planner_item_id ?? 0);
  if (socialPostId && !deleteLinkedSocialPost) {
    throw new Error("This Studio post is already linked to a social post. Set delete_linked_social_post=true to delete both.");
  }
  if (socialPostId) {
    await readJsonFromHandler(deleteSocialPost(env, String(socialPostId), scopeId));
  } else if (plannerItemId) {
    await readJsonFromHandler(deletePlannerItem(env, String(plannerItemId), scopeId));
  }
  const filters = ["id = ?"];
  const values: unknown[] = [postId];
  await appendScopedFilter(env, "studio_strategist_posts", filters, values, scopeId);
  await env.DB.prepare(`DELETE FROM studio_strategist_posts WHERE ${filters.join(" AND ")}`).bind(...values).run();
  return {
    success: true,
    deleted_studio_post_id: postId,
    deleted_social_post_id: socialPostId || null,
    deleted_planner_item_id: socialPostId ? null : plannerItemId || null,
  };
}

function createBlogposterMcpServer(env: Env, requestUrl: string, auth: McpAuthContext) {
  const server = new McpServer({
    name: "blogposter-dashboard",
    version: "1.0.0",
  });

  if (auth.authMode === "internal") {
  server.registerTool(
    "get_marketing_studio_summary",
    {
      title: "Get marketing studio summary",
      description: "Read the full Oilor Studio state: connected accounts, apps, campaigns, crawler runs, signals, and strategist posts.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {},
    },
    async () => toolText(await readJsonFromHandler(getStudioSummary(env, auth.scopeId))),
  );

  server.registerTool(
    "list_marketing_accounts",
    {
      title: "List marketing accounts",
      description: "List connected social accounts available for Marketing Studio campaigns. Use refs such as twitter:1, threads:2, or reddit:3 in campaign account_refs.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {},
    },
    async () => toolText(await readJsonFromHandler(listStudioAccounts(env, auth.scopeId))),
  );

  server.registerTool(
    "list_marketing_apps",
    {
      title: "List marketing apps",
      description: "List apps/products configured in the Marketing Studio.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {},
    },
    async () => toolText(await readJsonFromHandler(listStudioApps(env, auth.scopeId))),
  );

  server.registerTool(
    "create_marketing_app",
    {
      title: "Create marketing app",
      description: "Create a product/app profile in Marketing Studio with positioning context for AI planning. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        name: z.string(),
        website_url: z.string().nullable().optional(),
        app_store_url: z.string().nullable().optional(),
        articles_api_url: z.string().nullable().optional(),
        description: z.string().optional(),
        ai_context: z.string().optional(),
        status: z.enum(STUDIO_APP_STATUSES).default("active"),
      },
    },
    async (input) => toolText(await readJsonFromHandler(
      createStudioApp(env, jsonRequest(requestUrl, input), auth.scopeId),
    )),
  );

  server.registerTool(
    "update_marketing_app",
    {
      title: "Update marketing app",
      description: "Edit a Marketing Studio app/profile. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        app_id: z.number().int().positive(),
        name: z.string().optional(),
        website_url: z.string().nullable().optional(),
        app_store_url: z.string().nullable().optional(),
        articles_api_url: z.string().nullable().optional(),
        description: z.string().optional(),
        ai_context: z.string().optional(),
        status: z.enum(STUDIO_APP_STATUSES).optional(),
      },
    },
    async ({ app_id, ...changes }) => toolText(await readJsonFromHandler(
      updateStudioApp(env, String(app_id), jsonRequest(requestUrl, changes), auth.scopeId),
    )),
  );

  server.registerTool(
    "delete_marketing_app",
    {
      title: "Delete marketing app",
      description: "Delete a Marketing Studio app/profile and cascading Studio records for it.",
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
      inputSchema: {
        app_id: z.number().int().positive(),
      },
    },
    async ({ app_id }) => toolText(await readJsonFromHandler(deleteStudioApp(env, String(app_id), auth.scopeId))),
  );

  server.registerTool(
    "list_marketing_campaigns",
    {
      title: "List marketing campaigns",
      description: "List Marketing Studio campaigns across all apps.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {},
    },
    async () => toolText(await readJsonFromHandler(listStudioCampaigns(env, auth.scopeId))),
  );

  server.registerTool(
    "create_marketing_campaign",
    {
      title: "Create marketing campaign",
      description: "Create a Marketing Studio campaign for post planning or reply campaigns. Use account_refs from list_marketing_accounts. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        app_id: z.number().int().positive(),
        name: z.string(),
        campaign_type: z.enum(STUDIO_CAMPAIGN_TYPES).default("post"),
        result_limit: z.number().int().positive().max(50).default(10),
        account_refs: z.array(z.string()).default([]),
        platforms: z.array(z.enum(SOCIAL_PLATFORMS)).default([]),
        instructions: z.string().optional(),
        status: z.enum(STUDIO_CAMPAIGN_STATUSES).default("active"),
      },
    },
    async (input) => toolText(await readJsonFromHandler(
      createStudioCampaign(env, jsonRequest(requestUrl, input), auth.scopeId),
    )),
  );

  server.registerTool(
    "update_marketing_campaign",
    {
      title: "Update marketing campaign",
      description: "Edit a Marketing Studio campaign. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        campaign_id: z.number().int().positive(),
        app_id: z.number().int().positive().optional(),
        name: z.string().optional(),
        campaign_type: z.enum(STUDIO_CAMPAIGN_TYPES).optional(),
        result_limit: z.number().int().positive().max(50).optional(),
        account_refs: z.array(z.string()).optional(),
        platforms: z.array(z.enum(SOCIAL_PLATFORMS)).optional(),
        instructions: z.string().optional(),
        status: z.enum(STUDIO_CAMPAIGN_STATUSES).optional(),
      },
    },
    async ({ campaign_id, ...changes }) => toolText(await readJsonFromHandler(
      updateStudioCampaign(env, String(campaign_id), jsonRequest(requestUrl, changes), auth.scopeId),
    )),
  );

  server.registerTool(
    "delete_marketing_campaign",
    {
      title: "Delete marketing campaign",
      description: "Delete a Marketing Studio campaign. Related crawler runs remain but lose their campaign link.",
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
      inputSchema: {
        campaign_id: z.number().int().positive(),
      },
    },
    async ({ campaign_id }) => toolText(await readJsonFromHandler(deleteStudioCampaign(env, String(campaign_id), auth.scopeId))),
  );

  server.registerTool(
    "list_marketing_crawler_runs",
    {
      title: "List marketing crawler runs",
      description: "List Marketing Studio crawler/search planning runs.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        status: z.enum(["pending", "running", "completed", "failed"]).optional(),
        limit: z.number().int().positive().max(200).default(100),
      },
    },
    async ({ status, limit }) => toolText(await readJsonFromHandler(
      listStudioCrawlerRuns(env, urlWithParams(requestUrl, { status, limit }), auth.scopeId),
    )),
  );

  server.registerTool(
    "create_marketing_crawler_run",
    {
      title: "Create marketing crawler run",
      description: "Create a crawler/search planning run. This generates AI crawler instructions and search-query guidance; external crawlers can later save signals for the run. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        campaign_id: z.number().int().positive().nullable().optional(),
        app_id: z.number().int().positive().optional(),
        campaign_type: z.enum(STUDIO_CAMPAIGN_TYPES).default("post"),
        result_limit: z.number().int().positive().max(50).default(10),
        account_refs: z.array(z.string()).default([]),
        platforms: z.array(z.enum(SOCIAL_PLATFORMS)).default([]),
        instructions: z.string().optional(),
      },
    },
    async (input) => toolText(await readJsonFromHandler(
      createStudioCrawlerRun(env, jsonRequest(requestUrl, input), auth.scopeId),
    )),
  );

  server.registerTool(
    "list_marketing_signals",
    {
      title: "List marketing signals",
      description: "List Marketing Studio crawler signals/pain points.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        crawler_run_id: z.number().int().positive().optional(),
        campaign_id: z.number().int().positive().optional(),
        status: z.enum(["candidate", "filtered", "signal", "rejected"]).optional(),
      },
    },
    async ({ crawler_run_id, campaign_id, status }) => toolText(await readJsonFromHandler(
      listStudioSignals(env, urlWithParams(requestUrl, { crawler_run_id, campaign_id, status }), auth.scopeId),
    )),
  );

  server.registerTool(
    "delete_marketing_signal",
    {
      title: "Delete marketing signal",
      description: "Delete one crawler signal from Marketing Studio.",
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
      inputSchema: {
        signal_id: z.number().int().positive(),
      },
    },
    async ({ signal_id }) => toolText(await readJsonFromHandler(deleteStudioSignal(env, String(signal_id), auth.scopeId))),
  );

  server.registerTool(
    "list_marketing_post_ideas",
    {
      title: "List marketing post ideas",
      description: "List Studio strategist post ideas generated from crawler runs or created by ChatGPT.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        crawler_run_id: z.number().int().positive().optional(),
        campaign_id: z.number().int().positive().optional(),
      },
    },
    async ({ crawler_run_id, campaign_id }) => toolText(await readJsonFromHandler(
      listStudioStrategistPosts(env, urlWithParams(requestUrl, { crawler_run_id, campaign_id }), auth.scopeId),
    )),
  );

  server.registerTool(
    "save_marketing_post_ideas",
    {
      title: "Save marketing post ideas",
      description: "Save one or more AI-planned post/reply ideas into a Marketing Studio crawler run. Use after creating a crawler run or campaign plan. This only saves a plan inside the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        crawler_run_id: z.number().int().positive(),
        posts: z.array(z.object({
          platform: z.enum(SOCIAL_PLATFORMS),
          post_text: z.string(),
          idea: z.string().optional(),
          rationale: z.string().optional(),
          target_url: z.string().nullable().optional(),
          target_external_id: z.string().nullable().optional(),
          target_author: z.string().nullable().optional(),
          target_text: z.string().nullable().optional(),
          media_type: z.enum(STUDIO_MEDIA_TYPES).default("none"),
          media_url: z.string().nullable().optional(),
        })).min(1).max(50),
      },
    },
    async (input) => toolText(await readJsonFromHandler(
      createStudioStrategistPosts(env, jsonRequest(requestUrl, input), auth.scopeId),
    )),
  );

  server.registerTool(
    "update_marketing_post_idea",
    {
      title: "Update marketing post idea",
      description: "Edit a Studio strategist post idea before it is scheduled. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
        post_text: z.string().optional(),
        idea: z.string().optional(),
        rationale: z.string().optional(),
        target_url: z.string().nullable().optional(),
        target_external_id: z.string().nullable().optional(),
        target_author: z.string().nullable().optional(),
        target_text: z.string().nullable().optional(),
        media_type: z.enum(STUDIO_MEDIA_TYPES).optional(),
        media_url: z.string().nullable().optional(),
        status: z.enum(STUDIO_POST_STATUSES).optional(),
      },
    },
    async ({ post_id, ...changes }) => toolText(await readJsonFromHandler(
      updateStudioStrategistPost(env, String(post_id), jsonRequest(requestUrl, changes), auth.scopeId),
    )),
  );

  server.registerTool(
    "regenerate_marketing_post_idea",
    {
      title: "Regenerate marketing post idea",
      description: "Ask the dashboard AI to regenerate a stronger version of one Studio strategist post idea. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
      },
    },
    async ({ post_id }) => toolText(await readJsonFromHandler(regenerateStudioStrategistPost(env, String(post_id), auth.scopeId))),
  );

  server.registerTool(
    "schedule_marketing_post_idea",
    {
      title: "Schedule marketing post idea",
      description: "Turn a Studio strategist post idea into a real scheduled social post and linked planner item. If scheduled_at is omitted, the dashboard autoschedules it. This only schedules inside the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
        scheduled_at: z.string().nullable().optional(),
        media_url: z.string().nullable().optional(),
      },
    },
    async ({ post_id, scheduled_at, media_url }) => toolText(await readJsonFromHandler(
      scheduleStudioStrategistPost(env, String(post_id), jsonRequest(requestUrl, { scheduled_at, media_url }), auth.scopeId),
    )),
  );

  server.registerTool(
    "delete_marketing_post_idea",
    {
      title: "Delete marketing post idea",
      description: "Delete a Studio strategist post idea. If it already created a linked social post, set delete_linked_social_post=true to delete that queued social post too.",
      annotations: EXTERNAL_DESTRUCTIVE_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
        delete_linked_social_post: z.boolean().default(false),
      },
    },
    async ({ post_id, delete_linked_social_post }) => toolText(
      await deleteStudioStrategistPost(env, post_id, delete_linked_social_post, auth.scopeId),
    ),
  );
  }

  server.registerTool(
    "list_social_posts",
    {
      title: "List social posts",
      description: "List Oilor Studio social posts for one platform or all platforms.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_TOOL_META,
      inputSchema: {
        platform: z.enum(["threads", "twitter", "reddit", "instagram", "all"]).default("all"),
        status: z.string().optional().describe("Optional status filter such as draft, scheduled, approved, posted, or failed."),
      },
    },
    async ({ platform, status }) => {
      requireMcpScopes(auth, "posts.read");
      const posts = platform === "all"
        ? await allSocialPosts(env, auth.scopeId)
        : { [platform]: await listPostsForPlatform(env, platform, auth.scopeId) };
      if (!status) return toolText(presentSocialPostsByPlatform(posts));
      const normalizedStatus = status.trim().toLowerCase();
      return toolText(presentSocialPostsByPlatform(Object.fromEntries(
        Object.entries(posts).map(([key, values]) => [
          key,
          values.filter((post) => String(post.status ?? "").toLowerCase() === normalizedStatus),
        ]),
      )));
    },
  );

  server.registerTool(
    "find_next_free_social_slot",
    {
      title: "Find next free social slot",
      description: "Find the next available social posting day across Threads, Twitter/X, Reddit, and Instagram.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_TOOL_META,
      inputSchema: {
        start_date: z.string().optional().describe("Optional YYYY-MM-DD or ISO date to start searching from."),
        preferred_time: z.string().default("09:00").describe("Preferred local HH:mm time."),
        timezone_offset: z.string().default(KL_OFFSET).describe("Timezone offset for scheduled_at, default +08:00."),
      },
    },
    async ({ start_date, preferred_time, timezone_offset }) => {
      requireMcpScopes(auth, "posts.read");
      return toolText(await findNextFreeSlot(env, auth.scopeId, start_date, preferred_time, timezone_offset));
    },
  );

  server.registerTool(
    "create_social_post",
    {
      title: "Create social post",
      description: "Create a queued Oilor Studio social post. If autoschedule is true, the server selects the next free cross-platform slot. This only saves or schedules inside the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      _meta: OAUTH_TOOL_META,
      inputSchema: {
        platform: z.enum(SOCIAL_PLATFORMS),
        content: z.string().optional(),
        scheduled_at: z.string().optional(),
        autoschedule: z.boolean().default(false),
        image_url: z.union([z.string(), z.array(z.string())]).optional(),
        title: z.string().optional(),
        subreddit: z.string().optional(),
        account_id: z.number().int().positive().optional(),
        reply_to_id: z.string().optional(),
      },
    },
    async (input) => {
      requireMcpScopes(auth, "posts.write");
      const scheduledAt = input.autoschedule
        ? (await findNextFreeSlot(env, auth.scopeId)).scheduled_at
        : input.scheduled_at;
      const post = await readJsonFromHandler<Record<string, unknown>>(
        createSocialPost(
          env,
          normalizePlatform(input.platform),
          jsonRequest(requestUrl, {
            ...input,
            scheduled_at: scheduledAt,
          }),
          auth.scopeId,
        ),
      );
      const plannerItem = scheduledAt
        ? await createLinkedPlannerItem(env, requestUrl, post, scheduledAt, auth.scopeId)
        : null;
      return toolText({
        post: presentSocialPost(post, input.platform),
        planner_item: presentPlannerItem(plannerItem),
      });
    },
  );

  server.registerTool(
    "schedule_social_post",
    {
      title: "Schedule social post",
      description: "Schedule an existing social post and sync the linked dashboard planner item. This only schedules inside the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      _meta: OAUTH_TOOL_META,
      inputSchema: {
        post_id: z.number().int().positive(),
        scheduled_at: z.string().optional(),
        autoschedule: z.boolean().default(false),
      },
    },
    async ({ post_id, scheduled_at, autoschedule }) => {
      requireMcpScopes(auth, "posts.write");
      const scheduledAt = autoschedule
        ? (await findNextFreeSlot(env, auth.scopeId)).scheduled_at
        : scheduled_at;
      if (!scheduledAt) throw new Error("scheduled_at is required unless autoschedule is true.");
      await readJsonFromHandler<Record<string, unknown>>(
        updateSocialPost(
          env,
          String(post_id),
          jsonRequest(requestUrl, { scheduled_at: scheduledAt, status: "scheduled" }),
          auth.scopeId,
        ),
      );
      const plannerItem = await syncPlannerSchedule(env, requestUrl, post_id, scheduledAt, "approved", auth.scopeId);
      const post = await getPostById(env, post_id, auth.scopeId);
      return toolText({
        post: presentSocialPost(post),
        planner_item: presentPlannerItem(plannerItem),
      });
    },
  );

  server.registerTool(
    "update_social_post",
    {
      title: "Update social post",
      description: "Update editable fields on an existing social post. Planner schedule is synced when scheduled_at is supplied. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      _meta: OAUTH_TOOL_META,
      inputSchema: SOCIAL_POST_UPDATE_INPUT_SCHEMA,
    },
    async ({ post_id, ...changes }) => {
      requireMcpScopes(auth, "posts.write");
      await readJsonFromHandler<Record<string, unknown>>(
        updateSocialPost(env, String(post_id), jsonRequest(requestUrl, changes), auth.scopeId),
      );
      const plannerItem = typeof changes.scheduled_at === "string"
        ? await syncPlannerSchedule(env, requestUrl, post_id, changes.scheduled_at, changes.status ?? "approved", auth.scopeId)
        : null;
      const post = await getPostById(env, post_id, auth.scopeId);
      return toolText({
        post: presentSocialPost(post),
        planner_item: presentPlannerItem(plannerItem),
      });
    },
  );

  server.registerTool(
    "edit_social_post",
    {
      title: "Edit social post",
      description: "Alias for update_social_post. Edit dashboard fields on an existing social post; this does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      _meta: OAUTH_TOOL_META,
      inputSchema: SOCIAL_POST_UPDATE_INPUT_SCHEMA,
    },
    async ({ post_id, ...changes }) => {
      requireMcpScopes(auth, "posts.write");
      await readJsonFromHandler<Record<string, unknown>>(
        updateSocialPost(env, String(post_id), jsonRequest(requestUrl, changes), auth.scopeId),
      );
      const plannerItem = typeof changes.scheduled_at === "string"
        ? await syncPlannerSchedule(env, requestUrl, post_id, changes.scheduled_at, changes.status ?? "approved", auth.scopeId)
        : null;
      const post = await getPostById(env, post_id, auth.scopeId);
      return toolText({
        post: presentSocialPost(post),
        planner_item: presentPlannerItem(plannerItem),
      });
    },
  );

  server.registerTool(
    "delete_social_post",
    {
      title: "Delete social post",
      description: "Delete an Oilor Studio social post and its linked planner item. If a Twitter/X post was already published, this can also delete the external public post after explicit confirmation.",
      annotations: EXTERNAL_DESTRUCTIVE_TOOL_ANNOTATIONS,
      _meta: OAUTH_TOOL_META,
      inputSchema: {
        post_id: z.number().int().positive(),
        confirm_external_delete: z.boolean().default(false).describe("Set true only after the user explicitly confirms deleting an already-published external post."),
      },
    },
    async ({ post_id, confirm_external_delete }) => {
      requireMcpScopes(auth, "posts.write");
      const post = await getPostById(env, post_id, auth.scopeId);
      const platform = normalizePlatform(String(post.platform));
      const externalId = String(post.external_id ?? "").trim();
      if (platform === "twitter" && String(post.status ?? "") === "posted" && externalId) {
        requireMcpScopes(auth, "posts.publish");
      }
      if (platform === "twitter" && String(post.status ?? "") === "posted" && externalId && !confirm_external_delete) {
        throw new Error("This post is already published on Twitter/X. Ask the user to confirm external deletion, then call delete_social_post with confirm_external_delete=true.");
      }
      return toolText(await readJsonFromHandler(
        deleteSocialPost(env, String(post_id), auth.scopeId),
      ));
    },
  );

  server.registerTool(
    "publish_social_post",
    {
      title: "Publish social post",
      description: "Publish a queued Oilor Studio social post immediately through its platform publisher.",
      annotations: EXTERNAL_DESTRUCTIVE_TOOL_ANNOTATIONS,
      _meta: OAUTH_TOOL_META,
      inputSchema: {
        post_id: z.number().int().positive(),
        confirm_publish: z.boolean().default(false).describe("Set true only after the user explicitly confirms publishing this post to the external social platform."),
      },
    },
    async ({ post_id, confirm_publish }) => {
      requireMcpScopes(auth, "posts.publish");
      const post = await getPostById(env, post_id, auth.scopeId);
      const platform = normalizePlatform(String(post.platform));
      if (!confirm_publish) {
        throw new Error(`Publishing will post this ${platform} content to the external social platform. Ask the user to confirm, then call publish_social_post with confirm_publish=true.`);
      }
      const result = await readJsonFromHandler(
        platform === "threads"
          ? publishThreadsPost(env, String(post_id), auth.scopeId)
          : platform === "twitter"
          ? publishTwitterPost(env, String(post_id), auth.scopeId)
          : platform === "reddit"
          ? publishRedditPost(env, String(post_id), auth.scopeId, auth.userId)
          : publishExtraSocialPost(env, String(post_id), auth.scopeId, auth.userId),
      );
      return toolText({ post_id, platform, result });
    },
  );

  return server;
}

export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const oauthResponse = await handleChatGptOAuthRequest(request, env);
  if (oauthResponse) {
    return oauthResponse;
  }

  const isMcpEndpoint = url.pathname === "/mcp" || url.pathname === "/mcp/" || url.pathname === "/api/mcp" || url.pathname === "/api/mcp/";
  if (!isMcpEndpoint) {
    return new Response("Not found", { status: 404 });
  }

  const normalizedUrl = new URL(request.url);
  normalizedUrl.pathname = "/mcp";
  const handlerRequest = url.pathname === "/mcp" ? request : new Request(normalizedUrl.toString(), request);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
      },
    });
  }

  const auth = await resolveMcpAuthContext(handlerRequest, env);
  if (auth instanceof Response) return auth;

  const handler = createMcpHandler(createBlogposterMcpServer(env, request.url, auth), {
    route: "/mcp",
  });
  const response = await handler(handlerRequest, env, ctx);
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
