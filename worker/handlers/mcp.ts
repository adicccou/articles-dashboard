import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import type { Env } from "../lib/types";
import {
  createSocialPost,
  deleteSocialPost,
  listSocialPosts,
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

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

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
  readOnlyHint: true,
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

async function configuredMcpToken(env: Env): Promise<string> {
  if (env.MCP_CONNECTOR_TOKEN) return env.MCP_CONNECTOR_TOKEN;
  if (env.TRADING_AGENT_SYNC_SECRET) return env.TRADING_AGENT_SYNC_SECRET;

  const row = await env.DB.prepare(
    "SELECT value FROM app_settings WHERE key = 'trading_agent_token' ORDER BY updated_at DESC LIMIT 1",
  ).first<{ value: string }>();
  return row?.value ?? "";
}

async function requireMcpAuth(request: Request, env: Env): Promise<Response | null> {
  const configuredToken = await configuredMcpToken(env);
  const authHeader = request.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  const urlToken = new URL(request.url).searchParams.get("token")?.trim() ?? "";

  if (!configuredToken) {
    return new Response("MCP connector token is not configured", { status: 503 });
  }

  if (bearerToken !== configuredToken && urlToken !== configuredToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}

async function callDashboardInternalApi(env: Env, path: string, init?: RequestInit) {
  const baseUrl = (env.DASHBOARD_API_URL || "https://marketing-dashboard.adilet-melisov.workers.dev").replace(/\/$/, "");
  const token = await configuredMcpToken(env);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return responseJson(response);
}

async function readJsonFromHandler<T>(handlerResponse: Promise<Response>): Promise<T> {
  return responseJson<T>(await handlerResponse);
}

async function listPostsForPlatform(env: Env, platform: string) {
  return readJsonFromHandler<Record<string, unknown>[]>(
    listSocialPosts(env, normalizePlatform(platform)),
  );
}

async function allSocialPosts(env: Env) {
  const entries = await Promise.all(
    SOCIAL_PLATFORMS.map(async (platform) => [platform, await listPostsForPlatform(env, platform)] as const),
  );
  return Object.fromEntries(entries);
}

function dateKey(value: string): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

async function occupiedSocialDates(env: Env): Promise<Set<string>> {
  const occupied = new Set<string>();
  const socialPosts = await allSocialPosts(env);

  for (const posts of Object.values(socialPosts)) {
    for (const post of posts) {
      const status = String(post.status ?? "").toLowerCase();
      const scheduledAt = typeof post.scheduled_at === "string" ? post.scheduled_at : "";
      const key = scheduledAt && ACTIVE_SOCIAL_STATUSES.has(status) ? dateKey(scheduledAt) : null;
      if (key) occupied.add(key);
    }
  }

  const plannerItems = await readJsonFromHandler<Record<string, unknown>[]>(
    listPlannerItems(env),
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
  startDate?: string | null,
  preferredTime = "09:00",
  timezoneOffset = KL_OFFSET,
) {
  const occupied = await occupiedSocialDates(env);
  const normalizedStart = startDate?.trim()
    ? dateKey(startDate.trim()) ?? startDate.trim().slice(0, 10)
    : formatDate(localDateParts(new Date()));
  const [year, month, day] = normalizedStart.split("-").map(Number);
  const cleanTime = /^\d{2}:\d{2}$/.test(preferredTime) ? preferredTime : "09:00";
  const cleanOffset = /^[+-]\d{2}:\d{2}$/.test(timezoneOffset) ? timezoneOffset : KL_OFFSET;

  for (let offset = 0; offset < 60; offset += 1) {
    const candidate = addDays({ year, month, day }, offset);
    const candidateDate = formatDate(candidate);
    if (!occupied.has(candidateDate)) {
      return {
        scheduled_at: `${candidateDate}T${cleanTime}:00${cleanOffset}`,
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
    ),
  );
}

async function plannerItemForPost(env: Env, postId: number) {
  const items = await readJsonFromHandler<Record<string, unknown>[]>(listPlannerItems(env));
  return items.find((item) => Number(item.social_post_id ?? 0) === postId) ?? null;
}

async function syncPlannerSchedule(env: Env, requestUrl: string, postId: number, scheduledAt: string, status = "approved") {
  const post = await getPostById(env, postId);
  const existing = await plannerItemForPost(env, postId);
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
      ),
    );
  }
  return createLinkedPlannerItem(env, requestUrl, post, scheduledAt);
}

async function getPostById(env: Env, id: number): Promise<Record<string, unknown>> {
  for (const [platform, posts] of Object.entries(await allSocialPosts(env))) {
    const post = posts.find((item) => Number(item.id ?? 0) === id);
    if (post) return { ...post, platform };
  }
  throw new Error(`Social post #${id} was not found.`);
}

async function getStudioStrategistPostById(env: Env, id: number): Promise<Record<string, unknown>> {
  const post = await env.DB.prepare("SELECT * FROM studio_strategist_posts WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!post) throw new Error(`Studio strategist post #${id} was not found.`);
  return post;
}

async function deleteStudioStrategistPost(env: Env, postId: number, deleteLinkedSocialPost: boolean) {
  const post = await getStudioStrategistPostById(env, postId);
  const socialPostId = Number(post.social_post_id ?? 0);
  const plannerItemId = Number(post.planner_item_id ?? 0);
  if (socialPostId && !deleteLinkedSocialPost) {
    throw new Error("This Studio post is already linked to a social post. Set delete_linked_social_post=true to delete both.");
  }
  if (socialPostId) {
    await readJsonFromHandler(deleteSocialPost(env, String(socialPostId)));
  } else if (plannerItemId) {
    await readJsonFromHandler(deletePlannerItem(env, String(plannerItemId)));
  }
  await env.DB.prepare("DELETE FROM studio_strategist_posts WHERE id = ?").bind(postId).run();
  return {
    success: true,
    deleted_studio_post_id: postId,
    deleted_social_post_id: socialPostId || null,
    deleted_planner_item_id: socialPostId ? null : plannerItemId || null,
  };
}

function createBlogposterMcpServer(env: Env, requestUrl: string) {
  const server = new McpServer({
    name: "blogposter-dashboard",
    version: "1.0.0",
  });

  server.registerTool(
    "get_marketing_studio_summary",
    {
      title: "Get marketing studio summary",
      description: "Read the full Oilor Studio state: connected accounts, apps, campaigns, crawler runs, signals, and strategist posts.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {},
    },
    async () => toolText(await readJsonFromHandler(getStudioSummary(env))),
  );

  server.registerTool(
    "list_marketing_accounts",
    {
      title: "List marketing accounts",
      description: "List connected social accounts available for Marketing Studio campaigns. Use refs such as twitter:1, threads:2, or reddit:3 in campaign account_refs.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {},
    },
    async () => toolText(await readJsonFromHandler(listStudioAccounts(env))),
  );

  server.registerTool(
    "list_marketing_apps",
    {
      title: "List marketing apps",
      description: "List apps/products configured in the Marketing Studio.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {},
    },
    async () => toolText(await readJsonFromHandler(listStudioApps(env))),
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
      createStudioApp(env, jsonRequest(requestUrl, input)),
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
      updateStudioApp(env, String(app_id), jsonRequest(requestUrl, changes)),
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
    async ({ app_id }) => toolText(await readJsonFromHandler(deleteStudioApp(env, String(app_id)))),
  );

  server.registerTool(
    "list_marketing_campaigns",
    {
      title: "List marketing campaigns",
      description: "List Marketing Studio campaigns across all apps.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {},
    },
    async () => toolText(await readJsonFromHandler(listStudioCampaigns(env))),
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
      createStudioCampaign(env, jsonRequest(requestUrl, input)),
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
      updateStudioCampaign(env, String(campaign_id), jsonRequest(requestUrl, changes)),
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
    async ({ campaign_id }) => toolText(await readJsonFromHandler(deleteStudioCampaign(env, String(campaign_id)))),
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
      listStudioCrawlerRuns(env, urlWithParams(requestUrl, { status, limit })),
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
      createStudioCrawlerRun(env, jsonRequest(requestUrl, input)),
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
      listStudioSignals(env, urlWithParams(requestUrl, { crawler_run_id, campaign_id, status })),
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
    async ({ signal_id }) => toolText(await readJsonFromHandler(deleteStudioSignal(env, String(signal_id)))),
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
      listStudioStrategistPosts(env, urlWithParams(requestUrl, { crawler_run_id, campaign_id })),
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
      createStudioStrategistPosts(env, jsonRequest(requestUrl, input)),
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
      updateStudioStrategistPost(env, String(post_id), jsonRequest(requestUrl, changes)),
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
    async ({ post_id }) => toolText(await readJsonFromHandler(regenerateStudioStrategistPost(env, String(post_id)))),
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
      scheduleStudioStrategistPost(env, String(post_id), jsonRequest(requestUrl, { scheduled_at, media_url })),
    )),
  );

  server.registerTool(
    "delete_marketing_post_idea",
    {
      title: "Delete marketing post idea",
      description: "Delete a Studio strategist post idea. If it already created a linked social post, set delete_linked_social_post=true to delete that queued social post too.",
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
        delete_linked_social_post: z.boolean().default(false),
      },
    },
    async ({ post_id, delete_linked_social_post }) => toolText(
      await deleteStudioStrategistPost(env, post_id, delete_linked_social_post),
    ),
  );

  server.registerTool(
    "list_social_posts",
    {
      title: "List social posts",
      description: "List Oilor Studio social posts for one platform or all platforms.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        platform: z.enum(["threads", "twitter", "reddit", "instagram", "all"]).default("all"),
        status: z.string().optional().describe("Optional status filter such as draft, scheduled, approved, posted, or failed."),
      },
    },
    async ({ platform, status }) => {
      const posts = platform === "all"
        ? await allSocialPosts(env)
        : { [platform]: await listPostsForPlatform(env, platform) };
      if (!status) return toolText(posts);
      const normalizedStatus = status.trim().toLowerCase();
      return toolText(Object.fromEntries(
        Object.entries(posts).map(([key, values]) => [
          key,
          values.filter((post) => String(post.status ?? "").toLowerCase() === normalizedStatus),
        ]),
      ));
    },
  );

  server.registerTool(
    "find_next_free_social_slot",
    {
      title: "Find next free social slot",
      description: "Find the next available social posting day across Threads, Twitter/X, Reddit, and Instagram.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        start_date: z.string().optional().describe("Optional YYYY-MM-DD or ISO date to start searching from."),
        preferred_time: z.string().default("09:00").describe("Preferred local HH:mm time."),
        timezone_offset: z.string().default(KL_OFFSET).describe("Timezone offset for scheduled_at, default +08:00."),
      },
    },
    async ({ start_date, preferred_time, timezone_offset }) => toolText(
      await findNextFreeSlot(env, start_date, preferred_time, timezone_offset),
    ),
  );

  server.registerTool(
    "create_social_post",
    {
      title: "Create social post",
      description: "Create a queued Oilor Studio social post. If autoschedule is true, the server selects the next free cross-platform slot. This only saves or schedules inside the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
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
      const scheduledAt = input.autoschedule
        ? (await findNextFreeSlot(env)).scheduled_at
        : input.scheduled_at;
      const post = await readJsonFromHandler<Record<string, unknown>>(
        createSocialPost(
          env,
          normalizePlatform(input.platform),
          jsonRequest(requestUrl, {
            ...input,
            scheduled_at: scheduledAt,
          }),
        ),
      );
      const plannerItem = scheduledAt
        ? await createLinkedPlannerItem(env, requestUrl, post, scheduledAt)
        : null;
      return toolText({ post, planner_item: plannerItem });
    },
  );

  server.registerTool(
    "schedule_social_post",
    {
      title: "Schedule social post",
      description: "Schedule an existing social post and sync the linked dashboard planner item. This only schedules inside the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
        scheduled_at: z.string().optional(),
        autoschedule: z.boolean().default(false),
      },
    },
    async ({ post_id, scheduled_at, autoschedule }) => {
      const scheduledAt = autoschedule
        ? (await findNextFreeSlot(env)).scheduled_at
        : scheduled_at;
      if (!scheduledAt) throw new Error("scheduled_at is required unless autoschedule is true.");
      const postUpdate = await readJsonFromHandler<Record<string, unknown>>(
        updateSocialPost(
          env,
          String(post_id),
          jsonRequest(requestUrl, { scheduled_at: scheduledAt, status: "scheduled" }),
        ),
      );
      const plannerItem = await syncPlannerSchedule(env, requestUrl, post_id, scheduledAt);
      return toolText({ post: { id: post_id, ...postUpdate }, planner_item: plannerItem });
    },
  );

  server.registerTool(
    "update_social_post",
    {
      title: "Update social post",
      description: "Update editable fields on an existing social post. Planner schedule is synced when scheduled_at is supplied. This only updates the dashboard; it does not publish externally.",
      annotations: PLANNING_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
        content: z.string().optional(),
        scheduled_at: z.string().nullable().optional(),
        status: z.string().optional(),
        image_url: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
        title: z.string().nullable().optional(),
        subreddit: z.string().nullable().optional(),
        account_id: z.number().int().positive().nullable().optional(),
        reply_to_id: z.string().nullable().optional(),
      },
    },
    async ({ post_id, ...changes }) => {
      const result = await readJsonFromHandler<Record<string, unknown>>(
        updateSocialPost(env, String(post_id), jsonRequest(requestUrl, changes)),
      );
      const plannerItem = typeof changes.scheduled_at === "string"
        ? await syncPlannerSchedule(env, requestUrl, post_id, changes.scheduled_at, changes.status ?? "approved")
        : null;
      return toolText({ post: { id: post_id, ...result }, planner_item: plannerItem });
    },
  );

  server.registerTool(
    "delete_social_post",
    {
      title: "Delete social post",
      description: "Delete an Oilor Studio social post and its linked planner item.",
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
      },
    },
    async ({ post_id }) => toolText(await readJsonFromHandler(
      deleteSocialPost(env, String(post_id)),
    )),
  );

  server.registerTool(
    "publish_social_post",
    {
      title: "Publish social post",
      description: "Publish a queued Oilor Studio social post immediately through its platform publisher.",
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
      inputSchema: {
        post_id: z.number().int().positive(),
      },
    },
    async ({ post_id }) => {
      const post = await getPostById(env, post_id);
      const platform = normalizePlatform(String(post.platform));
      const result = await callDashboardInternalApi(
        env,
        `/api/internal/social/posts/${post_id}/publish`,
        { method: "POST", body: JSON.stringify({}) },
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
  if (url.pathname !== "/mcp") {
    return new Response("Not found", { status: 404 });
  }

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

  const unauthorized = await requireMcpAuth(request, env);
  if (unauthorized) return unauthorized;

  const handler = createMcpHandler(createBlogposterMcpServer(env, request.url), {
    route: "/mcp",
  });
  const response = await handler(request, env, ctx);
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
