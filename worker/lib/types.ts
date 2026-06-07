export type Env = {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_USERNAME: string;
  DASHBOARD_SURFACE?: "articles" | "marketing" | "trading";
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  DASHBOARD_OWNER_EMAIL?: string;
  GOOGLE_ALLOWED_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  OILOR_AI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  AI_API_KEY?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
  TWITTER_API_KEY?: string;
  TWITTER_API_SECRET?: string;
  TWITTER_REDIRECT_URI?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  REDDIT_REDIRECT_URI?: string;
  REDDIT_SCOPES?: string;
  THREADS_CLIENT_ID?: string;
  THREADS_CLIENT_SECRET?: string;
  THREADS_REDIRECT_URI?: string;
  THREADS_SCOPES?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  FACEBOOK_REDIRECT_URI?: string;
  FACEBOOK_SCOPES?: string;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  INSTAGRAM_REDIRECT_URI?: string;
  INSTAGRAM_OAUTH_SCOPES?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_REDIRECT_URI?: string;
  LINKEDIN_SCOPES?: string;
  LINKEDIN_VERSION?: string;
  DASHBOARD_API_URL?: string;
  MCP_CONNECTOR_TOKEN?: string;
  TRADING_AGENT_SYNC_SECRET?: string;
  JOURNL_SERVICE_ROLE_KEY?: string;
};

export type JournlStats = {
  total_accounts: number;
  subscriptions: number;
  pro: number;
  lifetime: number;
  free: number;
  cancelled: number;
  active_7d: number;
  active_30d: number;
  new_7d: number;
  new_30d: number;
  plan_breakdown: JournlBreakdownItem[];
  provider_breakdown: JournlBreakdownItem[];
  activity_breakdown: JournlBreakdownItem[];
};

export type JournlBreakdownItem = {
  key: string;
  label: string;
  count: number;
  share: number;
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
