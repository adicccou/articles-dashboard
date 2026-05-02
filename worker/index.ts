import { checkCredentials, clearSessionCookie, createSessionCookie, validateSession } from "./lib/auth";
import { createSite, getPublishedArticleBySlug, getPublishedArticlesForSite, listArticles, listSites, saveArticle, listCategories, createCategory, deleteCategory } from "./lib/db";
import { json, parseJson, text } from "./lib/http";
import type { Env } from "./lib/types";
import { listCampaigns, createCampaign, updateCampaign, deleteCampaign, getCampaignStats } from "./handlers/reddit";
import { handleAuthorizeRequest, handleOAuthCallback, listRedditAccounts, deleteRedditAccount } from "./handlers/reddit-auth";
import { getKnowledgeBase, saveKnowledgeBase, getVersions, getVersion } from "./handlers/knowledge-base";
import { listStrategies, getStrategy, createStrategy, updateStrategy, deleteStrategy, getStrategyStats, getStrategyExecutions } from "./handlers/trading";

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
  const body = await parseJson<{ username: string; password: string }>(request);
  const valid = await checkCredentials(body.username, body.password, env);
  if (!valid) {
    return text("Invalid credentials", 401);
  }

  return json(
    { authenticated: true, username: body.username },
    {
      headers: {
        "Set-Cookie": await createSessionCookie(body.username, env),
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
      return withCors(json({ data: await getPublishedArticlesForSite(env, site) }));
    }

    if (url.pathname.startsWith("/api/public/articles/") && request.method === "GET") {
      const site = url.searchParams.get("site");
      const slug = url.pathname.split("/").pop();
      if (!site || !slug) {
        return withCors(text("Missing site or slug", 400));
      }
      const article = await getPublishedArticleBySlug(env, site, slug);
      if (!article) {
        return withCors(text("Article not found", 404));
      }
      return withCors(json({ data: article }));
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

    return env.ASSETS.fetch(request);
  },
};
