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
  listPlannerItems,
  plannerHasSocialPostLinks,
  updatePlannerItem,
} from "./planner";

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

const SOCIAL_PLATFORMS = ["threads", "twitter", "reddit"] as const;
const ACTIVE_PLANNER_STATUSES = new Set(["planned", "drafting", "approved"]);
const ACTIVE_SOCIAL_STATUSES = new Set(["draft", "approved", "scheduled"]);
const KL_OFFSET = "+08:00";

function normalizePlatform(platform: string): (typeof SOCIAL_PLATFORMS)[number] {
  const normalized = platform.trim().toLowerCase();
  if (normalized === "thread") return "threads";
  if (normalized === "x" || normalized === "twitter/x") return "twitter";
  if (SOCIAL_PLATFORMS.includes(normalized as (typeof SOCIAL_PLATFORMS)[number])) {
    return normalized as (typeof SOCIAL_PLATFORMS)[number];
  }
  throw new Error("Unsupported platform. Use threads, twitter, or reddit.");
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

  if (!configuredToken) {
    return new Response("MCP connector token is not configured", { status: 503 });
  }

  if (bearerToken !== configuredToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}

async function callDashboardInternalApi(env: Env, path: string, init?: RequestInit) {
  const baseUrl = (env.DASHBOARD_API_URL || "https://dashboard.adilet-melisov.workers.dev").replace(/\/$/, "");
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
      && ["threads", "thread", "twitter", "x", "twitter/x", "reddit"].includes(platform)
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
        status: "approved",
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

function createBlogposterMcpServer(env: Env, requestUrl: string) {
  const server = new McpServer({
    name: "blogposter-dashboard",
    version: "1.0.0",
  });

  server.registerTool(
    "list_social_posts",
    {
      title: "List social posts",
      description: "List Blogposter social posts for one platform or all platforms.",
      inputSchema: {
        platform: z.enum(["threads", "twitter", "reddit", "all"]).default("all"),
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
      description: "Find the next available social posting day across Threads, Twitter/X, and Reddit.",
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
      description: "Create a Blogposter social post. If autoschedule is true, the server selects the next free cross-platform slot.",
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
      description: "Schedule an existing social post and sync the linked dashboard planner item.",
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
      description: "Update editable fields on an existing social post. Planner schedule is synced when scheduled_at is supplied.",
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
      description: "Delete a Blogposter social post and its linked planner item.",
      annotations: { destructiveHint: true },
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
      description: "Publish a queued Blogposter social post immediately through its platform publisher.",
      annotations: { destructiveHint: true },
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
