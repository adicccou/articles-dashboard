import type { ArticleRow, ArticleSeoRow, ArticleWithRelations, Env, SiteRow, ArticleCategory } from "./types";

type ArticlePayload = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image: string | null;
  status: "draft" | "published";
  published_at: string | null;
  category_id?: number | null;
  site_ids: number[];
  seo: {
    meta_title: string;
    meta_description: string;
    og_image: string;
    canonical_url: string;
  };
};

export async function listSites(env: Env): Promise<SiteRow[]> {
  const result = await env.DB.prepare(
    "SELECT id, name, slug, domain, status, created_at, updated_at FROM sites ORDER BY name ASC",
  ).all<SiteRow>();
  return result.results;
}

export async function createSite(
  env: Env,
  payload: Pick<SiteRow, "name" | "slug" | "domain" | "status">,
): Promise<SiteRow> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `
      INSERT INTO sites (name, slug, domain, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id, name, slug, domain, status, created_at, updated_at
    `,
  )
    .bind(payload.name, payload.slug, payload.domain, payload.status, now, now)
    .first<SiteRow>();

  if (!result) {
    throw new Error("Failed to create site");
  }

  return result;
}

export async function updateSite(
  env: Env,
  siteId: number,
  payload: Pick<SiteRow, "name" | "slug" | "domain" | "status">,
): Promise<SiteRow> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `
      UPDATE sites
      SET name = ?, slug = ?, domain = ?, status = ?, updated_at = ?
      WHERE id = ?
      RETURNING id, name, slug, domain, status, created_at, updated_at
    `,
  )
    .bind(payload.name, payload.slug, payload.domain, payload.status, now, siteId)
    .first<SiteRow>();

  if (!result) {
    throw new Error("Failed to update site");
  }

  return result;
}

export async function deleteSite(env: Env, siteId: number): Promise<void> {
  await env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(siteId).run();
}

export async function listCategories(env: Env): Promise<ArticleCategory[]> {
  const result = await env.DB.prepare(
    `
      SELECT id, name, slug, description, created_at, updated_at
      FROM article_categories
      ORDER BY name ASC
    `,
  ).all<ArticleCategory>();
  return result.results;
}

export async function createCategory(
  env: Env,
  payload: Pick<ArticleCategory, "name" | "slug" | "description">,
): Promise<ArticleCategory> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `
      INSERT INTO article_categories (name, slug, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, name, slug, description, created_at, updated_at
    `,
  )
    .bind(payload.name, payload.slug, payload.description, now, now)
    .first<ArticleCategory>();

  if (!result) {
    throw new Error("Failed to create category");
  }

  return result;
}

export async function deleteCategory(env: Env, categoryId: number): Promise<void> {
  await env.DB.prepare("DELETE FROM article_categories WHERE id = ?").bind(categoryId).run();
}

export async function listArticles(env: Env): Promise<ArticleWithRelations[]> {
  const articles = await env.DB.prepare(
    `
      SELECT id, title, slug, excerpt, content, cover_image, status, published_at, category_id, created_at, updated_at
      FROM articles
      ORDER BY updated_at DESC
    `,
  ).all<ArticleRow>();

  const siteLinks = await env.DB.prepare(
    "SELECT article_id, site_id FROM article_sites ORDER BY article_id ASC",
  ).all<{ article_id: number; site_id: number }>();

  const seoRows = await env.DB.prepare(
    `
      SELECT article_id, meta_title, meta_description, og_image, canonical_url
      FROM article_seo
    `,
  ).all<ArticleSeoRow>();

  const categoryIds = articles.results
    .map((a) => a.category_id)
    .filter((id): id is number => id !== null && id !== undefined);

  const categories = categoryIds.length > 0
    ? await env.DB.prepare(
        `
          SELECT id, name, slug, description, created_at, updated_at
          FROM article_categories
          WHERE id IN (${categoryIds.map(() => "?").join(",")})
        `,
      )
        .bind(...categoryIds)
        .all<ArticleCategory>()
    : { results: [] };

  const sitesByArticle = new Map<number, number[]>();
  for (const row of siteLinks.results) {
    const list = sitesByArticle.get(row.article_id) ?? [];
    list.push(row.site_id);
    sitesByArticle.set(row.article_id, list);
  }

  const seoByArticle = new Map<number, ArticleSeoRow>(
    seoRows.results.map((row: ArticleSeoRow) => [row.article_id, row]),
  );

  const categoryById = new Map<number, ArticleCategory>(
    categories.results.map((cat: ArticleCategory) => [cat.id, cat]),
  );

  return articles.results.map((article: ArticleRow) => ({
    ...article,
    site_ids: sitesByArticle.get(article.id) ?? [],
    category: article.category_id ? categoryById.get(article.category_id) : undefined,
    seo: seoByArticle.get(article.id) ?? {
      meta_title: "",
      meta_description: "",
      og_image: "",
      canonical_url: "",
    },
  }));
}

export async function saveArticle(
  env: Env,
  payload: ArticlePayload,
  articleId?: number,
): Promise<ArticleWithRelations> {
  const now = new Date().toISOString();
  const publishedAt = payload.status === "published"
    ? payload.published_at ?? now
    : payload.published_at ?? null;

  let id = articleId;

  if (id) {
    await env.DB.prepare(
      `
        UPDATE articles
        SET title = ?, slug = ?, excerpt = ?, content = ?, cover_image = ?, status = ?, published_at = ?, category_id = ?, updated_at = ?
        WHERE id = ?
      `,
    )
      .bind(
        payload.title,
        payload.slug,
        payload.excerpt,
        payload.content,
        payload.cover_image,
        payload.status,
        publishedAt,
        payload.category_id ?? null,
        now,
        id,
      )
      .run();
  } else {
    const inserted = await env.DB.prepare(
      `
        INSERT INTO articles (title, slug, excerpt, content, cover_image, status, published_at, category_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `,
    )
      .bind(
        payload.title,
        payload.slug,
        payload.excerpt,
        payload.content,
        payload.cover_image,
        payload.status,
        publishedAt,
        payload.category_id ?? null,
        now,
        now,
      )
      .first<{ id: number }>();

    id = inserted?.id;
  }

  if (!id) {
    throw new Error("Failed to save article");
  }

  await env.DB.prepare("DELETE FROM article_sites WHERE article_id = ?").bind(id).run();
  for (const siteId of payload.site_ids) {
    await env.DB.prepare("INSERT INTO article_sites (article_id, site_id) VALUES (?, ?)")
      .bind(id, siteId)
      .run();
  }

  await env.DB.prepare(
    `
      INSERT INTO article_seo (article_id, meta_title, meta_description, og_image, canonical_url)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(article_id) DO UPDATE SET
        meta_title = excluded.meta_title,
        meta_description = excluded.meta_description,
        og_image = excluded.og_image,
        canonical_url = excluded.canonical_url
    `,
  )
    .bind(
      id,
      payload.seo.meta_title,
      payload.seo.meta_description,
      payload.seo.og_image,
      payload.seo.canonical_url,
    )
    .run();

  const articles = await listArticles(env);
  const article = articles.find((entry: ArticleWithRelations) => entry.id === id);
  if (!article) {
    throw new Error("Article saved but could not be reloaded");
  }
  return article;
}

export async function deleteArticle(env: Env, id: number): Promise<void> {
  await env.DB.prepare("DELETE FROM article_sites WHERE article_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM article_seo WHERE article_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM articles WHERE id = ?").bind(id).run();
}

export async function getPublishedArticlesForSite(env: Env, siteSlug: string) {
  const now = new Date().toISOString();
  const results = await env.DB.prepare(
    `
      SELECT
        a.id,
        a.title,
        a.slug,
        a.excerpt,
        a.content,
        a.cover_image,
        a.published_at,
        seo.meta_title,
        seo.meta_description,
        seo.og_image,
        seo.canonical_url,
        s.slug AS site_slug
      FROM articles a
      INNER JOIN article_sites aps ON aps.article_id = a.id
      INNER JOIN sites s ON s.id = aps.site_id
      LEFT JOIN article_seo seo ON seo.article_id = a.id
      WHERE s.slug = ? AND a.status = 'published' AND (a.published_at IS NULL OR a.published_at <= ?)
      ORDER BY COALESCE(a.published_at, a.updated_at) DESC
    `,
  )
    .bind(siteSlug, now)
    .all();

  return results.results;
}

export async function getPublishedArticleBySlug(env: Env, siteSlug: string, articleSlug: string) {
  const now = new Date().toISOString();
  return env.DB.prepare(
    `
      SELECT
        a.id,
        a.title,
        a.slug,
        a.excerpt,
        a.content,
        a.cover_image,
        a.published_at,
        seo.meta_title,
        seo.meta_description,
        seo.og_image,
        seo.canonical_url,
        s.slug AS site_slug
      FROM articles a
      INNER JOIN article_sites aps ON aps.article_id = a.id
      INNER JOIN sites s ON s.id = aps.site_id
      LEFT JOIN article_seo seo ON seo.article_id = a.id
      WHERE s.slug = ? AND a.slug = ? AND a.status = 'published' AND (a.published_at IS NULL OR a.published_at <= ?)
      LIMIT 1
    `,
  )
    .bind(siteSlug, articleSlug, now)
    .first();
}
