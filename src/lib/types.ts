export type AuthState = {
  authenticated: boolean;
  username?: string;
};

export type Site = {
  id: number;
  name: string;
  slug: string;
  domain: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

export type ArticleCategory = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  created_at: string;
  updated_at: string;
};

export type ArticleRecord = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image: string | null;
  status: "draft" | "published";
  published_at: string | null;
  category_id?: number | null;
  category?: ArticleCategory;
  created_at: string;
  updated_at: string;
  site_ids: number[];
  seo: {
    meta_title: string;
    meta_description: string;
    og_image: string;
    canonical_url: string;
  };
};

export type DashboardBootstrap = {
  auth: AuthState;
  sites: Site[];
  articles: ArticleRecord[];
};

export type ArticleInput = {
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

export type RedditAccount = {
  id: number;
  name: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

export type RedditCampaign = {
  id: number;
  reddit_account_id: number;
  name: string;
  description?: string;
  subreddit: string;
  search_query: string;
  search_criteria: Record<string, unknown>;
  agent_instructions: string;
  status: "active" | "inactive" | "paused";
  approval_method: "batch" | "immediate";
  batch_size: number;
  batch_window_hours: number;
  throttle_enabled: boolean;
  throttle_interval_minutes: number;
  telegram_chat_id?: string;
  created_at: string;
  updated_at: string;
};

export type RedditComment = {
  id: number;
  campaign_id: number;
  reddit_comment_id: string;
  subreddit: string;
  post_id: string;
  author: string;
  content: string;
  score: number;
  found_at: string;
  processed_at?: string;
  status: "pending" | "approved" | "rejected" | "replied" | "failed";
  batch_id?: number;
  created_at: string;
  updated_at: string;
};

export type RedditReplyDraft = {
  id: number;
  comment_id: number;
  content: string;
  generated_at: string;
  approved_at?: string;
  sent_at?: string;
  reddit_reply_id?: string;
  approval_status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
};

export type KnowledgeBase = {
  id?: number | null;
  entity_type?: "reddit_campaign" | "trading_strategy";
  entity_id?: number;
  title: string;
  content: string;
  version?: number;
  created_at?: string;
  updated_at?: string;
};

export type KnowledgeBaseVersion = {
  id: number;
  knowledge_base_id: number;
  version: number;
  content: string;
  change_summary?: string;
  created_at: string;
};

export type TradingStrategy = {
  id: number;
  name: string;
  description?: string;
  knowledge_base_id?: number | null;
  ctrader_login: string;
  ctrader_password: string;
  ctrader_account_id: string;
  ctrader_server?: string;
  symbol: string;
  strategy_type: "scalping" | "daytrading" | "swing" | "position";
  lot_size: number;
  stop_loss_pips?: number | null;
  take_profit_pips?: number | null;
  max_open_positions: number;
  claude_instructions?: string;
  telegram_chat_id?: string;
  status: "active" | "inactive" | "paused" | "testing";
  created_at: string;
  updated_at: string;
};

export type TradingExecution = {
  id: number;
  strategy_id: number;
  ticket_id?: string;
  symbol: string;
  volume: number;
  entry_price: number;
  entry_time: string;
  exit_price?: number | null;
  exit_time?: string | null;
  pips_profit_loss?: number | null;
  status: "open" | "closed" | "cancelled";
  created_at: string;
  updated_at: string;
};

export type TradingStats = {
  id?: number;
  strategy_id: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pips: number;
  avg_pips_per_trade: number;
  max_consecutive_wins: number;
  max_consecutive_losses: number;
  largest_win_pips: number;
  largest_loss_pips: number;
  updated_at: string;
};
