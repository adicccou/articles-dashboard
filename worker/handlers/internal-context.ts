import { listArticles, listCategories, listSites } from "../lib/db";
import { json } from "../lib/http";
import { DEFAULT_USER_ID } from "../lib/ownership";
import type { Env } from "../lib/types";
import { readAccountTags } from "../lib/account-tags";
import { plannerHasSocialPostLinks } from "./planner";
import { listRedditSubscribedSubreddits } from "./reddit";
import { listInternalRedditAccounts } from "./reddit-auth";
import { listInternalExtraSocialAccounts } from "./social-accounts";
import { fetchThreadsRepliesData } from "./threads";
import { getSocialPostSchemaCapabilities } from "./twitter";

export function buildDefaultCanonicalUrl(
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

function parseStringArray(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

export async function handleInternalContext(env: Env) {
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
