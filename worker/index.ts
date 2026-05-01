import { checkCredentials, clearSessionCookie, createSessionCookie, validateSession } from "./lib/auth";
import { createSite, getPublishedArticleBySlug, getPublishedArticlesForSite, listArticles, listSites, saveArticle } from "./lib/db";
import { json, parseJson, text } from "./lib/http";
import type { Env } from "./lib/types";

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

    if (url.pathname === "/api/media" && request.method === "POST") {
      const unauthorized = await requireAuth(request, env);
      if (unauthorized) return unauthorized;
      return handleMediaUpload(request, env);
    }

    if (url.pathname.startsWith("/api/media/") && request.method === "GET") {
      const key = url.pathname.replace("/api/media/", "");
      return handleMediaFetch(env, key);
    }

    return env.ASSETS.fetch(request);
  },
};
