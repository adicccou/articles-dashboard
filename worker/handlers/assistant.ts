import { type GeminiMessage } from "../lib/gemini";
import { callAiText } from "../lib/ai";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import type { Env } from "../lib/types";

interface AssistantChatPayload {
  messages: GeminiMessage[];
}

interface AssistantContext {
  overview: {
    total_sites: number;
    total_articles: number;
    draft_articles: number;
    published_articles: number;
    reddit_campaigns: number;
    active_reddit_campaigns: number;
    trading_strategies: number;
    active_trading_strategies: number;
    total_closed_trades: number;
    total_open_trades: number;
  };
  recent_articles: Array<{
    title: string;
    status: string;
    updated_at: string;
  }>;
  reddit_campaigns: Array<{
    name: string;
    subreddit: string;
    status: string;
    approval_method: string;
  }>;
  trading_strategies: Array<{
    name: string;
    assets: string[];
    strategy_type: string;
    status: string;
    total_trades: number;
    win_rate: number;
    total_pips: number;
  }>;
  planner_items: Array<{
    id: number;
    title: string;
    platform: string;
    status: string;
    scheduled_for: string | null;
  }>;
  trading_notes: Array<{
    id: number;
    title: string;
    note_type: string;
    strategy_name: string | null;
    created_at: string;
  }>;
}

interface AssistantPlan {
  reply: string;
  actions: AssistantAction[];
}

type AssistantAction =
  | {
      type: "create_planner_items";
      items: Array<{
        title: string;
        description?: string;
        platform: string;
        status?: "planned" | "drafting" | "approved" | "published" | "archived";
        scheduled_for?: string | null;
        related_strategy_id?: number | null;
      }>;
    }
  | {
      type: "create_trading_note";
      note: {
        strategy_id?: number | null;
        title: string;
        content: string;
        note_type?: "analysis" | "idea" | "review" | "risk";
      };
    };

interface AssistantActionResult {
  type: string;
  count?: number;
  ids?: number[];
  message: string;
}

interface AssistantRuntimeSettings {
  geminiApiKey: string;
  geminiProModel: string;
  globalAiRules: string;
  socialAgentRules: string;
}

async function readAssistantRuntimeSettings(env: Env): Promise<AssistantRuntimeSettings> {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_pro_model', 'global_ai_rules', 'social_agent_rules')",
  ).all<{ key: string; value: string }>();

  let geminiApiKey = env.GEMINI_API_KEY ?? "";
  let geminiProModel = env.GEMINI_PRO_MODEL ?? "gemini-3.1-pro-preview";
  let globalAiRules = "";
  let socialAgentRules = "";

  for (const row of rows.results ?? []) {
    if (row.key === "gemini_api_key" && row.value) {
      geminiApiKey = row.value;
    }

    if (row.key === "gemini_pro_model" && row.value) {
      geminiProModel = row.value;
    }

    if (row.key === "global_ai_rules") {
      globalAiRules = row.value ?? "";
    }

    if (row.key === "social_agent_rules") {
      socialAgentRules = row.value ?? "";
    }
  }

  return {
    geminiApiKey,
    geminiProModel,
    globalAiRules,
    socialAgentRules,
  };
}

async function buildAssistantContext(env: Env): Promise<AssistantContext> {
  const [
    overviewRow,
    recentArticles,
    redditCampaigns,
    tradingStrategies,
    plannerItems,
    tradingNotes,
  ] = await Promise.all([
    env.DB.prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM sites) AS total_sites,
          (SELECT COUNT(*) FROM articles) AS total_articles,
          (SELECT COUNT(*) FROM articles WHERE status = 'draft') AS draft_articles,
          (SELECT COUNT(*) FROM articles WHERE status = 'published') AS published_articles,
          (SELECT COUNT(*) FROM reddit_campaigns) AS reddit_campaigns,
          (SELECT COUNT(*) FROM reddit_campaigns WHERE status = 'active') AS active_reddit_campaigns,
          (SELECT COUNT(*) FROM trading_strategies) AS trading_strategies,
          (SELECT COUNT(*) FROM trading_strategies WHERE status = 'active') AS active_trading_strategies,
          (SELECT COUNT(*) FROM trading_executions WHERE status = 'closed') AS total_closed_trades,
          (SELECT COUNT(*) FROM trading_executions WHERE status = 'open') AS total_open_trades
      `,
    ).first<Record<string, number>>(),
    env.DB.prepare(
      `
        SELECT title, status, updated_at
        FROM articles
        ORDER BY updated_at DESC
        LIMIT 5
      `,
    ).all<{
      title: string;
      status: string;
      updated_at: string;
    }>(),
    env.DB.prepare(
      `
        SELECT name, subreddit, status, approval_method
        FROM reddit_campaigns
        ORDER BY updated_at DESC
        LIMIT 5
      `,
    ).all<{
      name: string;
      subreddit: string;
      status: string;
      approval_method: string;
    }>(),
    env.DB.prepare(
      `
        SELECT
          ts.name,
          ts.assets,
          ts.strategy_type,
          ts.status,
          COALESCE(st.total_trades, 0) AS total_trades,
          COALESCE(st.win_rate, 0) AS win_rate,
          COALESCE(st.total_pips, 0) AS total_pips
        FROM trading_strategies ts
        LEFT JOIN trading_stats st ON st.strategy_id = ts.id
        ORDER BY ts.updated_at DESC
        LIMIT 5
      `,
    ).all<{
      name: string;
      assets: string;
      strategy_type: string;
      status: string;
      total_trades: number;
      win_rate: number;
      total_pips: number;
    }>(),
    env.DB.prepare(
      `
        SELECT id, title, platform, status, scheduled_for
        FROM planner_items
        ORDER BY
          CASE WHEN scheduled_for IS NULL THEN 1 ELSE 0 END,
          scheduled_for ASC,
          created_at DESC
        LIMIT 8
      `,
    ).all<{
      id: number;
      title: string;
      platform: string;
      status: string;
      scheduled_for: string | null;
    }>(),
    env.DB.prepare(
      `
        SELECT
          tn.id,
          tn.title,
          tn.note_type,
          ts.name AS strategy_name,
          tn.created_at
        FROM trading_notes tn
        LEFT JOIN trading_strategies ts ON ts.id = tn.strategy_id
        ORDER BY tn.created_at DESC
        LIMIT 8
      `,
    ).all<{
      id: number;
      title: string;
      note_type: string;
      strategy_name: string | null;
      created_at: string;
    }>(),
  ]);

  return {
    overview: {
      total_sites: Number(overviewRow?.total_sites ?? 0),
      total_articles: Number(overviewRow?.total_articles ?? 0),
      draft_articles: Number(overviewRow?.draft_articles ?? 0),
      published_articles: Number(overviewRow?.published_articles ?? 0),
      reddit_campaigns: Number(overviewRow?.reddit_campaigns ?? 0),
      active_reddit_campaigns: Number(overviewRow?.active_reddit_campaigns ?? 0),
      trading_strategies: Number(overviewRow?.trading_strategies ?? 0),
      active_trading_strategies: Number(overviewRow?.active_trading_strategies ?? 0),
      total_closed_trades: Number(overviewRow?.total_closed_trades ?? 0),
      total_open_trades: Number(overviewRow?.total_open_trades ?? 0),
    },
    recent_articles: recentArticles.results ?? [],
    reddit_campaigns: redditCampaigns.results ?? [],
    trading_strategies: (tradingStrategies.results ?? []).map((strategy) => ({
      ...strategy,
      assets: (() => {
        try {
          const parsed = JSON.parse(strategy.assets) as unknown;
          if (Array.isArray(parsed)) {
            return parsed.map((value) => String(value));
          }
        } catch {}
        return strategy.assets ? [strategy.assets] : [];
      })(),
    })),
    planner_items: plannerItems.results ?? [],
    trading_notes: tradingNotes.results ?? [],
  };
}

function buildSystemPrompt(context: AssistantContext, runtimeSettings: AssistantRuntimeSettings): string {
  const sections = [
    "You are the internal assistant for BlogPoster, a dashboard that manages articles, Reddit agents, and trading strategies.",
    "Use the provided dashboard context to answer clearly and practically.",
    "You may suggest plans, content ideas, trading observations, and operational next steps.",
    "You can request two kinds of safe actions: creating planner items and creating trading notes.",
    "Never claim you placed trades, sent Reddit replies, or published content.",
    "Only create records when the user clearly asks you to save, add, create, queue, note, log, plan, or remember something.",
    "When no write is needed, actions must be an empty array.",
    "Respond with strict JSON only using this shape: {\"reply\": string, \"actions\": AssistantAction[]}.",
    "Valid action types:",
    "1. create_planner_items -> {\"type\":\"create_planner_items\",\"items\":[{\"title\":string,\"description\"?:string,\"platform\":string,\"status\"?:\"planned\"|\"drafting\"|\"approved\"|\"published\"|\"archived\",\"scheduled_for\"?:ISO8601 string|null,\"related_strategy_id\"?:number|null}]}",
    "2. create_trading_note -> {\"type\":\"create_trading_note\",\"note\":{\"strategy_id\"?:number|null,\"title\":string,\"content\":string,\"note_type\"?:\"analysis\"|\"idea\"|\"review\"|\"risk\"}}",
    "Keep replies concise, grounded in the dashboard data, and mention saved records when actions are created.",
  ];

  if (runtimeSettings.globalAiRules.trim()) {
    sections.push(
      `Workspace global AI rules from the owner. Treat these as standing instructions unless they conflict with safety or the user's direct request:\n${runtimeSettings.globalAiRules.trim()}`,
    );
  }

  if (runtimeSettings.socialAgentRules.trim()) {
    sections.push(
      `Social media agent brief. Use this whenever the user asks for content, campaigns, hooks, positioning, or publishing guidance for social channels:\n${runtimeSettings.socialAgentRules.trim()}`,
    );
  }

  sections.push(`Dashboard context JSON:\n${JSON.stringify(context, null, 2)}`);
  return sections.join("\n\n");
}

function parseAssistantPlan(raw: string): AssistantPlan {
  const trimmed = raw.trim();
  const unwrapped = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const parsed = JSON.parse(unwrapped) as Partial<AssistantPlan>;

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply : "Done.",
    actions: Array.isArray(parsed.actions) ? parsed.actions as AssistantAction[] : [],
  };
}

async function executeAssistantActions(
  env: Env,
  actions: AssistantAction[],
): Promise<AssistantActionResult[]> {
  const results: AssistantActionResult[] = [];

  for (const action of actions) {
    if (action.type === "create_planner_items") {
      const items = Array.isArray(action.items) ? action.items : [];
      const ids: number[] = [];

      for (const item of items) {
        if (!item.title || !item.platform) {
          continue;
        }

        const now = new Date().toISOString();
        const inserted = await env.DB.prepare(
          `
            INSERT INTO planner_items (
              title,
              description,
              platform,
              status,
              scheduled_for,
              related_strategy_id,
              created_by,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'assistant', ?, ?)
            RETURNING id
          `,
        )
          .bind(
            item.title,
            item.description ?? null,
            item.platform,
            item.status ?? "planned",
            item.scheduled_for ?? null,
            item.related_strategy_id ?? null,
            now,
            now,
          )
          .first<{ id: number }>();

        if (inserted?.id) {
          ids.push(inserted.id);
        }
      }

      results.push({
        type: action.type,
        count: ids.length,
        ids,
        message: ids.length > 0 ? `Created ${ids.length} planner item(s).` : "No planner items were created.",
      });
    }

    if (action.type === "create_trading_note") {
      const note = action.note;
      if (!note?.title || !note?.content) {
        results.push({
          type: action.type,
          message: "Trading note skipped because required fields were missing.",
        });
        continue;
      }

      const now = new Date().toISOString();
      const inserted = await env.DB.prepare(
        `
          INSERT INTO trading_notes (
            strategy_id,
            title,
            content,
            note_type,
            created_by,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 'assistant', ?, ?)
          RETURNING id
        `,
      )
        .bind(
          note.strategy_id ?? null,
          note.title,
          note.content,
          note.note_type ?? "analysis",
          now,
          now,
        )
        .first<{ id: number }>();

      results.push({
        type: action.type,
        count: inserted?.id ? 1 : 0,
        ids: inserted?.id ? [inserted.id] : [],
        message: inserted?.id ? "Created 1 trading note." : "Trading note was not created.",
      });
    }
  }

  return results;
}

export async function chatWithAssistant(env: Env, request: Request): Promise<Response> {
  try {
    const runtimeSettings = await readAssistantRuntimeSettings(env);

    if (!runtimeSettings.geminiApiKey) {
      return errorResponse("No Gemini API key is configured", 500);
    }

    const payload = await parseJson<AssistantChatPayload>(request);
    const messages = (payload.messages ?? []).filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    );

    if (messages.length === 0) {
      return errorResponse("At least one message is required", 400);
    }

    const context = await buildAssistantContext(env);
    const rawReply = await callAiText({
      apiKey: runtimeSettings.geminiApiKey,
      model: runtimeSettings.geminiProModel,
      maxTokens: 1400,
      system: buildSystemPrompt(context, runtimeSettings),
      messages,
    });

    const plan = parseAssistantPlan(rawReply);
    const actionResults = await executeAssistantActions(env, plan.actions);
    const nextContext = actionResults.length > 0 ? await buildAssistantContext(env) : context;

    return jsonResponse({
      message: plan.reply,
      context: nextContext,
      action_results: actionResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant request failed";
    return errorResponse(message, 500);
  }
}
