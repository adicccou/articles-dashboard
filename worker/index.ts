import { checkCredentials, clearSessionCookie, createSessionCookie, validateSession } from "./lib/auth";
import { createSite, getPublishedArticleBySlug, getPublishedArticlesForSite, listArticles, listSites, saveArticle, deleteArticle, listCategories, createCategory, deleteCategory } from "./lib/db";
import { json, parseJson, text } from "./lib/http";
import type { Env } from "./lib/types";
import { listCampaigns, createCampaign, updateCampaign, deleteCampaign, getCampaignStats } from "./handlers/reddit";
import { handleAuthorizeRequest, handleOAuthCallback, listRedditAccounts, deleteRedditAccount } from "./handlers/reddit-auth";
import { getKnowledgeBase, saveKnowledgeBase, getVersions, getVersion } from "./handlers/knowledge-base";
import { listStrategies, getStrategy, createStrategy, updateStrategy, deleteStrategy, getStrategyStats, getStrategyExecutions } from "./handlers/trading";
import { chatWithAssistant } from "./handlers/assistant";
import { getAppSettings, syncAgentFromSettings, updateAppSettings } from "./handlers/settings";
import {
  listPlannerItems,
  createPlannerItem,
  updatePlannerItem,
  deletePlannerItem,
  listTradingNotes,
  createTradingNote,
  updateTradingNote,
  deleteTradingNote,
} from "./handlers/planner";
import {
  listSocialPosts,
  createSocialPost,
  updateSocialPost,
  deleteSocialPost,
  listTwitterAccounts,
  addTwitterAccount,
  deleteTwitterAccount,
} from "./handlers/twitter";
import {
  listThreadsAccounts,
  addThreadsAccount,
  deleteThreadsAccount,
} from "./handlers/threads";

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  const authenticated = await validateSession(request, env);
  if (!authenticated) {
    return text("Unauthorized", 401);
  }
  return null;
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

async function handleInternalContext(env: Env) {
  const [sites, categories, articles] = await Promise.all([
    listSites(env),
    listCategories(env),
    listArticles(env),
  ]);

  return json({
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
  });
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
  const authenticated = await validateSession(request, env);
  return json({
    auth: authenticated
      ? { authenticated: true, username: env.ADMIN_USERNAME }
      : { authenticated: false },
    sites: authenticated ? await listSites(env) : [],
    articles: authenticated ? await listArticles(env) : [],
  });
}

async function handleLogin(request: Request, env: Env) {
  const body = await parseJson<{ username: string; password: string; remember?: boolean }>(request);
  const valid = await checkCredentials(body.username, body.password, env);
  if (!valid) {
    return text("Invalid credentials", 401);
  }

  return json(
    { authenticated: true, username: body.username },
    {
      headers: {
        "Set-Cookie": await createSessionCookie(body.username, env, body.remember !== false),
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

async function handleMediaFetch(env: Env, key: string) {
  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) {
    return text("File not found", 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/api/bootstrap" && request.method === "GET") {
      return handleBootstrap(request, env);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return handleLogin(request, env);
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

    if (url.pathname.startsWith("/api/internal/articles/") && request.method === "PATCH") {
      const unauthorized = await requireAgentAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = Number(url.pathname.split("/").pop());
      if (!id) return text("Invalid article id", 400);
      return handleInternalArticlePatch(request, env, id);
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
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return getAppSettings(env);
    }

    if (url.pathname === "/api/settings" && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return updateAppSettings(env, request, url.origin);
    }

    if (url.pathname === "/api/settings/sync-agent" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return syncAgentFromSettings(env, url.origin);
    }

    if (url.pathname.startsWith("/api/media/") && request.method === "GET") {
      const key = url.pathname.replace("/api/media/", "");
      return handleMediaFetch(env, key);
    }

    // Reddit OAuth endpoints
    if (url.pathname === "/api/reddit/auth/authorize" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await handleAuthorizeRequest(env, request);
    }

    if (url.pathname === "/api/reddit/auth/callback" && request.method === "GET") {
      return await handleOAuthCallback(env, url, request);
    }

    // Reddit accounts endpoints
    if (url.pathname === "/api/reddit/accounts" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listRedditAccounts(env);
    }

    if (url.pathname.startsWith("/api/reddit/accounts/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await deleteRedditAccount(env, id);
    }

    // Reddit campaign endpoints
    if (url.pathname === "/api/reddit/campaigns" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return json(await listCampaigns(env));
    }

    if (url.pathname === "/api/reddit/campaigns" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createCampaign(env, request);
    }

    if (url.pathname.startsWith("/api/reddit/campaigns/") && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await updateCampaign(env, id, request);
    }

    if (url.pathname.startsWith("/api/reddit/campaigns/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await deleteCampaign(env, id);
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
    if (url.pathname === "/api/trading/strategies" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return json(await listStrategies(env));
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

    if (url.pathname === "/api/assistant/chat" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await chatWithAssistant(env, request);
    }

    if (url.pathname === "/api/planner/items" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listPlannerItems(env);
    }

    if (url.pathname === "/api/planner/items" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await createPlannerItem(env, request);
    }

    if (url.pathname.startsWith("/api/planner/items/") && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await updatePlannerItem(env, id, request);
    }

    if (url.pathname.startsWith("/api/planner/items/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await deletePlannerItem(env, id);
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
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const platform = url.searchParams.get("platform") ?? "twitter";
      return await listSocialPosts(env, platform);
    }

    if (url.pathname === "/api/social/posts" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const body = await parseJson<{ platform: string; content: string; scheduled_at?: string }>(request);
      const platform = body.platform ?? "twitter";
      return await createSocialPost(env, platform, new Request(request.url, {
        method: "POST",
        body: JSON.stringify({ content: body.content, scheduled_at: body.scheduled_at }),
        headers: { "Content-Type": "application/json" },
      }));
    }

    if (url.pathname.startsWith("/api/social/posts/") && request.method === "PUT") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await updateSocialPost(env, id, request);
    }

    if (url.pathname.startsWith("/api/social/posts/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[4];
      return await deleteSocialPost(env, id);
    }

    // Twitter accounts
    if (url.pathname === "/api/social/twitter/accounts" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listTwitterAccounts(env);
    }

    if (url.pathname === "/api/social/twitter/accounts" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await addTwitterAccount(env, request);
    }

    if (url.pathname.startsWith("/api/social/twitter/accounts/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await deleteTwitterAccount(env, id);
    }

    // Threads accounts
    if (url.pathname === "/api/social/threads/accounts" && request.method === "GET") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await listThreadsAccounts(env);
    }

    if (url.pathname === "/api/social/threads/accounts" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return await addThreadsAccount(env, request);
    }

    if (url.pathname.startsWith("/api/social/threads/accounts/") && request.method === "DELETE") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      const id = url.pathname.split("/")[5];
      return await deleteThreadsAccount(env, id);
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
