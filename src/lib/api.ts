import type { ArticleAssistPayload, ArticleCoverPayload, ArticleCoverResponse, ArticleInput, ArticleRecord, ArticleStylePayload, ArticleStyleResponse, AuthState, DashboardBootstrap, DashboardUser, ArticleCategory, KnowledgeBase, KnowledgeBaseVersion, TradingStrategy, TradingExecution, TradingStats, LearningReport, RedditCampaign, RedditAccount, RedditSubscribedSubreddit, PlannerItem, TradingNote, PlannerItemInput, TradingNoteInput, AppSettings, AppSettingsInput, JournlStats, Site, SocialAccount, SocialAccountInput, SocialComment, SocialPost, SocialReplySuggestion, StudioAccount, StudioApp, StudioCampaign, StudioCrawlerRun, StudioSignal, StudioStrategistPost, StudioSummary, ThreadsCampaignResult, ThreadsMediaResponse, CustomLeanDiagnostics, CustomLeanSettings, CustomLeanWorkersResponse, MlTradingAssetsResponse, MlTradingDiagnostics, MlTradingSettings } from "./types";

type SocialReplyPublishResponse = {
  success: boolean;
  external_id: string;
  account_id?: number;
  permalink?: string | null;
  replied_to_id?: string | null;
  verified_reply_target?: boolean | null;
  reply_audience?: string | null;
};

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const raw = await response.text();
    if (raw) {
      let parsedMessage: string | null = null;
      try {
        const parsed = JSON.parse(raw) as { error?: string; message?: string };
        parsedMessage = parsed.error || parsed.message || null;
      } catch {}
      throw new Error(parsedMessage || raw || `Request failed with ${response.status}`);
    }
    throw new Error(`Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  bootstrap: () => request<DashboardBootstrap>("/api/bootstrap"),
  login: (username: string, password: string, remember = true) =>
    request<AuthState>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, remember }),
    }),
  logout: () =>
    request<void>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getProfile: () => request<DashboardUser>("/api/profile"),
  updateProfile: (payload: Partial<Pick<DashboardUser, "display_name" | "email" | "avatar_url" | "timezone">>) =>
    request<DashboardUser>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  listUsers: () => request<DashboardUser[]>("/api/users"),
  createUser: (payload: { username: string; password: string; display_name?: string; email?: string; role?: "admin" | "member"; timezone?: string }) =>
    request<DashboardUser>("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getCategories: () => request<ArticleCategory[]>("/api/categories"),
  listSites: () => request<Site[]>("/api/sites"),
  updateSite: (id: number, payload: Pick<Site, "name" | "slug" | "domain" | "status">) =>
    request<Site>(`/api/sites/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteSite: (id: number) =>
    request<void>(`/api/sites/${id}`, { method: "DELETE" }),
  saveArticle: (payload: ArticleInput, id?: number) =>
    request<ArticleRecord>(id ? `/api/articles/${id}` : "/api/articles", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    }),
  autofillArticleField: (payload: ArticleAssistPayload) =>
    request<{ value: string }>("/api/articles/assist", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generateArticleCover: (payload: ArticleCoverPayload) =>
    request<ArticleCoverResponse>("/api/articles/generate-cover", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  styleArticleContent: (payload: ArticleStylePayload) =>
    request<ArticleStyleResponse>("/api/articles/style-content", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteArticle: (id: number) =>
    request<void>(`/api/articles/${id}`, { method: "DELETE" }),
  uploadMedia: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/media", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json() as Promise<{ key: string; url: string }>;
  },
  getKnowledgeBase: (type: "reddit_campaign" | "trading_strategy" | "social_platform" | "global", id: number) =>
    request<KnowledgeBase>(`/api/knowledge-base/${type}/${id}`),
  saveKnowledgeBase: (
    type: "reddit_campaign" | "trading_strategy" | "social_platform" | "global",
    id: number,
    title: string,
    content: string,
    change_summary?: string,
  ) =>
    request<KnowledgeBase>(`/api/knowledge-base/${type}/${id}`, {
      method: "POST",
      body: JSON.stringify({ title, content, change_summary }),
    }),
  getKnowledgeBaseVersions: (type: "reddit_campaign" | "trading_strategy" | "social_platform" | "global", id: number) =>
    request<KnowledgeBaseVersion[]>(`/api/knowledge-base/${type}/${id}/versions`),
  getKnowledgeBaseVersion: (
    type: "reddit_campaign" | "trading_strategy" | "social_platform" | "global",
    id: number,
    version: number,
  ) =>
    request<KnowledgeBaseVersion>(`/api/knowledge-base/${type}/${id}/versions/${version}`),
  listTradingStrategies: () => request<TradingStrategy[]>("/api/trading/strategies"),
  getTradingStrategy: (id: number) =>
    request<TradingStrategy>(`/api/trading/strategies/${id}`),
  createTradingStrategy: (payload: Omit<TradingStrategy, "id" | "status" | "created_at" | "updated_at">) =>
    request<TradingStrategy>("/api/trading/strategies", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateTradingStrategy: (id: number, payload: Partial<TradingStrategy>) =>
    request<{ success: boolean; updated_at: string }>(`/api/trading/strategies/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  activateTradingStrategy: (id: number) =>
    request<TradingStrategy>(`/api/trading/strategies/${id}/activate`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  deactivateTradingStrategy: (id: number) =>
    request<TradingStrategy>(`/api/trading/strategies/${id}/deactivate`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  deleteTradingStrategy: (id: number) =>
    request<{ success: boolean }>(`/api/trading/strategies/${id}`, {
      method: "DELETE",
    }),
  getTradingStats: (id: number) =>
    request<TradingStats>(`/api/trading/strategies/${id}/stats`),
  getTradingExecutions: (id: number) =>
    request<TradingExecution[]>(`/api/trading/strategies/${id}/executions`),
  getCustomLeanWorkers: () =>
    request<CustomLeanWorkersResponse>("/api/trading/nautilus/workers"),
  getCustomLeanDiagnostics: () =>
    request<CustomLeanDiagnostics>("/api/trading/nautilus/diagnostics"),
  getCustomLeanSettings: () =>
    request<CustomLeanSettings>("/api/trading/nautilus/settings"),
  updateCustomLeanSettings: (payload: Partial<CustomLeanSettings>) =>
    request<CustomLeanSettings>("/api/trading/nautilus/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getMlTradingAssets: () =>
    request<MlTradingAssetsResponse>("/api/trading/ml/assets"),
  getMlTradingDiagnostics: () =>
    request<MlTradingDiagnostics>("/api/trading/ml/diagnostics"),
  getMlTradingSettings: () =>
    request<MlTradingSettings>("/api/trading/ml/settings"),
  updateMlTradingSettings: (payload: Partial<MlTradingSettings>) =>
    request<MlTradingSettings>("/api/trading/ml/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listPlannerItems: () => request<PlannerItem[]>("/api/planner/items"),
  createPlannerItem: (payload: PlannerItemInput) =>
    request<PlannerItem>("/api/planner/items", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePlannerItem: (id: number, payload: Partial<PlannerItemInput>) =>
    request<{ success: boolean; updated_at: string }>(`/api/planner/items/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deletePlannerItem: (id: number) =>
    request<{ success: boolean }>(`/api/planner/items/${id}`, {
      method: "DELETE",
    }),
  improvePlannerDescription: (payload: { description: string; platform?: string | null }) =>
    request<{ value: string }>("/api/planner/improve-description", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listTradingNotes: () => request<TradingNote[]>("/api/trading/notes"),
  createTradingNote: (payload: TradingNoteInput) =>
    request<TradingNote>("/api/trading/notes", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateTradingNote: (id: number, payload: Partial<TradingNoteInput>) =>
    request<{ success: boolean; updated_at: string }>(`/api/trading/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteTradingNote: (id: number) =>
    request<{ success: boolean }>(`/api/trading/notes/${id}`, {
      method: "DELETE",
    }),
  listCampaigns: () => request<RedditCampaign[]>("/api/reddit/campaigns"),
  createCampaign: (payload: Omit<RedditCampaign, "id" | "created_at" | "updated_at">) =>
    request<RedditCampaign>("/api/reddit/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCampaign: (id: number, payload: Partial<RedditCampaign>) =>
    request<{ success: boolean }>(`/api/reddit/campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteCampaign: (id: number) =>
    request<{ success: boolean }>(`/api/reddit/campaigns/${id}`, {
      method: "DELETE",
    }),
  listRedditAccounts: () => request<RedditAccount[]>("/api/reddit/accounts"),
  listRedditSubscribedSubreddits: (accountId?: number | null) => {
    const params = new URLSearchParams();
    if (accountId) params.set("account_id", String(accountId));
    const query = params.toString();
    return request<{
      data: RedditSubscribedSubreddit[];
      account_id?: number | null;
      account_name?: string | null;
      warning?: string;
    }>(`/api/reddit/subreddits${query ? `?${query}` : ""}`);
  },
  addRedditAccount: (payload: {
    name: string;
    status?: "active" | "inactive";
    connection_mode?: "official_api" | "playwright";
    playwright_login?: string;
    playwright_password?: string;
  }) =>
    request<RedditAccount>("/api/reddit/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  startRedditOAuth: (account_name: string) =>
    request<{ auth_url: string }>("/api/reddit/auth/authorize", {
      method: "POST",
      body: JSON.stringify({ account_name }),
    }),
  updateRedditAccount: (id: number, payload: {
    name?: string;
    status?: "active" | "inactive";
    connection_mode?: "official_api" | "playwright";
    playwright_login?: string;
    playwright_password?: string;
  }) =>
    request<{ success: boolean; updated_at: string }>(`/api/reddit/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteRedditAccount: (id: number) =>
    request<{ success: boolean }>(`/api/reddit/accounts/${id}`, {
      method: "DELETE",
    }),
  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (payload: AppSettingsInput) =>
    request<AppSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  syncTradingAgentSettings: () =>
    request<{ ok: boolean; message: string }>("/api/settings/sync-agent", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getLeanStatus: () =>
    request<{
      connected: boolean;
      scanner_running?: boolean;
      backtest_running?: boolean;
      last_signal?: { symbol: string; direction: string; confidence: number | null; timeframe: string; detected_at: string } | null;
      signals_today?: number;
      signals_cap?: number;
      strategy_active?: boolean;
      demo_mode?: boolean;
      error?: string;
    }>("/api/trading/lean-status"),
  getLearningReport: () =>
    request<LearningReport>("/api/trading/learning-report"),
  getJournlStats: () => request<JournlStats>("/api/stats/journl"),

  // Social posts (shared across Twitter and Threads)
  listSocialPosts: (platform: string) =>
    request<SocialPost[]>(`/api/social/posts?platform=${platform}`),
  createSocialPost: (platform: string, content: string, scheduled_at?: string, image_url?: string) =>
    request<SocialPost>(`/api/social/posts`, {
      method: "POST",
      body: JSON.stringify({ platform, content, scheduled_at, image_url }),
    }),
  updateSocialPost: (id: number, payload: Partial<SocialPost>) =>
    request<{ success: boolean; updated_at: string }>(`/api/social/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteSocialPost: (id: number) =>
    request<{ success: boolean; external_deleted?: boolean; dashboard_only?: boolean; platform?: string }>(`/api/social/posts/${id}`, {
      method: "DELETE",
    }),
  publishSocialPost: (id: number) =>
    request<{ success: boolean; external_id: string; posted_at: string }>(`/api/social/posts/${id}/publish`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // Studio
  getStudio: () => request<StudioSummary>("/api/studio"),
  listStudioAccounts: () => request<StudioAccount[]>("/api/studio/accounts"),
  listStudioApps: () => request<StudioApp[]>("/api/studio/apps"),
  createStudioApp: (payload: Omit<StudioApp, "id" | "created_at" | "updated_at">) =>
    request<StudioApp>("/api/studio/apps", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateStudioApp: (id: number, payload: Partial<Omit<StudioApp, "id" | "created_at" | "updated_at">>) =>
    request<{ success: boolean; updated_at: string }>(`/api/studio/apps/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteStudioApp: (id: number) =>
    request<{ success: boolean }>(`/api/studio/apps/${id}`, {
      method: "DELETE",
    }),
  createStudioCampaign: (payload: {
    app_id: number;
    name: string;
    campaign_type: "post" | "reply";
    result_limit: number;
    account_refs: string[];
    platforms: string[];
    instructions: string;
  }) =>
    request<StudioCampaign>("/api/studio/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateStudioCampaign: (id: number, payload: Partial<StudioCampaign>) =>
    request<{ success: boolean; updated_at: string }>(`/api/studio/campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteStudioCampaign: (id: number) =>
    request<{ success: boolean }>(`/api/studio/campaigns/${id}`, {
      method: "DELETE",
    }),
  createStudioCrawlerRun: (payload: {
    campaign_id?: number | null;
    app_id?: number;
    campaign_type?: "post" | "reply";
    result_limit?: number;
    account_refs?: string[];
    platforms?: string[];
    instructions?: string;
  }) =>
    request<StudioCrawlerRun>("/api/studio/crawler-runs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listStudioSignals: (crawlerRunId?: number) =>
    request<StudioSignal[]>(
      `/api/studio/signals${crawlerRunId ? `?crawler_run_id=${encodeURIComponent(String(crawlerRunId))}` : ""}`,
    ),
  deleteStudioSignal: (id: number) =>
    request<{ success: boolean }>(`/api/studio/signals/${id}`, {
      method: "DELETE",
    }),
  updateStudioStrategistPost: (id: number, payload: Partial<StudioStrategistPost>) =>
    request<{ success: boolean; updated_at: string }>(`/api/studio/strategist-posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  regenerateStudioStrategistPost: (id: number) =>
    request<StudioStrategistPost>(`/api/studio/strategist-posts/${id}/regenerate`, {
      method: "POST",
    }),
  scheduleStudioStrategistPost: (id: number, payload: { scheduled_at?: string | null; media_url?: string | null }) =>
    request<{ success: boolean; social_post_id: number; planner_item_id: number; scheduled_at: string }>(
      `/api/studio/strategist-posts/${id}/schedule`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  unpostStudioStrategistPost: (id: number) =>
    request<{ success: boolean; status: StudioStrategistPost["status"]; updated_at: string }>(
      `/api/studio/strategist-posts/${id}/unpost`,
      {
        method: "POST",
      },
    ),

  // Twitter accounts
  listSocialAccounts: () => request<SocialAccount[]>("/api/social/accounts"),
  addSocialAccount: (payload: SocialAccountInput & { platform: SocialAccount["platform"] }) =>
    request<SocialAccount>("/api/social/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSocialAccount: (id: number, payload: SocialAccountInput & { status?: "active" | "inactive" }) =>
    request<{ success: boolean; updated_at: string }>(`/api/social/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteSocialAccount: (id: number) =>
    request<{ success: boolean }>(`/api/social/accounts/${id}`, {
      method: "DELETE",
    }),
  listTwitterAccounts: () => request<SocialAccount[]>("/api/social/twitter/accounts"),
  addTwitterAccount: (payload: SocialAccountInput) =>
    request<SocialAccount>("/api/social/twitter/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateTwitterAccount: (id: number, payload: SocialAccountInput & { status?: "active" | "inactive" }) =>
    request<{ success: boolean; updated_at: string }>(`/api/social/twitter/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteTwitterAccount: (id: number) =>
    request<{ success: boolean }>(`/api/social/twitter/accounts/${id}`, {
      method: "DELETE",
    }),
  listSocialComments: (platform: "twitter" | "threads" | "reddit", postId?: number, limit?: number) => {
    const params = new URLSearchParams({ platform });
    if (postId) params.set("post_id", String(postId));
    if (limit) params.set("limit", String(limit));
    return request<{ data: SocialComment[] }>(`/api/social/comments?${params.toString()}`);
  },
  suggestSocialReply: (payload: {
    platform: "twitter" | "threads" | "reddit";
    post_preview?: string | null;
    post_title?: string | null;
    subreddit?: string | null;
    commenter_username?: string | null;
    commenter_name?: string | null;
    comment_text: string;
  }) =>
    request<SocialReplySuggestion>("/api/social/reply-suggestion", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createTwitterReply: (reply_to_id: string, text: string) =>
    request<SocialReplyPublishResponse>("/api/social/twitter/replies", {
      method: "POST",
      body: JSON.stringify({ reply_to_id, text }),
    }),
  createRedditReply: (reply_to_id: string, text: string) =>
    request<SocialReplyPublishResponse>("/api/social/reddit/replies", {
      method: "POST",
      body: JSON.stringify({ reply_to_id, text }),
    }),

  // Threads accounts
  listThreadsAccounts: () => request<SocialAccount[]>("/api/social/threads/accounts"),
  addThreadsAccount: (payload: SocialAccountInput) =>
    request<SocialAccount>("/api/social/threads/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateThreadsAccount: (id: number, payload: SocialAccountInput & { status?: "active" | "inactive" }) =>
    request<{ success: boolean; updated_at: string }>(`/api/social/threads/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  startThreadsOAuth: (payload: SocialAccountInput) =>
    request<{ auth_url: string }>("/api/threads/auth/authorize", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteThreadsAccount: (id: number) =>
    request<{ success: boolean }>(`/api/social/threads/accounts/${id}`, {
      method: "DELETE",
    }),
  publishThreadsPost: (id: number) =>
    request<{ success: boolean; external_id: string; posted_at: string }>(`/api/social/threads/posts/${id}/publish`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  searchThreads: (query: string, searchType = "TOP") =>
    request<ThreadsMediaResponse>(
      `/api/social/threads/search?q=${encodeURIComponent(query)}&search_type=${encodeURIComponent(searchType)}`,
    ),
  listThreadsReplies: (mediaId?: string) =>
    request<ThreadsMediaResponse>(
      `/api/social/threads/replies${mediaId ? `?media_id=${encodeURIComponent(mediaId)}` : ""}`,
    ),
  listThreadsCampaignResults: (campaignId?: number) =>
    request<ThreadsCampaignResult[]>(
      `/api/social/threads/campaign-results${campaignId ? `?campaign_id=${encodeURIComponent(String(campaignId))}` : ""}`,
    ),
  updateThreadsCampaignResult: (
    id: number,
    payload: Partial<Pick<ThreadsCampaignResult, "review_status" | "suggested_reply" | "suggested_post" | "suggestion_reason">>,
  ) =>
    request<{ success: boolean; updated_at: string }>(`/api/social/threads/campaign-results/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  createThreadsReply: (reply_to_id: string, text: string, image_url?: string) =>
    request<SocialReplyPublishResponse>("/api/social/threads/replies", {
      method: "POST",
      body: JSON.stringify({ reply_to_id, text, image_url }),
    }),
};
