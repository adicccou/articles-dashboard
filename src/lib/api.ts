import type { ArticleInput, ArticleRecord, AuthState, DashboardBootstrap, Site, ArticleCategory, KnowledgeBase, KnowledgeBaseVersion, TradingStrategy, TradingExecution, TradingStats, RedditCampaign, RedditAccount, AssistantChatResponse, AssistantMessage, PlannerItem, TradingNote, PlannerItemInput, TradingNoteInput, AppSettings, AppSettingsInput, JournlStats, SocialAccount, SocialAccountInput, SocialPost } from "./types";

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
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
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
  createSite: (payload: Pick<Site, "name" | "slug" | "domain" | "status">) =>
    request<Site>("/api/sites", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getCategories: () => request<ArticleCategory[]>("/api/categories"),
  saveArticle: (payload: ArticleInput, id?: number) =>
    request<ArticleRecord>(id ? `/api/articles/${id}` : "/api/articles", {
      method: id ? "PUT" : "POST",
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
  getKnowledgeBase: (type: "reddit_campaign" | "trading_strategy" | "social_platform", id: number) =>
    request<KnowledgeBase>(`/api/knowledge-base/${type}/${id}`),
  saveKnowledgeBase: (
    type: "reddit_campaign" | "trading_strategy" | "social_platform",
    id: number,
    title: string,
    content: string,
    change_summary?: string,
  ) =>
    request<KnowledgeBase>(`/api/knowledge-base/${type}/${id}`, {
      method: "POST",
      body: JSON.stringify({ title, content, change_summary }),
    }),
  getKnowledgeBaseVersions: (type: "reddit_campaign" | "trading_strategy" | "social_platform", id: number) =>
    request<KnowledgeBaseVersion[]>(`/api/knowledge-base/${type}/${id}/versions`),
  getKnowledgeBaseVersion: (
    type: "reddit_campaign" | "trading_strategy" | "social_platform",
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
  deleteTradingStrategy: (id: number) =>
    request<{ success: boolean }>(`/api/trading/strategies/${id}`, {
      method: "DELETE",
    }),
  getTradingStats: (id: number) =>
    request<TradingStats>(`/api/trading/strategies/${id}/stats`),
  getTradingExecutions: (id: number) =>
    request<TradingExecution[]>(`/api/trading/strategies/${id}/executions`),
  chatWithAssistant: (messages: AssistantMessage[]) =>
    request<AssistantChatResponse>("/api/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
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
  getJournlStats: () => request<JournlStats>("/api/stats/journl"),

  // Social posts (shared across Twitter and Threads)
  listSocialPosts: (platform: string) =>
    request<SocialPost[]>(`/api/social/posts?platform=${platform}`),
  createSocialPost: (platform: string, content: string, scheduled_at?: string) =>
    request<SocialPost>(`/api/social/posts`, {
      method: "POST",
      body: JSON.stringify({ platform, content, scheduled_at }),
    }),
  updateSocialPost: (id: number, payload: Partial<SocialPost>) =>
    request<{ success: boolean; updated_at: string }>(`/api/social/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteSocialPost: (id: number) =>
    request<{ success: boolean }>(`/api/social/posts/${id}`, {
      method: "DELETE",
    }),

  // Twitter accounts
  listTwitterAccounts: () => request<SocialAccount[]>("/api/social/twitter/accounts"),
  addTwitterAccount: (payload: SocialAccountInput) =>
    request<SocialAccount>("/api/social/twitter/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteTwitterAccount: (id: number) =>
    request<{ success: boolean }>(`/api/social/twitter/accounts/${id}`, {
      method: "DELETE",
    }),

  // Threads accounts
  listThreadsAccounts: () => request<SocialAccount[]>("/api/social/threads/accounts"),
  addThreadsAccount: (payload: SocialAccountInput) =>
    request<SocialAccount>("/api/social/threads/accounts", {
      method: "POST",
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
};
