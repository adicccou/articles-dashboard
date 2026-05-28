import { clearSessionCookie, createSessionCookie, getSessionUser, validateSession } from "./lib/auth";
import { createSite, deleteSite, getPublishedArticleBySlug, getPublishedArticlesForSite, listArticles, listSites, saveArticle, deleteArticle, listCategories, createCategory, deleteCategory, updateSite } from "./lib/db";
import { json, parseJson, text } from "./lib/http";
import type { Env } from "./lib/types";
import type { DashboardUser } from "./lib/ownership";
import { DEFAULT_USER_ID, activeScopeId, tableHasUserId, tableHasWorkspaceId } from "./lib/ownership";
import { authenticateDashboardUser } from "./lib/users";
import { markLinkedPlannerItemsPublished, markSocialPostsFailed, socialPublishErrorMessage } from "./lib/social-publish";
import { readAccountTags } from "./lib/account-tags";
import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaignStats,
  publishRedditPost,
  listRedditComments,
  listRedditSubscribedSubreddits,
  searchRedditPosts,
  createRedditReply,
} from "./handlers/reddit";
import { addRedditAccount, handleAuthorizeRequest, handleOAuthCallback, listInternalRedditAccounts, listRedditAccounts, updateRedditAccount, deleteRedditAccount } from "./handlers/reddit-auth";
import { getKnowledgeBase, saveKnowledgeBase, getVersions, getVersion } from "./handlers/knowledge-base";
import { listStrategies, getStrategy, createStrategy, updateStrategy, activateStrategy, deactivateStrategy, deleteStrategy, getStrategyStats, getStrategyExecutions, getActiveStrategyInternal } from "./handlers/trading";
import { generateArticleCover, styleArticleContent, suggestArticleField } from "./handlers/article-ai";
import { suggestSocialReply } from "./handlers/social-replies";
import {
  addExtraSocialAccount,
  authorizeFacebookAccount,
  authorizeInstagramAccount,
  authorizeLinkedInAccount,
  deleteExtraSocialAccount,
  handleFacebookOAuthCallback,
  handleMetaDataDeletionRequest,
  handleMetaDeauthorizeCallback,
  handleInstagramOAuthCallback,
  handleLinkedInOAuthCallback,
  listInstagramPostInsights,
  listLinkedInPostInsights,
  listExtraSocialAccounts,
  listInternalExtraSocialAccounts,
  proxySocialAccountAvatar,
  publishExtraSocialPost,
  updateExtraSocialAccount,
  updateSocialAccountTags,
  updatePublishedLinkedInPost,
} from "./handlers/social-accounts";
import { completeCtraderConnectionFromAgent, getAppSettings, getCustomLeanDiagnostics, getCustomLeanSettings, getCustomLeanWorkers, getInternalAgentSettings, getLeanStatus, getLearningReport, getMlTradingAssets, getMlTradingDiagnostics, getMlTradingSettings, syncAgentFromSettings, updateAppSettings, updateCustomLeanSettings, updateMlTradingSettings } from "./handlers/settings";
import {
  listPlannerItems,
  createPlannerItem,
  updatePlannerItem,
  deletePlannerItem,
  listTradingNotes,
  createTradingNote,
  updateTradingNote,
  deleteTradingNote,
  plannerHasSocialPostLinks,
} from "./handlers/planner";
import { improvePlannerDescription } from "./handlers/planner-ai";
import {
  listSocialPosts,
  createSocialPost,
  updateSocialPost,
  deleteSocialPost,
  publishTwitterPost,
  createTwitterReply,
  listTwitterAccounts,
  addTwitterAccount,
  updateTwitterAccount,
  deleteTwitterAccount,
  authorizeTwitterAccount,
  handleTwitterOAuthCallback,
  getSocialPostSchemaCapabilities,
  listTwitterComments,
  listTwitterPostInsights,
  searchTwitterPosts,
} from "./handlers/twitter";
import {
  listThreadsAccounts,
  addThreadsAccount,
  updateThreadsAccount,
  deleteThreadsAccount,
  authorizeThreadsAccount,
  handleThreadsOAuthCallback,
  publishThreadsPost,
  searchThreads,
  listThreadsReplies,
  createThreadsReply,
  fetchThreadsRepliesData,
  listThreadsComments,
  listThreadsPostInsights,
} from "./handlers/threads";
import {
  listThreadsCampaignResults,
  upsertThreadsCampaignResults,
  updateThreadsCampaignResult,
} from "./handlers/threads-campaigns";
import {
  createStudioApp,
  createStudioCampaign,
  createStudioCrawlerRun,
  createStudioSignals,
  createStudioStrategistPosts,
  deleteStudioApp,
  deleteStudioCampaign,
  deleteStudioSignal,
  getStudioSummary,
  listStudioAccounts,
  listStudioApps,
  listStudioCampaigns,
  listStudioCrawlerRuns,
  listStudioNotifications,
  listStudioSignals,
  listStudioStrategistPosts,
  regenerateStudioStrategistPost,
  scheduleStudioStrategistPost,
  unpostStudioStrategistPost,
  updateStudioApp,
  updateStudioCampaign,
  updateStudioCrawlerRun,
  updateStudioNotification,
  updateStudioStrategistPost,
} from "./handlers/studio";
import { handleMcpRequest } from "./handlers/mcp";
import { createUser, getProfile, listUsers, updateProfile } from "./handlers/users";
import { authorizeGoogleDashboardLogin, handleGoogleDashboardCallback, isGoogleAuthConfigured } from "./handlers/google-auth";

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function renderLegalPage(title: string, description: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | Oilor Studio</title>
    <meta name="description" content="${description}" />
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f8fb;
        --panel: #ffffff;
        --text: #151823;
        --muted: #5f6b85;
        --border: #d9deea;
        --accent: #1f4dff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f9fbff 0%, var(--bg) 100%);
        color: var(--text);
      }
      main {
        max-width: 860px;
        margin: 48px auto;
        padding: 0 20px 48px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 16px 40px rgba(17, 24, 39, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 1.05;
      }
      p, li {
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.7;
      }
      h2 {
        margin-top: 28px;
        font-size: 1.1rem;
      }
      a { color: var(--accent); }
      .eyebrow {
        display: inline-block;
        margin-bottom: 12px;
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
      }
      footer {
        margin-top: 28px;
        padding-top: 20px;
        border-top: 1px solid var(--border);
      }
      ul {
        padding-left: 20px;
      }
      code {
        padding: 0.15rem 0.35rem;
        border-radius: 0.35rem;
        background: #eff3ff;
        color: #2140aa;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <span class="eyebrow">Oilor Studio Legal</span>
        <h1>${title}</h1>
        <p>${description}</p>
        ${body}
        <footer>
          <p>Questions about this policy can be sent to <a href="mailto:adilet.melisov@gmail.com">adilet.melisov@gmail.com</a>.</p>
        </footer>
      </section>
    </main>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function handleLegalPage(pathname: string): Response | null {
  if (pathname === "/legal/privacy") {
    return renderLegalPage(
      "Privacy Policy",
      "How Oilor Studio handles account credentials, publishing metadata, and support requests for its dashboard and connected social integrations.",
      `
        <h2>Information we collect</h2>
        <p>Oilor Studio stores only the information needed to run the dashboard and publish social content on your behalf. This can include account usernames, connected platform tokens, scheduled post content, publishing history, and support contact details you provide.</p>
        <h2>How we use information</h2>
        <ul>
          <li>To authenticate you into the dashboard and keep your workspace settings available.</li>
          <li>To publish or schedule content to platforms you explicitly connect, such as Threads, X, or Reddit.</li>
          <li>To troubleshoot delivery issues, sync connected agents, and respond to support requests.</li>
        </ul>
        <h2>Data sharing</h2>
        <p>We do not sell your personal information. Data is shared only with the third-party platforms you connect for the purpose of publishing, moderating, or retrieving account-related content that you requested.</p>
        <h2>Data retention</h2>
        <p>Connected account credentials and scheduled content remain stored until you remove the account, delete the content, or request deletion. Operational logs may be retained for security, fraud prevention, and service reliability.</p>
        <h2>Your choices</h2>
        <p>You can disconnect connected social accounts from the dashboard at any time and request deletion of related account data by following the instructions at <a href="/legal/data-deletion">/legal/data-deletion</a>.</p>
      `,
    );
  }

  if (pathname === "/legal/terms") {
    return renderLegalPage(
      "Terms of Service",
      "The core terms governing use of the Oilor Studio dashboard and its connected publishing tools.",
      `
        <h2>Use of the service</h2>
        <p>Oilor Studio may be used only for lawful publishing, scheduling, research, and account-management workflows. You are responsible for content sent through any connected platform account.</p>
        <h2>Connected platform accounts</h2>
        <p>By connecting a third-party platform account, you confirm that you have permission to use that account and authorize Oilor Studio to publish or retrieve information needed to perform the actions you request.</p>
        <h2>Acceptable use</h2>
        <ul>
          <li>No unlawful, fraudulent, abusive, or infringing use of the platform.</li>
          <li>No attempts to bypass platform rules, rate limits, or access restrictions.</li>
          <li>No use of the service to distribute malware, spam, or deceptive content.</li>
        </ul>
        <h2>Service changes</h2>
        <p>Features, integrations, and platform support may change over time. We may suspend or limit access if needed to protect the service, comply with legal obligations, or respond to misuse.</p>
        <h2>Termination</h2>
        <p>You may stop using the service at any time. We may suspend or terminate access for violations of these terms or to protect the integrity and security of the platform.</p>
      `,
    );
  }

  if (pathname === "/legal/data-deletion") {
    return renderLegalPage(
      "Data Deletion Instructions",
      "How to request removal of Oilor Studio account data and connected platform credentials.",
      `
        <h2>Delete data from the dashboard</h2>
        <p>To remove connected platform credentials, sign in to the Oilor Studio dashboard and disconnect the relevant account from the Social Agents section. This removes the stored access credentials used for publishing.</p>
        <h2>Request full data deletion</h2>
        <p>If you want your workspace data removed entirely, email <a href="mailto:adilet.melisov@gmail.com">adilet.melisov@gmail.com</a> with the subject line <code>Data Deletion Request</code> and include the account email or platform username associated with your workspace.</p>
        <h2>What will be deleted</h2>
        <ul>
          <li>Connected social account credentials and tokens</li>
          <li>Scheduled and draft social posts stored in the dashboard</li>
          <li>Workspace settings that are no longer required for legal, billing, or security obligations</li>
        </ul>
        <h2>Processing timeline</h2>
        <p>We aim to process deletion requests within 30 days, subject to any information we must retain temporarily for security, fraud prevention, or legal compliance.</p>
      `,
    );
  }

  return null;
}

async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  const authenticated = await validateSession(request, env);
  if (!authenticated) {
    return text("Unauthorized", 401);
  }
  return null;
}

async function requireUser(request: Request, env: Env): Promise<DashboardUser | Response> {
  const user = await getSessionUser(request, env);
  return user ?? text("Unauthorized", 401);
}

function isAuthResponse(value: DashboardUser | Response): value is Response {
  return value instanceof Response;
}

async function requireAgentAuth(request: Request, env: Env): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = await (async () => {
    if (env.TRADING_AGENT_SYNC_SECRET) {
      return env.TRADING_AGENT_SYNC_SECRET;
    }
    const row = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'trading_agent_token' ORDER BY updated_at DESC LIMIT 1",
    ).first<{ value: string }>();
    return row?.value ?? "";
  })();

  if (!token || authHeader !== `Bearer ${token}`) {
    return text("Unauthorized", 401);
  }

  return null;
}

function buildDefaultCanonicalUrl(
  articleSlug: string,
  siteId: number | undefined,
  sites: Awaited<ReturnType<typeof listSites>>,
): string {
  const site = sites.find((entry) => entry.id === siteId);
  if (site?.domain) {
    const domain = site.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${domain}/articles/${articleSlug}`;
  }
  return `https://journl.day/articles/${articleSlug}`;
}

async function listInternalRedditSubreddits(env: Env): Promise<{
  data: unknown[];
  account_id?: number | null;
  account_name?: string | null;
  warning?: string | null;
}> {
  try {
    const response = await listRedditSubscribedSubreddits(
      env,
      new URL("https://internal.local/api/reddit/subreddits"),
      DEFAULT_USER_ID,
      DEFAULT_USER_ID,
    );
    const payload = await response.json() as {
      data?: unknown[];
      account_id?: number | null;
      account_name?: string | null;
      warning?: string | null;
    };
    return {
      data: Array.isArray(payload.data) ? payload.data.slice(0, 80) : [],
      account_id: payload.account_id ?? null,
      account_name: payload.account_name ?? null,
      warning: response.ok ? payload.warning ?? null : payload.warning ?? "Could not load Reddit subreddit suggestions.",
    };
  } catch (error) {
    return {
      data: [],
      warning: error instanceof Error ? error.message : "Could not load Reddit subreddit suggestions.",
    };
  }
}

async function handleInternalContext(env: Env) {
  const hasSocialPostLinks = await plannerHasSocialPostLinks(env);
  const socialPostSchema = await getSocialPostSchemaCapabilities(env);
  const socialPostSelect = [
    "id",
    "platform",
    ...(socialPostSchema.hasTitle ? ["title"] : ["NULL AS title"]),
    ...(socialPostSchema.hasSubreddit ? ["subreddit"] : ["NULL AS subreddit"]),
    ...(socialPostSchema.hasAccountId ? ["account_id"] : ["NULL AS account_id"]),
    ...(socialPostSchema.hasReplyToId ? ["reply_to_id"] : ["NULL AS reply_to_id"]),
    "content",
    "image_url",
    "status",
    "scheduled_at",
    "posted_at",
    "external_id",
    ...(socialPostSchema.hasLastError ? ["last_error"] : ["NULL AS last_error"]),
    "updated_at",
  ].join(", ");
  const [
    sites,
    categories,
    articles,
    strategiesResult,
    plannerItemsResult,
    tradingNotesResult,
    redditCampaignsResult,
    redditAccountsResult,
    redditSubredditsResult,
    twitterAccountsResult,
    threadsAccountsResult,
    extraAccountsResult,
    redditPostsResult,
    twitterPostsResult,
    threadsPostsResult,
    instagramPostsResult,
    threadsRepliesData,
    threadsCampaignResultsResult,
    knowledgeBasesResult,
  ] = await Promise.all([
    listSites(env),
    listCategories(env),
    listArticles(env),
    env.DB.prepare(
      `SELECT id, name, assets, strategy_type, execution_mode, status, updated_at
       FROM trading_strategies
       ORDER BY updated_at DESC
       LIMIT 10`,
    ).all(),
    env.DB.prepare(
      `SELECT id, title, platform, item_type, status, scheduled_for, ${hasSocialPostLinks ? "social_post_id" : "NULL AS social_post_id"}, updated_at
       FROM planner_items
       ORDER BY COALESCE(scheduled_for, updated_at) DESC
       LIMIT 20`,
    ).all(),
    env.DB.prepare(
      `SELECT id, title, note_type, updated_at
       FROM trading_notes
       ORDER BY updated_at DESC
       LIMIT 20`,
    ).all(),
    env.DB.prepare(
      `SELECT id, name, subreddit, status, updated_at
       FROM reddit_campaigns
       ORDER BY updated_at DESC
       LIMIT 20`,
    ).all(),
    listInternalRedditAccounts(env),
    listInternalRedditSubreddits(env),
    env.DB.prepare(
      `SELECT id, username, status, created_at
       FROM social_accounts
       WHERE platform = 'twitter'
       ORDER BY created_at DESC`,
    ).all(),
    env.DB.prepare(
      `SELECT id, username, status, created_at
      FROM social_accounts
       WHERE platform = 'threads'
       ORDER BY created_at DESC`,
    ).all(),
    listInternalExtraSocialAccounts(env),
    env.DB.prepare(
      `SELECT ${socialPostSelect}
       FROM social_posts
       WHERE platform = 'reddit'
       ORDER BY updated_at DESC
       LIMIT 20`,
    ).all(),
    env.DB.prepare(
      `SELECT ${socialPostSelect}
       FROM social_posts
       WHERE platform = 'twitter'
       ORDER BY updated_at DESC
       LIMIT 20`,
    ).all(),
    env.DB.prepare(
      `SELECT ${socialPostSelect}
       FROM social_posts
       WHERE platform = 'threads'
       ORDER BY updated_at DESC
       LIMIT 20`,
    ).all(),
    env.DB.prepare(
      `SELECT ${socialPostSelect}
       FROM social_posts
       WHERE platform = 'instagram'
       ORDER BY updated_at DESC
       LIMIT 20`,
    ).all(),
    fetchThreadsRepliesData(env, { limit: "20" }).catch(() => []),
    env.DB.prepare(
      `SELECT id, campaign_id, media_id, review_status, created_at, updated_at
       FROM threads_campaign_results
       ORDER BY created_at DESC
       LIMIT 40`,
    ).all(),
    env.DB.prepare(
      `SELECT id, entity_type, entity_id, title, content, version, updated_at
       FROM knowledge_bases
       ORDER BY updated_at DESC
       LIMIT 20`,
    ).all(),
  ]);

  const parseStringArray = (value: unknown) => {
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  };

  const knowledgeBases = knowledgeBasesResult.results ?? [];
  const socialPlatformKnowledgeBases = Array.isArray(knowledgeBases)
    ? knowledgeBases
      .filter((entry) => entry.entity_type === "social_platform")
      .reduce<Record<string, unknown>>((accumulator, entry) => {
        const platform =
          Number(entry.entity_id) === 0 ? "reddit"
            : Number(entry.entity_id) === 1 ? "twitter"
              : Number(entry.entity_id) === 2 ? "threads"
                : `social_${String(entry.entity_id)}`;
        accumulator[platform] = entry;
        return accumulator;
      }, {})
    : {};
  const globalKnowledgeBase = Array.isArray(knowledgeBases)
    ? knowledgeBases.find((entry) => entry.entity_type === "global" && Number(entry.entity_id) === 0) ?? null
    : null;
  const [twitterAccounts, threadsAccounts] = await Promise.all([
    Promise.all((twitterAccountsResult.results ?? []).map(async (account) => ({
      ...account,
      tags: await readAccountTags(env, "social_account", Number((account as { id?: number }).id ?? 0)),
    }))),
    Promise.all((threadsAccountsResult.results ?? []).map(async (account) => ({
      ...account,
      tags: await readAccountTags(env, "social_account", Number((account as { id?: number }).id ?? 0)),
    }))),
  ]);

  return json({
    scope: {
      allowed: [
        "sites",
        "categories",
        "articles",
        "strategies",
        "reddit_campaigns",
        "planner_items",
        "trading_notes",
        "knowledge_bases",
        "global_knowledge_base",
        "social_accounts",
        "reddit_subreddits",
        "social_posts",
        "threads_replies",
        "threads_campaign_results",
        "media_uploads",
      ],
      blocked: [
        "settings",
        "api_connections",
        "auth",
      ],
    },
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      slug: site.slug,
      domain: site.domain,
      status: site.status,
    })),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
    })),
    articles: articles.slice(0, 12).map((article) => ({
      id: article.id,
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      status: article.status,
      published_at: article.published_at,
      updated_at: article.updated_at,
      cover_image: article.cover_image,
      category: article.category?.name ?? null,
      site_ids: article.site_ids,
      site_slugs: sites
        .filter((site) => article.site_ids.includes(site.id))
        .map((site) => site.slug),
      seo: article.seo,
      content_preview: article.content.slice(0, 1600),
    })),
    strategies: (strategiesResult.results ?? []).map((strategy) => ({
      id: strategy.id,
      name: strategy.name,
      assets: parseStringArray(strategy.assets),
      strategy_type: strategy.strategy_type,
      execution_mode: strategy.execution_mode,
      status: strategy.status,
      updated_at: strategy.updated_at,
    })),
    reddit_campaigns: redditCampaignsResult.results ?? [],
    planner_items: plannerItemsResult.results ?? [],
    trading_notes: tradingNotesResult.results ?? [],
    knowledge_bases: knowledgeBases,
    global_knowledge_base: globalKnowledgeBase,
    social_platform_knowledge_bases: socialPlatformKnowledgeBases,
    social_accounts: {
      reddit: redditAccountsResult,
      twitter: twitterAccounts,
      threads: threadsAccounts,
      instagram: extraAccountsResult.filter((account) => account.platform === "instagram"),
      facebook: extraAccountsResult.filter((account) => account.platform === "facebook"),
      linkedin: extraAccountsResult.filter((account) => account.platform === "linkedin"),
      youtube: extraAccountsResult.filter((account) => account.platform === "youtube"),
    },
    reddit_subreddits: redditSubredditsResult.data,
    reddit_subreddits_warning: redditSubredditsResult.warning ?? null,
    social_posts: {
      reddit: redditPostsResult.results ?? [],
      twitter: twitterPostsResult.results ?? [],
      threads: threadsPostsResult.results ?? [],
      instagram: instagramPostsResult.results ?? [],
    },
    threads_replies: threadsRepliesData,
    threads_campaign_results: threadsCampaignResultsResult.results ?? [],
  });
}

async function handleInternalSocialPostPublishResult(env: Env, postId: string, request: Request) {
  const id = Number(postId);
  if (!Number.isFinite(id) || id <= 0) return json({ error: "Invalid social post ID" }, { status: 400 });
  const payload = await parseJson<{
    status?: "posted" | "failed";
    external_id?: string | null;
    posted_at?: string | null;
    account_id?: number | null;
    error?: string | null;
    last_error?: string | null;
  }>(request);
  const status = payload.status === "failed" ? "failed" : "posted";
  const now = new Date().toISOString();
  const postedAt = status === "posted" ? (payload.posted_at || now) : null;
  const existing = await env.DB.prepare("SELECT id FROM social_posts WHERE id = ?").bind(id).first<{ id: number }>();
  if (!existing) return json({ error: "Social post not found" }, { status: 404 });
  const socialPostSchema = await getSocialPostSchemaCapabilities(env);

  const updates = ["status = ?", "updated_at = ?"];
  const values: unknown[] = [status, now];
  if (status === "posted") {
    updates.push("posted_at = ?");
    values.push(postedAt);
    updates.push("external_id = ?");
    values.push(payload.external_id?.trim() || null);
  }
  if (payload.account_id !== undefined) {
    updates.push("account_id = ?");
    values.push(payload.account_id);
  }
  if (socialPostSchema.hasLastError) {
    updates.push("last_error = ?");
    values.push(status === "failed" ? (payload.last_error || payload.error || "Publishing failed") : null);
  }

  await env.DB.prepare(`UPDATE social_posts SET ${updates.join(", ")} WHERE id = ?`).bind(...values, id).run();
  if (status === "posted") {
    await markLinkedPlannerItemsPublished(env, id, postedAt || now);
  }
  return json({ success: true, id, status, posted_at: postedAt, external_id: payload.external_id ?? null });
}

async function handleInternalMediaUpload(request: Request, env: Env) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return text("Missing file upload", 400);
  }

  const extension = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const key = `uploads/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
    },
  });

  const publicBaseUrl = env.PUBLIC_MEDIA_BASE_URL ?? "/api/media/";
  const url = publicBaseUrl.startsWith("http")
    ? `${publicBaseUrl.replace(/\/$/, "")}/${key}`
    : `${new URL(publicBaseUrl + key, request.url).toString()}`;

  return json({ key, url });
}

async function handleInternalArticlePatch(request: Request, env: Env, id: number) {
  const patch = await parseJson<{
    title?: string;
    slug?: string;
    excerpt?: string;
    content?: string;
    cover_image?: string | null;
    status?: "draft" | "published";
    published_at?: string | null;
    category_id?: number | null;
    category?: string;
    site_ids?: number[];
    site_slugs?: string[];
    seo?: {
      meta_title?: string;
      meta_description?: string;
      og_image?: string;
      canonical_url?: string;
    };
  }>(request);

  const [articles, sites, categories] = await Promise.all([
    listArticles(env),
    listSites(env),
    listCategories(env),
  ]);
  const current = articles.find((article) => article.id === id);
  if (!current) {
    return text("Article not found", 404);
  }

  let nextCategoryId = current.category_id ?? null;
  if (patch.category_id !== undefined) {
    nextCategoryId = patch.category_id;
  } else if (patch.category) {
    const needle = patch.category.trim().toLowerCase();
    const match = categories.find(
      (category) =>
        category.name.trim().toLowerCase() === needle ||
        category.slug.trim().toLowerCase() === needle,
    );
    nextCategoryId = match?.id ?? null;
  }

  let nextSiteIds = current.site_ids;
  if (Array.isArray(patch.site_ids) && patch.site_ids.length > 0) {
    nextSiteIds = patch.site_ids;
  } else if (Array.isArray(patch.site_slugs) && patch.site_slugs.length > 0) {
    const wanted = new Set(patch.site_slugs.map((slug) => slug.trim().toLowerCase()));
    nextSiteIds = sites
      .filter((site) => wanted.has(site.slug.trim().toLowerCase()))
      .map((site) => site.id);
  }

  const nextTitle = patch.title ?? current.title;
  const nextSlug = patch.slug ?? current.slug;
  const nextCoverImage = patch.cover_image !== undefined ? patch.cover_image : current.cover_image;
  const nextStatus = patch.status ?? current.status;
  const nextPublishedAt = patch.published_at !== undefined
    ? patch.published_at
    : nextStatus === "published"
      ? current.published_at ?? new Date().toISOString()
      : current.published_at;

  const nextSeo = {
    meta_title: patch.seo?.meta_title ?? current.seo.meta_title ?? "",
    meta_description: patch.seo?.meta_description ?? current.seo.meta_description ?? "",
    og_image: patch.seo?.og_image ?? current.seo.og_image ?? "",
    canonical_url: patch.seo?.canonical_url ?? current.seo.canonical_url ?? "",
  };

  if (!nextSeo.meta_title) {
    nextSeo.meta_title = nextTitle;
  }
  if (!nextSeo.og_image && nextCoverImage) {
    nextSeo.og_image = nextCoverImage;
  }
  if (!nextSeo.canonical_url) {
    nextSeo.canonical_url = buildDefaultCanonicalUrl(nextSlug, nextSiteIds[0], sites);
  }

  const saved = await saveArticle(env, {
    title: nextTitle,
    slug: nextSlug,
    excerpt: patch.excerpt ?? current.excerpt,
    content: patch.content ?? current.content,
    cover_image: nextCoverImage,
    status: nextStatus,
    published_at: nextPublishedAt,
    category_id: nextCategoryId,
    site_ids: nextSiteIds,
    seo: nextSeo,
  }, id);

  return json(saved);
}

async function handleBootstrap(request: Request, env: Env) {
  const user = await getSessionUser(request, env);
  const authenticated = Boolean(user);
  const googleAuthConfigured = isGoogleAuthConfigured(env);
  return json({
    auth: authenticated
      ? { authenticated: true, username: user?.username, user, google_auth_configured: googleAuthConfigured }
      : { authenticated: false, google_auth_configured: googleAuthConfigured },
    sites: authenticated ? await listSites(env) : [],
    articles: authenticated ? await listArticles(env) : [],
  });
}

async function handleLogin(request: Request, env: Env) {
  const body = await parseJson<{ username: string; password: string; remember?: boolean }>(request);
  const user = await authenticateDashboardUser(env, body.username, body.password);
  if (!user) {
    return text("Invalid credentials", 401);
  }

  return json(
    { authenticated: true, username: user.username, user, google_auth_configured: isGoogleAuthConfigured(env) },
    {
      headers: {
        "Set-Cookie": await createSessionCookie(user, env, body.remember !== false),
      },
    },
  );
}

async function handleMediaUpload(request: Request, env: Env) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return text("Missing file upload", 400);
  }

  const extension = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const key = `uploads/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
    },
  });

  const publicBaseUrl = env.PUBLIC_MEDIA_BASE_URL ?? "/api/media/";
  const url = publicBaseUrl.startsWith("http")
    ? `${publicBaseUrl.replace(/\/$/, "")}/${key}`
    : `${new URL(publicBaseUrl + key, request.url).toString()}`;

  return json({ key, url });
}

async function handleMediaFetch(env: Env, key: string, includeBody = true) {
  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) {
    return text("File not found", 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(includeBody ? object.body : null, { headers });
}

type WorkerSurface = "marketing" | "trading";

function getWorkerSurface(env: Env): WorkerSurface {
  return env.DASHBOARD_SURFACE === "trading" ? "trading" : "marketing";
}

function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isSharedApiPath(pathname: string): boolean {
  return (
    pathname === "/api/bootstrap" ||
    pathMatches(pathname, "/api/auth") ||
    pathMatches(pathname, "/api/profile") ||
    pathMatches(pathname, "/api/users") ||
    pathMatches(pathname, "/api/settings") ||
    pathMatches(pathname, "/api/media") ||
    pathMatches(pathname, "/api/knowledge-base") ||
    pathMatches(pathname, "/api/internal/knowledge-base") ||
    pathMatches(pathname, "/api/internal/settings/agent")
  );
}

function isMarketingApiPath(pathname: string): boolean {
  return [
    "/api/public/articles",
    "/api/sites",
    "/api/articles",
    "/api/categories",
    "/api/reddit",
    "/api/facebook",
    "/api/instagram",
    "/api/linkedin",
    "/api/meta",
    "/api/social",
    "/api/twitter",
    "/api/threads",
    "/api/studio",
    "/api/planner",
    "/api/stats",
    "/api/internal/context",
    "/api/internal/articles",
    "/api/internal/media",
    "/api/internal/planner",
    "/api/internal/reddit",
    "/api/internal/social",
    "/api/internal/studio",
  ].some((prefix) => pathMatches(pathname, prefix));
}

function isTradingApiPath(pathname: string): boolean {
  return (
    pathMatches(pathname, "/api/trading") ||
    pathMatches(pathname, "/api/internal/trading") ||
    pathMatches(pathname, "/api/internal/settings/ctrader")
  );
}

function isMcpEndpointPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname === "/mcp/" || pathname === "/api/mcp" || pathname === "/api/mcp/";
}

function isMcpAuthPath(pathname: string): boolean {
  return isMcpEndpointPath(pathname) || pathname.startsWith("/oauth/") || pathname.startsWith("/.well-known/oauth");
}

function enforceSurfaceRoute(env: Env, pathname: string): Response | null {
  const surface = getWorkerSurface(env);

  if (isMcpAuthPath(pathname) && surface !== "marketing") {
    return text("Not found", 404);
  }

  if (!pathname.startsWith("/api/")) return null;
  if (isMcpAuthPath(pathname)) return null;
  if (isSharedApiPath(pathname)) return null;

  const allowed = surface === "trading" ? isTradingApiPath(pathname) : isMarketingApiPath(pathname);
  return allowed ? null : text("Not found", 404);
}

type DueSocialPost = {
  id: number;
  platform: string;
  user_id?: number | null;
  workspace_id?: number | null;
};

const SCHEDULED_SOCIAL_PLATFORMS = ["threads", "twitter", "reddit", "instagram", "linkedin", "youtube"];

async function responseErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body.trim()) return `Publishing failed with HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error : typeof parsed.message === "string" ? parsed.message : "";
    return message || body.trim().slice(0, 2000);
  } catch {
    return body.trim().slice(0, 2000);
  }
}

async function publishScheduledSocialPost(env: Env, post: DueSocialPost, now: string): Promise<boolean> {
  const scopeId = post.workspace_id ?? post.user_id ?? DEFAULT_USER_ID;
  const dashboardUserId = post.user_id ?? DEFAULT_USER_ID;
  let response: Response;

  if (post.platform === "threads") {
    response = await publishThreadsPost(env, String(post.id), scopeId);
  } else if (post.platform === "twitter") {
    response = await publishTwitterPost(env, String(post.id), scopeId);
  } else if (post.platform === "reddit") {
    response = await publishRedditPost(env, String(post.id), scopeId, dashboardUserId);
  } else if (["instagram", "linkedin", "youtube"].includes(post.platform)) {
    response = await publishExtraSocialPost(env, String(post.id), scopeId, dashboardUserId);
  } else {
    await markSocialPostsFailed(env, ["id = ?"], [post.id], now, `Scheduled publishing is not available for ${post.platform}.`);
    return false;
  }

  if (response.ok || response.status === 409) return response.ok;
  await markSocialPostsFailed(env, ["id = ?"], [post.id], now, await responseErrorMessage(response));
  return false;
}

async function publishDueSocialPosts(env: Env): Promise<{ published: number; failed: number; total: number }> {
  const now = new Date().toISOString();
  const hasUserId = await tableHasUserId(env, "social_posts");
  const hasWorkspaceId = await tableHasWorkspaceId(env, "social_posts");
  const selectColumns = ["id", "platform"];
  if (hasUserId) selectColumns.push("user_id");
  if (hasWorkspaceId) selectColumns.push("workspace_id");

  const due = await env.DB.prepare(
    `SELECT ${selectColumns.join(", ")}
     FROM social_posts
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= ?
       AND platform IN (${SCHEDULED_SOCIAL_PLATFORMS.map(() => "?").join(", ")})
     ORDER BY scheduled_at ASC, id ASC
     LIMIT 20`,
  )
    .bind(now, ...SCHEDULED_SOCIAL_PLATFORMS)
    .all<DueSocialPost>();

  let published = 0;
  let failed = 0;
  for (const post of due.results ?? []) {
    try {
      if (await publishScheduledSocialPost(env, post, now)) {
        published += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      const message = socialPublishErrorMessage(error, "Scheduled publishing failed");
      await markSocialPostsFailed(env, ["id = ?"], [post.id], new Date().toISOString(), message);
      console.error(`Failed to publish scheduled social post ${post.id}:`, error);
    }
  }

  return { published, failed, total: (due.results ?? []).length };
}

export default {
  async scheduled(_controller: unknown, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await publishDueSocialPosts(env);
    if (result.total > 0) {
      console.log(`Scheduled social publisher processed ${result.total} posts: ${result.published} published, ${result.failed} failed.`);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);

      const surfaceRouteError = enforceSurfaceRoute(env, url.pathname);
      if (surfaceRouteError) {
        return surfaceRouteError;
      }

      if (isMcpAuthPath(url.pathname)) {
        return handleMcpRequest(request, env, ctx);
      }

      const legalPage = handleLegalPage(url.pathname);
      if (legalPage && request.method === "GET") {
        return legalPage;
      }

      if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/api/bootstrap" && request.method === "GET") {
      return handleBootstrap(request, env);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    if (url.pathname === "/api/auth/google/authorize" && request.method === "GET") {
      return authorizeGoogleDashboardLogin(request, env);
    }

    if (url.pathname === "/api/auth/google/callback" && request.method === "GET") {
      return handleGoogleDashboardCallback(request, env);
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return json(
        { authenticated: false },
        {
          headers: {
            "Set-Cookie": clearSessionCookie(),
          },
        },
      );
    }

    if (url.pathname === "/api/profile" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return getProfile(user);
    }

    if (url.pathname === "/api/profile" && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return updateProfile(env, user, request);
    }

    if (url.pathname === "/api/users" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return listUsers(env, user);
    }

    if (url.pathname === "/api/users" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return createUser(env, user, request);
    }

    if (url.pathname === "/api/public/articles" && request.method === "GET") {
      const site = url.searchParams.get("site");
      if (!site) {
        return withCors(text("Missing site query parameter", 400));
      }
      try {
        return withCors(json({ data: await getPublishedArticlesForSite(env, site) }));
      } catch (err) {
        return withCors(text("Internal server error", 500));
      }
    }

    if (url.pathname.startsWith("/api/public/articles/") && request.method === "GET") {
      const site = url.searchParams.get("site");
      const slug = url.pathname.split("/").pop();
      if (!site || !slug) {
        return withCors(text("Missing site or slug", 400));
      }
      try {
        const article = await getPublishedArticleBySlug(env, site, slug);
        if (!article) {
          return withCors(text("Article not found", 404));
        }
        return withCors(json({ data: article }));
      } catch (err) {
        return withCors(text("Internal server error", 500));
      }
    }

    if (url.pathname === "/api/internal/context" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return handleInternalContext(env);
    }

    if (url.pathname === "/api/internal/trading/active-strategy" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return getActiveStrategyInternal(env);
    }

    if (url.pathname === "/api/internal/settings/agent" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return getInternalAgentSettings(env);
    }

    if (url.pathname.startsWith("/api/internal/knowledge-base/") && request.method === "GET" && !url.pathname.includes("/versions")) {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      return await getKnowledgeBase(env, parts[4], parts[5]);
    }

    if (url.pathname.startsWith("/api/internal/knowledge-base/") && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      return await saveKnowledgeBase(env, parts[4], parts[5], request);
    }

    if (url.pathname === "/api/internal/media" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return handleInternalMediaUpload(request, env);
    }

    if (url.pathname.startsWith("/api/internal/articles/") && request.method === "PATCH") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = Number(url.pathname.split("/").pop());
      if (!id) return text("Invalid article id", 400);
      return handleInternalArticlePatch(request, env, id);
    }

    if (url.pathname === "/api/internal/planner/items" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listPlannerItems(env);
    }

    if (url.pathname === "/api/internal/planner/items" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createPlannerItem(env, request);
    }

    if (url.pathname.startsWith("/api/internal/planner/items/") && request.method === "PUT") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await updatePlannerItem(env, id, request);
    }

    if (url.pathname.startsWith("/api/internal/planner/items/") && request.method === "DELETE") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await deletePlannerItem(env, id);
    }

    if (url.pathname === "/api/internal/planner/improve-description" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await improvePlannerDescription(env, request);
    }

    if (url.pathname === "/api/internal/reddit/campaigns" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listCampaigns(env);
    }

    if (url.pathname === "/api/internal/reddit/campaigns" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createCampaign(env, request);
    }

    if (url.pathname.startsWith("/api/internal/reddit/campaigns/") && request.method === "PUT") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await updateCampaign(env, id, request);
    }

    if (url.pathname.startsWith("/api/internal/reddit/campaigns/") && request.method === "DELETE") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await deleteCampaign(env, id);
    }

    if (url.pathname === "/api/internal/social/posts" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const platform = url.searchParams.get("platform") ?? "twitter";
      return await listSocialPosts(env, platform);
    }

    if (url.pathname === "/api/internal/social/posts" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const body = await parseJson<{ platform: string; title?: string; subreddit?: string; content?: string; scheduled_at?: string; image_url?: unknown; account_id?: number | null; reply_to_id?: string | null }>(request);
      const platform = body.platform ?? "twitter";
      return await createSocialPost(env, platform, new Request(request.url, {
        method: "POST",
        body: JSON.stringify({ title: body.title, subreddit: body.subreddit, content: body.content, scheduled_at: body.scheduled_at, image_url: body.image_url, account_id: body.account_id, reply_to_id: body.reply_to_id }),
        headers: { "Content-Type": "application/json" },
      }));
    }

    if (url.pathname.startsWith("/api/internal/social/posts/") && url.pathname.endsWith("/publish-result") && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      return await handleInternalSocialPostPublishResult(env, parts[5], request);
    }

    if (url.pathname === "/api/internal/social/twitter/search" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await searchTwitterPosts(env, url);
    }

    if (url.pathname === "/api/internal/social/reddit/search" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await searchRedditPosts(env, url);
    }

    if (url.pathname.startsWith("/api/internal/social/posts/") && url.pathname.endsWith("/publish") && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      const id = parts[5];
      const post = await env.DB.prepare("SELECT platform FROM social_posts WHERE id = ?")
        .bind(id)
        .first<{ platform: string }>();
      if (!post) return json({ error: "Social post not found" }, { status: 404 });
      if (post.platform === "threads") return await publishThreadsPost(env, id);
      if (post.platform === "twitter") return await publishTwitterPost(env, id);
      if (post.platform === "reddit") return await publishRedditPost(env, id);
      if (["instagram", "linkedin", "youtube"].includes(post.platform)) return await publishExtraSocialPost(env, id);
      return json({ error: "Direct publishing is not available for this platform yet." }, { status: 400 });
    }

    if (url.pathname === "/api/internal/social/comments" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const platform = (url.searchParams.get("platform") ?? "threads").trim().toLowerCase();
      const postId = url.searchParams.get("post_id");
      const limit = url.searchParams.get("limit");
      if (platform === "threads") return await listThreadsComments(env, postId, limit);
      if (platform === "twitter" || platform === "x" || platform === "twitter/x") return await listTwitterComments(env, postId, limit);
      if (platform === "reddit") return await listRedditComments(env, postId, limit);
      return json({ error: "Unsupported social platform." }, { status: 400 });
    }

    if (url.pathname === "/api/internal/social/reply-suggestion" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await suggestSocialReply(env, request);
    }

    if (url.pathname === "/api/internal/social/twitter/replies" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createTwitterReply(env, request);
    }

    if (url.pathname === "/api/internal/social/reddit/replies" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createRedditReply(env, request);
    }

    if (url.pathname.startsWith("/api/internal/social/posts/") && request.method === "PUT") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await updateSocialPost(env, id, request);
    }

    if (url.pathname.startsWith("/api/internal/social/posts/") && request.method === "DELETE") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await deleteSocialPost(env, id);
    }

    if (url.pathname === "/api/internal/social/threads/search" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await searchThreads(env, url);
    }

    if (url.pathname === "/api/internal/social/threads/accounts" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listThreadsAccounts(env);
    }

    if (url.pathname === "/api/internal/social/threads/replies" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listThreadsReplies(env, url);
    }

    if (url.pathname === "/api/internal/social/threads/replies" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createThreadsReply(env, request);
    }

    if (url.pathname === "/api/internal/social/threads/campaign-results" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listThreadsCampaignResults(env, url);
    }

    if (url.pathname === "/api/internal/social/threads/campaign-results" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await upsertThreadsCampaignResults(env, request);
    }

    if (url.pathname === "/api/internal/studio/crawler-runs" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listStudioCrawlerRuns(env, url, null);
    }

    if (url.pathname.startsWith("/api/internal/studio/crawler-runs/") && request.method === "PUT") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await updateStudioCrawlerRun(env, id, request, null);
    }

    if (url.pathname === "/api/internal/studio/signals" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listStudioSignals(env, url, null);
    }

    if (url.pathname === "/api/internal/studio/signals/bulk" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createStudioSignals(env, request, null);
    }

    if (url.pathname === "/api/internal/studio/strategist-posts/bulk" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createStudioStrategistPosts(env, request, null);
    }

    if (url.pathname === "/api/internal/studio/notifications" && request.method === "GET") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listStudioNotifications(env, url, null);
    }

    if (url.pathname.startsWith("/api/internal/studio/notifications/") && request.method === "PUT") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await updateStudioNotification(env, id, request);
    }

    if (url.pathname === "/api/internal/settings/ctrader/complete" && request.method === "POST") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      return await completeCtraderConnectionFromAgent(env, request, url.origin);
    }

    if (url.pathname.startsWith("/api/internal/social/threads/campaign-results/") && request.method === "PUT") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[6];
      return await updateThreadsCampaignResult(env, id, request);
    }

    if (url.pathname === "/api/studio" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getStudioSummary(env, activeScopeId(user));
    }

    if (url.pathname === "/api/studio/accounts" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listStudioAccounts(env, activeScopeId(user));
    }

    if (url.pathname === "/api/studio/apps" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listStudioApps(env, activeScopeId(user));
    }

    if (url.pathname === "/api/studio/apps" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await createStudioApp(env, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/studio/apps/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await updateStudioApp(env, id, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/studio/apps/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await deleteStudioApp(env, id, activeScopeId(user));
    }

    if (url.pathname === "/api/studio/campaigns" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listStudioCampaigns(env, activeScopeId(user));
    }

    if (url.pathname === "/api/studio/campaigns" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await createStudioCampaign(env, request, activeScopeId(user), user.id);
    }

    if (url.pathname.startsWith("/api/studio/campaigns/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await updateStudioCampaign(env, id, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/studio/campaigns/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await deleteStudioCampaign(env, id, activeScopeId(user));
    }

    if (url.pathname === "/api/studio/crawler-runs" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listStudioCrawlerRuns(env, url, activeScopeId(user));
    }

    if (url.pathname === "/api/studio/crawler-runs" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await createStudioCrawlerRun(env, request, activeScopeId(user), user.id);
    }

    if (url.pathname === "/api/studio/signals" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listStudioSignals(env, url, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/studio/signals/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await deleteStudioSignal(env, id, activeScopeId(user));
    }

    if (url.pathname === "/api/studio/strategist-posts" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listStudioStrategistPosts(env, url, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/studio/strategist-posts/") && url.pathname.endsWith("/schedule") && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await scheduleStudioStrategistPost(env, id, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/studio/strategist-posts/") && url.pathname.endsWith("/unpost") && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await unpostStudioStrategistPost(env, id, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/studio/strategist-posts/") && url.pathname.endsWith("/regenerate") && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await regenerateStudioStrategistPost(env, id, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/studio/strategist-posts/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await updateStudioStrategistPost(env, id, request, activeScopeId(user));
    }

    if (url.pathname === "/api/sites" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return json(await listSites(env));
    }

    if (url.pathname === "/api/sites" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const body = await parseJson<{
        name: string;
        slug: string;
        domain: string;
        status: "active" | "inactive";
      }>(request);
      return json(await createSite(env, body), { status: 201 });
    }

    if (url.pathname.startsWith("/api/sites/") && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = Number(url.pathname.split("/").pop());
      if (!Number.isFinite(id)) return json({ error: "Invalid site id" }, { status: 400 });
      const body = await parseJson<{
        name: string;
        slug: string;
        domain: string;
        status: "active" | "inactive";
      }>(request);
      return json(await updateSite(env, id, body));
    }

    if (url.pathname.startsWith("/api/sites/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = Number(url.pathname.split("/").pop());
      if (!Number.isFinite(id)) return json({ error: "Invalid site id" }, { status: 400 });
      await deleteSite(env, id);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/articles" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return json(await listArticles(env));
    }

    if (url.pathname === "/api/articles" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return json(await saveArticle(env, await request.json()), { status: 201 });
    }

    if (url.pathname === "/api/articles/assist" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return suggestArticleField(env, request);
    }

    if (url.pathname === "/api/articles/generate-cover" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return generateArticleCover(env, request);
    }

    if (url.pathname === "/api/articles/style-content" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return styleArticleContent(env, request);
    }

    if (url.pathname.startsWith("/api/articles/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = Number(url.pathname.split("/")[3]);
      if (!id) return text("Invalid article id", 400);
      await deleteArticle(env, id);
      return new Response(null, { status: 204 });
    }

    if (url.pathname.startsWith("/api/articles/") && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = Number(url.pathname.split("/").pop());
      return json(await saveArticle(env, await request.json(), id));
    }

    if (url.pathname === "/api/categories" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return json(await listCategories(env));
    }

    if (url.pathname === "/api/categories" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const body = await parseJson<{
        name: string;
        slug: string;
        description?: string | null;
      }>(request);
      return json(await createCategory(env, { ...body, description: body.description ?? null }), { status: 201 });
    }

    if (url.pathname.startsWith("/api/categories/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = Number(url.pathname.split("/").pop());
      await deleteCategory(env, id);
      return json({ success: true });
    }

    if (url.pathname === "/api/media" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return handleMediaUpload(request, env);
    }

    if (url.pathname === "/api/settings" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return getAppSettings(env, activeScopeId(user));
    }

    if (url.pathname === "/api/settings" && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return updateAppSettings(env, request, url.origin, activeScopeId(user));
    }

    if (url.pathname === "/api/settings/sync-agent" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return syncAgentFromSettings(env, url.origin, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/media/") && (request.method === "GET" || request.method === "HEAD")) {
      const key = url.pathname.replace("/api/media/", "");
      return handleMediaFetch(env, key, request.method === "GET");
    }

    // Reddit OAuth endpoints
    if (url.pathname === "/api/reddit/auth/authorize" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await handleAuthorizeRequest(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/reddit/auth/callback" && request.method === "GET") {
      return await handleOAuthCallback(env, url, request);
    }

    // Reddit accounts endpoints
    if (url.pathname === "/api/reddit/accounts" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listRedditAccounts(env, activeScopeId(user), user.id);
    }

    if (url.pathname === "/api/reddit/subreddits" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listRedditSubscribedSubreddits(env, url, activeScopeId(user), user.id);
    }

    if (url.pathname === "/api/reddit/accounts" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await addRedditAccount(env, request, activeScopeId(user), user.id);
    }

    if (url.pathname.startsWith("/api/reddit/accounts/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await updateRedditAccount(env, id, request, activeScopeId(user), user.id);
    }

    if (url.pathname.startsWith("/api/reddit/accounts/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await deleteRedditAccount(env, id, activeScopeId(user));
    }

    // Reddit campaign endpoints
    if (url.pathname === "/api/reddit/campaigns" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listCampaigns(env, activeScopeId(user));
    }

    if (url.pathname === "/api/reddit/campaigns" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await createCampaign(env, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/reddit/campaigns/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await updateCampaign(env, id, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/reddit/campaigns/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await deleteCampaign(env, id, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/reddit/campaigns/") && url.pathname.endsWith("/stats") && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      const id = parts[4];
      return await getCampaignStats(env, id);
    }

    // Knowledge base endpoints
    if (url.pathname.startsWith("/api/knowledge-base/") && request.method === "GET" && !url.pathname.includes("/versions")) {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      const type = parts[3];
      const id = parts[4];
      return await getKnowledgeBase(env, type, id);
    }

    if (url.pathname.startsWith("/api/knowledge-base/") && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      const type = parts[3];
      const id = parts[4];
      return await saveKnowledgeBase(env, type, id, request);
    }

    if (url.pathname.startsWith("/api/knowledge-base/") && url.pathname.includes("/versions") && !url.pathname.match(/\/versions\/\d+$/)) {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      const type = parts[3];
      const id = parts[4];
      return await getVersions(env, type, id);
    }

    if (url.pathname.match(/^\/api\/knowledge-base\/[^/]+\/\d+\/versions\/\d+$/) && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const match = url.pathname.match(/^\/api\/knowledge-base\/([^/]+)\/(\d+)\/versions\/(\d+)$/);
      if (!match) {
        return text("Invalid path", 400);
      }
      const [, type, id, version] = match;
      return await getVersion(env, type, id, version);
    }

    // Trading endpoints
    if (url.pathname === "/api/trading/lean-status" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getLeanStatus(env, activeScopeId(user));
    }

    if (url.pathname === "/api/trading/learning-report" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getLearningReport(env, activeScopeId(user));
    }

    if ((url.pathname === "/api/trading/nautilus/workers" || url.pathname === "/api/trading/custom-lean/workers") && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getCustomLeanWorkers(env, activeScopeId(user));
    }

    if ((url.pathname === "/api/trading/nautilus/diagnostics" || url.pathname === "/api/trading/custom-lean/diagnostics") && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getCustomLeanDiagnostics(env, activeScopeId(user));
    }

    if ((url.pathname === "/api/trading/nautilus/settings" || url.pathname === "/api/trading/custom-lean/settings") && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getCustomLeanSettings(env, activeScopeId(user));
    }

    if ((url.pathname === "/api/trading/nautilus/settings" || url.pathname === "/api/trading/custom-lean/settings") && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await updateCustomLeanSettings(env, request, url.origin, activeScopeId(user));
    }

    if (url.pathname === "/api/trading/ml/assets" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getMlTradingAssets(env, activeScopeId(user));
    }

    if (url.pathname === "/api/trading/ml/diagnostics" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getMlTradingDiagnostics(env, activeScopeId(user));
    }

    if (url.pathname === "/api/trading/ml/settings" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await getMlTradingSettings(env, activeScopeId(user));
    }

    if (url.pathname === "/api/trading/ml/settings" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await updateMlTradingSettings(env, request, url.origin, activeScopeId(user));
    }

    if (url.pathname === "/api/trading/strategies" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listStrategies(env);
    }

    if (url.pathname === "/api/trading/strategies" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createStrategy(env, request);
    }

    if (url.pathname.startsWith("/api/trading/strategies/") && request.method === "GET" && !url.pathname.includes("/stats") && !url.pathname.includes("/executions")) {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await getStrategy(env, id);
    }

    if (url.pathname.startsWith("/api/trading/strategies/") && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await updateStrategy(env, id, request);
    }

    if (url.pathname.startsWith("/api/trading/strategies/") && url.pathname.endsWith("/activate") && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      const response = await activateStrategy(env, id);
      if (!response.ok) {
        return response;
      }
      await syncAgentFromSettings(env, url.origin);
      return response;
    }

    if (url.pathname.startsWith("/api/trading/strategies/") && url.pathname.endsWith("/deactivate") && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      const response = await deactivateStrategy(env, id);
      if (!response.ok) {
        return response;
      }
      await syncAgentFromSettings(env, url.origin);
      return response;
    }

    if (url.pathname.startsWith("/api/trading/strategies/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await deleteStrategy(env, id);
    }

    if (url.pathname.startsWith("/api/trading/strategies/") && url.pathname.endsWith("/stats") && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      const id = parts[4];
      return await getStrategyStats(env, id);
    }

    if (url.pathname.startsWith("/api/trading/strategies/") && url.pathname.endsWith("/executions") && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const parts = url.pathname.split("/");
      const id = parts[4];
      return await getStrategyExecutions(env, id);
    }

    if (url.pathname === "/api/planner/items" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listPlannerItems(env, activeScopeId(user));
    }

    if (url.pathname === "/api/planner/items" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await createPlannerItem(env, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/planner/items/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await updatePlannerItem(env, id, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/planner/items/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await deletePlannerItem(env, id, activeScopeId(user));
    }

    if (url.pathname === "/api/planner/improve-description" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await improvePlannerDescription(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/trading/notes" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listTradingNotes(env);
    }

    if (url.pathname === "/api/trading/notes" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createTradingNote(env, request);
    }

    if (url.pathname.startsWith("/api/trading/notes/") && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await updateTradingNote(env, id, request);
    }

    if (url.pathname.startsWith("/api/trading/notes/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await deleteTradingNote(env, id);
    }

    // Social posts (Twitter + Threads shared)
    if (url.pathname === "/api/social/posts" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const platform = url.searchParams.get("platform") ?? "twitter";
      return await listSocialPosts(env, platform, activeScopeId(user));
    }

    if (url.pathname === "/api/social/posts" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const body = await parseJson<{ platform: string; title?: string; subreddit?: string; content?: string; scheduled_at?: string; image_url?: string; account_id?: number | null; reply_to_id?: string | null }>(request);
      const platform = body.platform ?? "twitter";
      return await createSocialPost(env, platform, new Request(request.url, {
        method: "POST",
        body: JSON.stringify({ title: body.title, subreddit: body.subreddit, content: body.content, scheduled_at: body.scheduled_at, image_url: body.image_url, account_id: body.account_id, reply_to_id: body.reply_to_id }),
        headers: { "Content-Type": "application/json" },
      }), activeScopeId(user));
    }

    if (url.pathname === "/api/social/twitter/search" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await searchTwitterPosts(env, url);
    }

    if (url.pathname.startsWith("/api/social/posts/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      const updateRequest = request.clone();
      const payload = await parseJson<Record<string, unknown>>(request.clone());
      const linkedInEditError = await updatePublishedLinkedInPost(env, id, payload, activeScopeId(user));
      if (linkedInEditError) return linkedInEditError;
      return await updateSocialPost(env, id, updateRequest, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/social/posts/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await deleteSocialPost(env, id, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/social/posts/") && url.pathname.endsWith("/publish") && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      const post = await env.DB.prepare("SELECT platform FROM social_posts WHERE id = ?")
        .bind(id)
        .first<{ platform: string }>();
      if (!post) return json({ error: "Social post not found" }, { status: 404 });
      if (post.platform === "threads") return await publishThreadsPost(env, id, activeScopeId(user));
      if (post.platform === "twitter") return await publishTwitterPost(env, id, activeScopeId(user));
      if (post.platform === "reddit") return await publishRedditPost(env, id, activeScopeId(user), user.id);
      if (["instagram", "linkedin", "youtube"].includes(post.platform)) {
        return await publishExtraSocialPost(env, id, activeScopeId(user), user.id);
      }
      return json({ error: "Direct publishing is not available for this platform yet." }, { status: 400 });
    }

    if (url.pathname === "/api/social/comments" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const platform = (url.searchParams.get("platform") ?? "threads").trim().toLowerCase();
      const postId = url.searchParams.get("post_id");
      const limit = url.searchParams.get("limit");
      const accountId = url.searchParams.get("account_id");
      if (platform === "threads") return await listThreadsComments(env, postId, limit, activeScopeId(user), accountId);
      if (platform === "twitter" || platform === "x" || platform === "twitter/x") return await listTwitterComments(env, postId, limit, accountId, activeScopeId(user));
      if (platform === "reddit") return await listRedditComments(env, postId, limit, accountId, activeScopeId(user));
      return json({ error: "Unsupported social platform." }, { status: 400 });
    }

    if (url.pathname === "/api/social/reply-suggestion" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await suggestSocialReply(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/social/twitter/replies" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await createTwitterReply(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/social/reddit/search" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await searchRedditPosts(env, url, activeScopeId(user));
    }

    if (url.pathname === "/api/social/reddit/replies" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await createRedditReply(env, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/social/threads/posts/") && url.pathname.endsWith("/publish") && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[5];
      return await publishThreadsPost(env, id, activeScopeId(user));
    }

    if (url.pathname === "/api/social/accounts" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listExtraSocialAccounts(env, activeScopeId(user), user.id);
    }

    if (url.pathname === "/api/facebook/auth/authorize" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await authorizeFacebookAccount(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/facebook/auth/callback" && request.method === "GET") {
      return await handleFacebookOAuthCallback(env, url);
    }

    if (url.pathname === "/api/instagram/auth/authorize" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await authorizeInstagramAccount(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/instagram/auth/callback" && request.method === "GET") {
      return await handleInstagramOAuthCallback(env, url);
    }

    if (url.pathname === "/api/social/instagram/insights" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listInstagramPostInsights(env, url, activeScopeId(user));
    }

    if (url.pathname === "/api/meta/deauthorize" && request.method === "POST") {
      return await handleMetaDeauthorizeCallback(env, request);
    }

    if (url.pathname === "/api/meta/data-deletion" && request.method === "POST") {
      return await handleMetaDataDeletionRequest(env, request);
    }

    if (url.pathname === "/api/linkedin/auth/authorize" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await authorizeLinkedInAccount(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/linkedin/auth/callback" && request.method === "GET") {
      return await handleLinkedInOAuthCallback(env, url);
    }

    if (url.pathname === "/api/social/linkedin/insights" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listLinkedInPostInsights(env, url, activeScopeId(user));
    }

    if (url.pathname === "/api/social/accounts" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await addExtraSocialAccount(env, request, activeScopeId(user), user.id);
    }

    if (url.pathname.match(/^\/api\/social\/accounts\/[^/]+\/avatar$/) && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await proxySocialAccountAvatar(env, id, activeScopeId(user));
    }

    if (url.pathname.match(/^\/api\/social\/accounts\/[^/]+\/tags$/) && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await updateSocialAccountTags(env, id, request, activeScopeId(user));
    }

    if (url.pathname.startsWith("/api/social/accounts/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await updateExtraSocialAccount(env, id, request, activeScopeId(user), user.id);
    }

    if (url.pathname.startsWith("/api/social/accounts/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[4];
      return await deleteExtraSocialAccount(env, id, activeScopeId(user));
    }

    // Twitter accounts
    if (url.pathname === "/api/twitter/auth/authorize" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await authorizeTwitterAccount(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/twitter/auth/callback" && request.method === "GET") {
      return await handleTwitterOAuthCallback(env, url);
    }

    if (url.pathname === "/api/social/twitter/accounts" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listTwitterAccounts(env, activeScopeId(user), user.id);
    }

    if (url.pathname === "/api/social/twitter/accounts" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await addTwitterAccount(env, request, activeScopeId(user), user.id);
    }

    if (url.pathname.startsWith("/api/social/twitter/accounts/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[5];
      return await updateTwitterAccount(env, id, request, activeScopeId(user), user.id);
    }

    if (url.pathname.startsWith("/api/social/twitter/accounts/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[5];
      return await deleteTwitterAccount(env, id, activeScopeId(user));
    }

    if (url.pathname === "/api/social/twitter/insights" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listTwitterPostInsights(env, url, activeScopeId(user));
    }

    // Threads accounts
    if (url.pathname === "/api/threads/auth/authorize" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await authorizeThreadsAccount(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/threads/auth/callback" && request.method === "GET") {
      return await handleThreadsOAuthCallback(env, url);
    }

    if (url.pathname === "/api/social/threads/accounts" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listThreadsAccounts(env, activeScopeId(user), user.id);
    }

    if (url.pathname === "/api/social/threads/accounts" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await addThreadsAccount(env, request, activeScopeId(user), user.id);
    }

    if (url.pathname.startsWith("/api/social/threads/accounts/") && request.method === "PUT") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[5];
      return await updateThreadsAccount(env, id, request, activeScopeId(user), user.id);
    }

    if (url.pathname.startsWith("/api/social/threads/accounts/") && request.method === "DELETE") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      const id = url.pathname.split("/")[5];
      return await deleteThreadsAccount(env, id, activeScopeId(user));
    }

    if (url.pathname === "/api/social/threads/search" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await searchThreads(env, url, activeScopeId(user));
    }

    if (url.pathname === "/api/social/threads/replies" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listThreadsReplies(env, url, activeScopeId(user));
    }

    if (url.pathname === "/api/social/threads/replies" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await createThreadsReply(env, request, activeScopeId(user));
    }

    if (url.pathname === "/api/social/threads/insights" && request.method === "GET") {
      const user = await requireUser(request, env);
      if (isAuthResponse(user)) return user;
      return await listThreadsPostInsights(env, url, activeScopeId(user));
    }

    if (url.pathname === "/api/social/threads/campaign-results" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listThreadsCampaignResults(env, url);
    }

    if (url.pathname.startsWith("/api/social/threads/campaign-results/") && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await updateThreadsCampaignResult(env, id, request);
    }

    if (url.pathname === "/api/stats/journl" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const serviceRoleKey = env.JOURNL_SERVICE_ROLE_KEY;
      if (!serviceRoleKey) {
        return json({ error: "JOURNL_SERVICE_ROLE_KEY not configured" }, { status: 503 });
      }
      const res = await fetch(
        "https://lgzikhbuutggpkdxalfk.supabase.co/rest/v1/rpc/get_journl_stats",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceRoleKey,
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const msg = await res.text();
        return json({ error: `Supabase error: ${msg}` }, { status: 502 });
      }
      return json(await res.json());
    }

      return env.ASSETS.fetch(request);
    } catch (err: any) {
      console.error(err);
      const msg = String(err?.message || err);
      if (msg.includes("UNIQUE constraint failed")) {
        return new Response("An article with this slug already exists", { status: 400 });
      }
      return new Response(msg || "Internal Server Error", { status: 500 });
    }
  },
};
