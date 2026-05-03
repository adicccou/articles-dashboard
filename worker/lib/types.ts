export type Env = {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  REDDIT_REDIRECT_URI?: string;
  CLAUDE_API_KEY?: string;
  CLAUDE_MODEL?: string;
  TRADING_AGENT_SYNC_SECRET?: string;
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
  category_id: number | null;
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

export type ArticleCategory = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type ArticleWithRelations = ArticleRow & {
  site_ids: number[];
  category?: ArticleCategory;
  seo: {
    meta_title: string;
    meta_description: string;
    og_image: string;
    canonical_url: string;
  };
};
