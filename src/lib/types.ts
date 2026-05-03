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
  telegram_bot_token?: string;
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
    symbol: string;
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
  claude_model: string;
  trading_agent_url: string;
  trading_agent_connected: boolean;
  trading_agent_token_saved?: boolean;
  updated_at?: string | null;
  sync_result?: {
    ok: boolean;
    message: string;
  } | null;
};

export type AppSettingsInput = {
  anthropic_api_key?: string;
  claude_model?: string;
  trading_agent_url?: string;
  trading_agent_token?: string;
};

export type PlannerItem = {
  id: number;
  title: string;
  description?: string | null;
  item_type: "post" | "campaign";
  platform: string;
  status: "planned" | "drafting" | "approved" | "published" | "archived";
  scheduled_for?: string | null;
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
  related_strategy_id?: number | null;
};

export type TradingNoteInput = {
  strategy_id?: number | null;
  title: string;
  content: string;
  note_type?: "analysis" | "idea" | "review" | "risk";
};
