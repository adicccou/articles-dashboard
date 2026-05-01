export type Env = {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
};

export type SiteRow = {
  id: number;
  name: string;
  slug: string;
  domain: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

export type ArticleRow = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image: string | null;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ArticleSeoRow = {
  article_id: number;
  meta_title: string;
  meta_description: string;
  og_image: string;
  canonical_url: string;
};

export type ArticleWithRelations = ArticleRow & {
  site_ids: number[];
  seo: {
    meta_title: string;
    meta_description: string;
    og_image: string;
    canonical_url: string;
  };
};
