export type DashboardUser = {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "inactive";
  timezone: string;
  created_at: string;
  updated_at: string;
  workspace_id?: number;
  workspace_role?: "owner" | "admin" | "member";
  workspace?: DashboardWorkspace;
};

export type DashboardWorkspace = {
  id: number;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived";
  plan: string;
  owner_user_id: number | null;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type AuthState = {
  authenticated: boolean;
  username?: string;
  user?: DashboardUser;
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

export type ArticleAssistField = "meta_title" | "meta_description" | "excerpt" | "category";

export type ArticleAssistPayload = {
  field: ArticleAssistField;
  title?: string;
  content?: string;
  excerpt?: string;
  category?: string;
  site_names?: string[];
  site_domains?: string[];
  categories?: string[];
};

export type ArticleCoverPayload = Omit<ArticleAssistPayload, "field"> & {
  cover_style_reference?: string;
};

export type ArticleStylePayload = Omit<ArticleAssistPayload, "field">;

export type ArticleStyleResponse = {
  html: string;
};

export type ArticleCoverResponse = {
  key: string;
  url: string;
  mime_type: string;
  prompt: string;
  model: string;
  aspect_ratio: string;
  image_size: string;
  note?: string;
};

export type RedditAccount = {
  id: number;
  name: string;
  status: "active" | "inactive";
  credentials_ready?: boolean | number;
  created_at: string;
  updated_at: string;
};

export type RedditSubscribedSubreddit = {
  name: string;
  display_name: string;
  title?: string | null;
  description?: string | null;
  subscribers?: number | null;
  over18?: boolean;
  icon_url?: string | null;
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
  confidence_threshold: number;
  self_learning_mode: "off" | "suggest_only";
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

export type LearningSuggestion = {
  factor: string;
  current: string;
  recommended: string;
  expected_winrate: string;
  impact: "HIGH" | "MED" | "LOW" | string;
  evidence: string;
};

export type LearningReport = {
  connected: boolean;
  ok?: boolean;
  date_range?: string;
  report_text?: string;
  ingested?: {
    backtest?: number;
    live?: number;
  };
  stats?: {
    total?: number;
    min_trades?: number;
    win_rate?: number;
    avg_rr?: number;
    profit_factor?: number;
    source_counts?: {
      backtest?: number;
      live?: number;
    };
    by_symbol?: Record<string, number>;
    best_hours_utc?: string;
    with_rsi_div?: number;
    without_rsi_div?: number;
    with_vwap?: number;
    without_vwap?: number;
    suggestions?: LearningSuggestion[];
  };
  error?: string;
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

export type CustomLeanWorkerStats = {
  period: string;
  backtest_period?: string;
  backtest_total_trades?: number;
  backtest_win_rate?: number;
  total_trades: number;
  trades_per_day: number;
  win_rate: number;
  pnl_r: number;
  pnl_usd_at_20_risk: number;
  avg_win_rr: number;
  avg_loss_rr: number;
  today_trades: number;
  today_pnl_usd: number;
};

export type TradingRuntimeBlocker = {
  code: string;
  level: "info" | "warning" | "critical";
  message: string;
  scope: "runtime" | "settings" | "data" | "worker" | "asset";
  target?: string;
};

export type TradingRuntimeRowState = {
  status: string;
  reason: string;
  updated_at?: string;
  data_age_seconds?: number | null;
  last_signal_id?: string;
  risk?: Record<string, unknown> | null;
  blockers?: TradingRuntimeBlocker[];
};

export type TradingRuntimeSummary = {
  connected: boolean;
  updated_at: string | null;
  diagnostics_age_seconds?: number | null;
  diagnostics_stale?: boolean;
  status_counts: Record<string, number>;
  event_counts?: Record<string, number>;
  blockers: TradingRuntimeBlocker[];
};

export type CustomLeanWorker = {
  id: string;
  asset: string;
  name: string;
  role: string;
  description: string;
  playbook: string;
  components: string[];
  target_trades_per_day: string;
  status: "ready" | "shadow" | "emit" | "paused";
  enabled?: boolean;
  risk_usd_min?: number;
  risk_usd_max?: number;
  confidence_threshold?: number;
  runtime?: TradingRuntimeRowState;
  stats: CustomLeanWorkerStats;
};

export type CustomLeanAssetWorkers = {
  asset: string;
  display_name: string;
  coordinator: {
    mode: "shadow" | "emit";
    market_order_only: boolean;
    one_worker_one_stats: boolean;
    updated_at: string;
    worker_count?: number;
    status_counts?: Record<string, number>;
    event_counts?: Record<string, number>;
  };
  diagnostics?: TradingRuntimeSummary;
  workers: CustomLeanWorker[];
};

export type CustomLeanWorkersResponse = {
  connected: boolean;
  updated_at: string;
  diagnostics: {
    mode: "shadow" | "emit";
    worker_count: number;
    status_counts: Record<string, number>;
    event_counts: Record<string, number>;
    diagnostics_age_seconds?: number | null;
    diagnostics_stale?: boolean;
    blockers: TradingRuntimeBlocker[];
  };
  assets: CustomLeanAssetWorkers[];
};

export type CustomLeanDiagnostics = {
  connected: boolean;
  updated_at: string;
  diagnostics_file?: string;
  diagnostics_present: boolean;
  diagnostics_age_seconds: number | null;
  diagnostics_stale: boolean;
  mode: string;
  worker_count: number;
  status_counts: Record<string, number>;
  event_counts: Record<string, number>;
  active_worker_ids: string[];
  expected_runnable_worker_ids: string[];
  missing_runnable_worker_ids: string[];
  unexpected_worker_ids: string[];
  blockers: TradingRuntimeBlocker[];
  catalog: CustomLeanWorker[];
  diagnostics: Record<string, unknown>;
};

export type CustomLeanSettings = {
  active: boolean;
  risk_usd_min: number;
  risk_usd_max: number;
  max_open_trades_per_worker: number;
  disabled_worker_ids: string[];
  deleted_worker_ids: string[];
  worker_risk_overrides: Record<string, { risk_usd_min: number; risk_usd_max: number }>;
  worker_confidence_overrides: Record<string, { min_confidence: number }>;
  execution_mode: "demo" | "live";
  demo_account_id: string;
  live_account_id: string;
  selected_account_id: string;
  sync_result?: {
    ok: boolean;
    message: string;
  } | null;
};

export type MlTradingAssetStats = {
  period: string;
  total_pnl_usd: number;
  today_pnl_usd: number;
  today_trades: number;
  total_win_trades: number;
  total_loss_trades: number;
  avg_win_rr: number;
  avg_loss_rr: number;
};

export type MlTradingAsset = {
  asset: string;
  display_name: string;
  enabled: boolean;
  model_stack: string;
  timeframe: string;
  notes: string;
  control_family?: "ml_asset" | "worker";
  control_key?: string;
  trade_symbol?: string;
  risk_usd_min?: number;
  risk_usd_max?: number;
  confidence_threshold?: number;
  runtime?: TradingRuntimeRowState;
  stats: MlTradingAssetStats;
};

export type MlTradingAssetsResponse = {
  connected: boolean;
  updated_at: string;
  diagnostics: TradingRuntimeSummary;
  assets: MlTradingAsset[];
};

export type MlTradingDiagnostics = {
  connected: boolean;
  updated_at: string | null;
  asset_count: number;
  status_counts: Record<string, number>;
  blockers: TradingRuntimeBlocker[];
  assets: Array<{
    asset: string;
    display_name: string;
    status: string;
    reason: string;
    bar?: string;
    data_age_seconds?: number | null;
    last_signal_id?: string;
  }>;
};

export type MlTradingSettings = {
  active: boolean;
  risk_usd_min: number;
  risk_usd_max: number;
  execution_mode: "demo";
  demo_account_id: string;
  selected_account_id: string;
  enabled_assets: string[];
  asset_risk_overrides: Record<string, { risk_usd_min: number; risk_usd_max: number }>;
  asset_confidence_overrides: Record<string, { min_confidence: number }>;
  sync_result?: {
    ok: boolean;
    message: string;
  } | null;
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
  custom_lean_settings?: CustomLeanSettings;
  ml_trading_settings?: MlTradingSettings;
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
  custom_lean_active?: string;
  custom_lean_risk_usd_min?: string;
  custom_lean_risk_usd_max?: string;
  custom_lean_worker_risk_overrides?: string;
  custom_lean_worker_confidence_overrides?: string;
  custom_lean_max_open_trades_per_worker?: string;
  custom_lean_execution_mode?: "demo" | "live";
  ml_trading_active?: string;
  ml_trading_risk_usd_min?: string;
  ml_trading_risk_usd_max?: string;
  ml_trading_asset_risk_overrides?: string;
  ml_trading_asset_confidence_overrides?: string;
  ml_trading_enabled_assets?: string;
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
  social_post_status?: SocialPost["status"] | null;
  account_id?: number | null;
  subreddit?: string | null;
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
  image_url?: string | null;
  item_type?: "post" | "campaign";
  platform: string;
  status?: "planned" | "published";
  scheduled_for?: string | null;
  social_post_id?: number | null;
  account_id?: number | null;
  subreddit?: string | null;
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
  platform: "twitter" | "threads" | "reddit" | "linkedin" | "instagram" | "youtube";
  username: string;
  status: "active" | "inactive";
  connection_mode?: "official_api";
  credentials_ready?: boolean | number;
  display_name?: string | null;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialAccountInput = {
  username?: string;
  [key: string]: string | undefined;
};

export type SocialPost = {
  id: number;
  platform: "twitter" | "threads" | "reddit" | "linkedin" | "instagram" | "youtube";
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

export type SocialComment = {
  platform: "twitter" | "threads" | "reddit";
  post_id: number | null;
  post_external_id: string | null;
  post_preview?: string | null;
  post_title?: string | null;
  post_image_url?: string | null;
  subreddit?: string | null;
  commenter_username: string | null;
  commenter_name: string | null;
  text: string;
  commented_at: string | null;
  external_id: string | null;
  parent_external_id?: string | null;
  permalink: string | null;
  reply_status?: "new" | "replied";
  owner_reply_text?: string | null;
  owner_replied_at?: string | null;
  owner_reply_external_id?: string | null;
  owner_reply_permalink?: string | null;
};

export type SocialReplySuggestion = {
  reply_text: string;
};

export type StudioAccount = {
  id: number;
  platform: "twitter" | "threads" | "reddit";
  username: string;
  status: "active" | "inactive";
  ref: string;
  label: string;
  created_at: string;
  updated_at: string;
};

export type StudioApp = {
  id: number;
  name: string;
  website_url?: string | null;
  app_store_url?: string | null;
  articles_api_url?: string | null;
  description: string;
  ai_context: string;
  status: "active" | "inactive" | "archived";
  created_at: string;
  updated_at: string;
};

export type StudioCampaign = {
  id: number;
  app_id: number;
  app_name?: string | null;
  name: string;
  campaign_type: "post" | "reply";
  result_limit: number;
  account_refs: string[];
  platforms: Array<"twitter" | "threads" | "reddit">;
  instructions: string;
  status: "active" | "paused" | "archived";
  created_at: string;
  updated_at: string;
};

export type StudioCrawlerRun = {
  id: number;
  campaign_id?: number | null;
  campaign_name?: string | null;
  app_id: number;
  app_name?: string | null;
  campaign_type: "post" | "reply";
  result_limit: number;
  account_refs: string[];
  platforms: Array<"twitter" | "threads" | "reddit">;
  instructions: string;
  status: "pending" | "running" | "completed" | "failed";
  crawler_summary?: string | null;
  raw_data?: unknown;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioSignal = {
  id: number;
  crawler_run_id: number;
  campaign_id?: number | null;
  campaign_name?: string | null;
  app_id: number;
  app_name?: string | null;
  platform: "twitter" | "threads" | "reddit";
  source: string;
  query: string;
  title: string;
  url?: string | null;
  author?: string | null;
  snippet: string;
  pain_point: string;
  audience: string;
  evidence: string;
  opportunity_score: number;
  noise_reason?: string | null;
  status: "candidate" | "filtered" | "signal" | "rejected";
  raw_data?: unknown;
  created_at: string;
  updated_at: string;
};

export type StudioStrategistPost = {
  id: number;
  crawler_run_id: number;
  campaign_id?: number | null;
  campaign_name?: string | null;
  app_id: number;
  app_name?: string | null;
  platform: "twitter" | "threads" | "reddit";
  post_text: string;
  idea: string;
  rationale: string;
  target_url?: string | null;
  target_external_id?: string | null;
  target_author?: string | null;
  target_text?: string | null;
  media_type: "none" | "photo" | "video";
  media_url?: string | null;
  status: "suggested" | "asset_needed" | "scheduled" | "posted" | "dismissed";
  social_post_id?: number | null;
  planner_item_id?: number | null;
  scheduled_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioSummary = {
  accounts: StudioAccount[];
  apps: StudioApp[];
  campaigns: StudioCampaign[];
  crawler_runs: StudioCrawlerRun[];
  signals: StudioSignal[];
  strategist_posts: StudioStrategistPost[];
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
