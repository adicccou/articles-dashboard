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
  start_at?: string | null;
  end_at?: string | null;
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
  entity_type?: "reddit_campaign" | "trading_strategy" | "social_platform" | "global";
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

export type TradingHoursWindow = {
  days: string[];   // e.g. ["Mon","Tue","Wed","Thu","Fri"]
  from: string;     // "08:00"
  to: string;       // "17:00"
};

export type TradingStrategy = {
  id: number;
  name: string;
  knowledge_base_id?: number | null;
  strategy_text: string;
  assets: string[];
  daily_max_trade_signals: number;
  strategy_type: "scalping" | "daytrading" | "swing" | "position";
  risk_usd_min: number;
  risk_usd_max: number;
  rr_min: number;
  rr_max: number;
  breakeven_rr: number;
  max_open_positions: number;
  execution_mode: "demo" | "live";
  trading_hours: TradingHoursWindow[];   // [] = send anytime
  parsed_strategy?: {
    hard_rules: {
      bias_timeframe: string;
      entry_timeframe: string;
      required_sessions: string[];
      must_have_confirmations: string[];
      invalidations: string[];
    };
    soft_preferences: {
      favored_assets: string[];
      minimum_rr: number;
    };
    understanding_summary: string;
  } | null;
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

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantContext = {
  overview: {
    total_sites: number;
    total_articles: number;
    draft_articles: number;
    published_articles: number;
    reddit_campaigns: number;
    active_reddit_campaigns: number;
    trading_strategies: number;
    active_trading_strategies: number;
    total_closed_trades: number;
    total_open_trades: number;
  };
  recent_articles: Array<{
    title: string;
    status: string;
    updated_at: string;
  }>;
  reddit_campaigns: Array<{
    name: string;
    subreddit: string;
    status: string;
    approval_method: string;
  }>;
  trading_strategies: Array<{
    name: string;
    assets: string[];
    strategy_type: string;
    status: string;
    total_trades: number;
    win_rate: number;
    total_pips: number;
  }>;
  planner_items: Array<{
    id: number;
    title: string;
    platform: string;
    status: string;
    scheduled_for: string | null;
  }>;
  trading_notes: Array<{
    id: number;
    title: string;
    note_type: string;
    strategy_name: string | null;
    created_at: string;
  }>;
};

export type AssistantChatResponse = {
  message: string;
  context: AssistantContext;
  action_results?: Array<{
    type: string;
    count?: number;
    ids?: number[];
    message: string;
  }>;
};

export type AppSettings = {
  ai_api_connected: boolean;
  gemini_api_connected?: boolean;
  gemini_flash_model?: string;
  gemini_pro_model?: string;
  global_ai_rules: string;
  social_agent_rules: string;
  workspace_timezone: string;
  trading_agent_url: string;
  trading_agent_connected: boolean;
  trading_agent_token_saved?: boolean;
  ctrader_client_id: string;
  ctrader_account_id: string;
  ctrader_demo_account_id: string;
  ctrader_live_account_id: string;
  ctrader_connected: boolean;
  ctrader_client_secret_saved?: boolean;
  ctrader_access_token_saved?: boolean;
  // Twitter/X
  twitter_api_key_saved?: boolean;
  twitter_api_secret_saved?: boolean;
  twitter_access_token_saved?: boolean;
  twitter_access_secret_saved?: boolean;
  twitter_connected?: boolean;
  // Threads
  threads_access_token_saved?: boolean;
  threads_user_id?: string;
  threads_connected?: boolean;
  updated_at?: string | null;
  sync_result?: {
    ok: boolean;
    message: string;
  } | null;
};

export type AppSettingsInput = {
  gemini_api_key?: string;
  gemini_flash_model?: string;
  gemini_pro_model?: string;
  global_ai_rules?: string;
  social_agent_rules?: string;
  workspace_timezone?: string;
  trading_agent_url?: string;
  trading_agent_token?: string;
  ctrader_client_id?: string;
  ctrader_client_secret?: string;
  ctrader_access_token?: string;
  ctrader_account_id?: string;
  ctrader_demo_account_id?: string;
  ctrader_live_account_id?: string;
  // Twitter/X
  twitter_api_key?: string;
  twitter_api_secret?: string;
  twitter_access_token?: string;
  twitter_access_secret?: string;
  // Threads
  threads_access_token?: string;
  threads_user_id?: string;
};

export type PlannerItem = {
  id: number;
  title: string;
  description?: string | null;
  image_url?: string | null;
  item_type: "post" | "campaign";
  platform: string;
  status: "planned" | "drafting" | "approved" | "published" | "archived";
  scheduled_for?: string | null;
  social_post_id?: number | null;
  account_id?: number | null;
  instruction?: string | null;
  interval_minutes?: number | null;
  duration_start?: string | null;
  duration_end?: string | null;
  related_strategy_id?: number | null;
  related_strategy_name?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type TradingNote = {
  id: number;
  strategy_id?: number | null;
  strategy_name?: string | null;
  title: string;
  content: string;
  note_type: "analysis" | "idea" | "review" | "risk";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PlannerItemInput = {
  title: string;
  description?: string | null;
  item_type?: "post" | "campaign";
  platform: string;
  status?: "planned" | "drafting" | "approved" | "published" | "archived";
  scheduled_for?: string | null;
  social_post_id?: number | null;
  account_id?: number | null;
  instruction?: string | null;
  interval_minutes?: number | null;
  duration_start?: string | null;
  duration_end?: string | null;
  related_strategy_id?: number | null;
};

export type TradingNoteInput = {
  strategy_id?: number | null;
  title: string;
  content: string;
  note_type?: "analysis" | "idea" | "review" | "risk";
};

// ------------------------------------------------------------------ Social Media

export type SocialAccount = {
  id: number;
  platform: "twitter" | "threads" | "reddit";
  username: string;
  status: "active" | "inactive";
  credentials_ready?: boolean | number;
  created_at: string;
  updated_at: string;
};

export type SocialAccountInput = {
  username?: string;
  [key: string]: string | undefined;
};

export type SocialPost = {
  id: number;
  platform: "twitter" | "threads" | "reddit";
  title?: string | null;
  subreddit?: string | null;
  account_id?: number | null;
  reply_to_id?: string | null;
  content: string;
  image_url?: string | null;
  status: "draft" | "approved" | "scheduled" | "posted" | "failed";
  scheduled_at: string | null;
  posted_at: string | null;
  external_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ThreadsMedia = {
  id: string;
  media_product_type?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  username?: string;
  text?: string;
  timestamp?: string;
  shortcode?: string;
  thumbnail_url?: string;
  has_replies?: boolean;
  is_quote_post?: boolean;
  root_post?: { id: string };
  replied_to?: { id: string };
  is_reply?: boolean;
  is_reply_owned_by_me?: boolean;
  reply_audience?: string;
};

export type ThreadsMediaResponse = {
  data?: ThreadsMedia[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
  };
};

export type ThreadsCampaignResult = {
  id: number;
  campaign_id: number;
  account_id?: number | null;
  campaign_title?: string | null;
  search_query: string;
  media_id: string;
  username?: string | null;
  media_text?: string | null;
  permalink?: string | null;
  media_type?: string | null;
  published_at?: string | null;
  review_status: "new" | "reviewed" | "dismissed" | "replied" | "drafted";
  suggested_reply?: string | null;
  suggested_post?: string | null;
  suggestion_reason?: string | null;
  created_at: string;
  updated_at: string;
};
