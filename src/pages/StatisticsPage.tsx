import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/solid";
import {
  ArrowPathRoundedSquareIcon,
  ChatBubbleBottomCenterTextIcon,
  ChatBubbleOvalLeftIcon,
  EyeIcon,
  HeartIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import type { IconType } from "react-icons";
import { FaFacebookF, FaLinkedinIn } from "react-icons/fa6";
import { SiInstagram, SiReddit, SiThreads, SiX, SiYoutube } from "react-icons/si";
import { api } from "../lib/api";
import type { InstagramInsightsResponse, LinkedInInsightsResponse, RedditAccount, SocialAccount, SocialComment, SocialPost, ThreadsInsightsResponse, TwitterInsightsResponse } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import { getDisplayPostImageUrls, isVideoMediaUrl } from "../lib/socialPostMedia";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { SectionTabs } from "../components/SectionTabs";
import "../styles/statistics-page.css";

type Platform = SocialPost["platform"];
type Account = Pick<SocialAccount, "id" | "platform" | "username" | "status" | "tags">;
type AccountStats = {
  account: Account;
  posts: SocialPost[];
  comments: SocialComment[];
  insights: AccountInsights;
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  draftPosts: number;
  failedPosts: number;
  commentsCount: number;
  repliesSent: number;
  lastPostAt: string | null;
};
type AccountInsights = {
  status: ThreadsInsightsResponse["status"] | TwitterInsightsResponse["status"] | InstagramInsightsResponse["status"] | LinkedInInsightsResponse["status"] | "not_supported" | "error";
  data: Array<ThreadsInsightsResponse["data"][number] | TwitterInsightsResponse["data"][number] | InstagramInsightsResponse["data"][number] | LinkedInInsightsResponse["data"][number]>;
  views: number | null;
  likes: number | null;
  shares: number | null;
  replies: number | null;
  posts: number;
  synced: number;
  message?: string;
};
type PlatformSelection = "all" | Platform;
type PostStatusTab = "posted" | "scheduled";
type PostMetricKey = "views" | "likes" | "comments" | "shares" | "replies" | "reposts" | "quotes";

const PLATFORMS: Platform[] = ["twitter", "threads", "reddit", "instagram", "linkedin", "facebook", "youtube"];
const COMMENT_PLATFORMS = new Set<Platform>(["twitter", "threads", "reddit"]);
const REQUEST_TIMEOUT_MS = 20000;
const platformIcons: Partial<Record<Platform, IconType>> = {
  twitter: SiX,
  threads: SiThreads,
  reddit: SiReddit,
  instagram: SiInstagram,
  linkedin: FaLinkedinIn,
  facebook: FaFacebookF,
  youtube: SiYoutube,
};
const postMetricIcons: Record<PostMetricKey, typeof EyeIcon> = {
  views: EyeIcon,
  likes: HeartIcon,
  comments: ChatBubbleBottomCenterTextIcon,
  shares: PaperAirplaneIcon,
  replies: ChatBubbleOvalLeftIcon,
  reposts: ArrowPathRoundedSquareIcon,
  quotes: ChatBubbleOvalLeftIcon,
};

const postMetricLabels: Record<PostMetricKey, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  replies: "Replies",
  reposts: "Reposts",
  quotes: "Quotes",
};

function PostMetric({ metric, value }: { metric: PostMetricKey; value: string }) {
  const Icon = postMetricIcons[metric];
  return (
    <span className="stats-post-metric" title={postMetricLabels[metric]}>
      <Icon className="stats-post-metric__icon" aria-hidden="true" />
      <strong>{value}</strong>
      <span>{postMetricLabels[metric]}</span>
    </span>
  );
}
const EMPTY_INSIGHTS: AccountInsights = {
  status: "not_supported",
  data: [],
  views: null,
  likes: null,
  shares: null,
  replies: null,
  posts: 0,
  synced: 0,
};

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: "green" | "blue" | "amber" | "purple" | "red" }) {
  return (
    <div className={`stat-card ${accent ? `stat-card--${accent}` : ""}`}>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {sub ? <span className="stat-card__sub">{sub}</span> : null}
    </div>
  );
}

function platformLabel(platform: string) {
  if (platform === "twitter") return "Twitter/X";
  if (platform === "threads") return "Threads";
  if (platform === "reddit") return "Reddit";
  if (platform === "instagram") return "Instagram";
  if (platform === "linkedin") return "LinkedIn";
  if (platform === "facebook") return "Facebook";
  if (platform === "youtube") return "YouTube";
  return platform;
}

function PlatformIcon({ platform }: { platform: Platform }) {
  const Icon = platformIcons[platform];
  if (!Icon) return null;
  return <Icon className={`stats-platform-icon stats-platform-icon--${platform}`} aria-hidden="true" />;
}

function normalizeRedditAccounts(accounts: RedditAccount[]): Account[] {
  return accounts.map((account) => ({
    id: account.id,
    platform: "reddit",
    username: account.name,
    status: account.status,
    tags: account.tags,
  }));
}

function accountKey(account: Pick<Account, "platform" | "id">) {
  return `${account.platform}:${account.id}`;
}

function accountLabel(account: Account) {
  const handle = account.username ? `@${account.username}` : `Account ${account.id}`;
  return `${platformLabel(account.platform)} ${handle}`;
}

function uniqueAccounts(accounts: Account[]) {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    const key = accountKey(account);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function postBelongsToAccount(post: SocialPost, account: Account, platformAccounts: Account[]) {
  if (post.platform !== account.platform) return false;
  if (post.account_id) return post.account_id === account.id;
  return platformAccounts.length === 1;
}

function latestDate(posts: SocialPost[]) {
  const timestamps = posts
    .map((post) => post.posted_at || post.scheduled_at || post.updated_at || post.created_at)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function insightsFromResponse(response: ThreadsInsightsResponse | TwitterInsightsResponse | InstagramInsightsResponse | LinkedInInsightsResponse): AccountInsights {
  return {
    status: response.status,
    data: response.data ?? [],
    views: response.totals.views,
    likes: response.totals.likes,
    shares: response.totals.shares,
    replies: response.totals.replies ?? null,
    posts: response.totals.posts,
    synced: response.totals.synced,
    message: response.warning,
  };
}

function insightError(message: string): AccountInsights {
  return {
    status: "error",
    data: [],
    views: null,
    likes: null,
    shares: null,
    replies: null,
    posts: 0,
    synced: 0,
    message,
  };
}

function formatInsightMetric(insights: AccountInsights, key: "views" | "likes" | "shares") {
  const value = insights[key];
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString();
  if (insights.status === "needs_reconnect") return "Reconnect";
  if (insights.status === "error") return "Error";
  if (insights.status === "connected") return "No data";
  return "Not connected";
}

function insightCellClass(insights: AccountInsights) {
  return typeof insights.views === "number" || typeof insights.likes === "number" || typeof insights.shares === "number"
    ? ""
    : "stats-unavailable";
}

function formatPostInsightValue(value: number | null | undefined, fallback = "Not connected") {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString();
  return fallback;
}

function postInsightFallback(post: SocialPost) {
  if (post.platform !== "threads" && post.platform !== "twitter" && post.platform !== "instagram" && post.platform !== "linkedin") return "Not connected";
  if (post.status !== "posted") return "No data";
  return "No data";
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out.`)), REQUEST_TIMEOUT_MS);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export function StatisticsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [commentsByAccount, setCommentsByAccount] = useState<Record<string, SocialComment[]>>({});
  const [insightsByAccount, setInsightsByAccount] = useState<Record<string, AccountInsights>>({});
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformSelection>("all");
  const [selectedAccountKey, setSelectedAccountKey] = useState("all");
  const [selectedPostStatus, setSelectedPostStatus] = useState<PostStatusTab>("posted");
  const [mediaViewerUrl, setMediaViewerUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load({ silent = false } = {}) {
    try {
      setError(null);
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const [twitterAccounts, threadsAccounts, redditAccounts, socialAccounts, postResults] = await withTimeout(
        Promise.all([
          api.listTwitterAccounts().catch(() => []),
          api.listThreadsAccounts().catch(() => []),
          api.listRedditAccounts().catch(() => []),
          api.listSocialAccounts().catch(() => []),
          Promise.all(PLATFORMS.map((platform) => api.listSocialPosts(platform).catch(() => []))),
        ]),
        "Social statistics",
      );

      const activeAccounts = uniqueAccounts([
        ...twitterAccounts,
        ...threadsAccounts,
        ...normalizeRedditAccounts(redditAccounts),
        ...socialAccounts,
      ]).filter((account) => account.status === "active");
      const allPosts = postResults.flat();

      const commentEntries = await Promise.all(
        activeAccounts
          .filter((account) => COMMENT_PLATFORMS.has(account.platform))
          .map(async (account) => {
            const response = await api
              .listSocialComments(account.platform as "twitter" | "threads" | "reddit", undefined, 100, account.id)
              .catch(() => ({ data: [] as SocialComment[] }));
            return [accountKey(account), response.data ?? []] as const;
          }),
      );

      const insightEntries = await Promise.all(
        activeAccounts
          .filter((account) => account.platform === "threads" || account.platform === "twitter" || account.platform === "instagram" || account.platform === "linkedin")
          .map(async (account) => {
            const response = await (
              account.platform === "twitter"
                ? api.getTwitterInsights(account.id)
                : account.platform === "instagram"
                ? api.getInstagramInsights(account.id)
                : account.platform === "linkedin"
                ? api.getLinkedInInsights(account.id)
                : api.getThreadsInsights(account.id)
            )
              .then(insightsFromResponse)
              .catch((err) => insightError(err instanceof Error ? err.message : `Failed to load ${platformLabel(account.platform)} insights`));
            return [accountKey(account), response] as const;
          }),
      );

      setAccounts(activeAccounts);
      setPosts(allPosts);
      setCommentsByAccount(Object.fromEntries(commentEntries));
      setInsightsByAccount(Object.fromEntries(insightEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load social statistics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const statsByAccount = useMemo<AccountStats[]>(() => {
    return accounts.map((account) => {
      const platformAccounts = accounts.filter((item) => item.platform === account.platform);
      const accountPosts = posts.filter((post) => postBelongsToAccount(post, account, platformAccounts));
      const accountComments = commentsByAccount[accountKey(account)] ?? [];
      const insights = insightsByAccount[accountKey(account)] ?? EMPTY_INSIGHTS;
      const insightReplies = typeof insights.replies === "number" && Number.isFinite(insights.replies) ? insights.replies : 0;
      return {
        account,
        posts: accountPosts,
        comments: accountComments,
        insights,
        totalPosts: accountPosts.length,
        publishedPosts: accountPosts.filter((post) => post.status === "posted").length,
        scheduledPosts: accountPosts.filter((post) => post.status === "scheduled").length,
        draftPosts: accountPosts.filter((post) => post.status === "draft" || post.status === "approved").length,
        failedPosts: accountPosts.filter((post) => post.status === "failed").length,
        commentsCount: accountComments.length || insightReplies,
        repliesSent: accountComments.filter((comment) => comment.reply_status === "replied" || comment.owner_reply_text).length,
        lastPostAt: latestDate(accountPosts),
      };
    }).sort((left, right) => right.publishedPosts - left.publishedPosts || right.totalPosts - left.totalPosts);
  }, [accounts, commentsByAccount, insightsByAccount, posts]);

  const platformTabs = useMemo(() => {
    const platforms = Array.from(new Set(statsByAccount.map((item) => item.account.platform)));
    return platforms.sort((left, right) => platformLabel(left).localeCompare(platformLabel(right)));
  }, [statsByAccount]);

  useEffect(() => {
    if (selectedPlatform !== "all" && !platformTabs.includes(selectedPlatform)) {
      setSelectedPlatform("all");
      setSelectedAccountKey("all");
    }
  }, [platformTabs, selectedPlatform]);

  const platformStats = useMemo(() => {
    return selectedPlatform === "all"
      ? statsByAccount
      : statsByAccount.filter((item) => item.account.platform === selectedPlatform);
  }, [selectedPlatform, statsByAccount]);

  useEffect(() => {
    if (selectedAccountKey !== "all" && !platformStats.some((item) => accountKey(item.account) === selectedAccountKey)) {
      setSelectedAccountKey("all");
    }
  }, [platformStats, selectedAccountKey]);

  const visibleStats = useMemo(() => {
    return selectedAccountKey === "all"
      ? platformStats
      : platformStats.filter((item) => accountKey(item.account) === selectedAccountKey);
  }, [platformStats, selectedAccountKey]);

  const totals = useMemo(() => ({
    accounts: visibleStats.length,
    posts: visibleStats.reduce((sum, item) => sum + item.totalPosts, 0),
    published: visibleStats.reduce((sum, item) => sum + item.publishedPosts, 0),
    scheduled: visibleStats.reduce((sum, item) => sum + item.scheduledPosts, 0),
    comments: visibleStats.reduce((sum, item) => sum + item.commentsCount, 0),
    replies: visibleStats.reduce((sum, item) => sum + item.repliesSent, 0),
  }), [visibleStats]);

  const visiblePosts = useMemo(() => {
    const visiblePostIds = new Set(visibleStats.flatMap((item) => item.posts.map((post) => post.id)));
    return posts.filter((post) => visiblePostIds.has(post.id));
  }, [posts, visibleStats]);

  const postStatusCounts = useMemo(() => ({
    posted: visiblePosts.filter((post) => post.status === "posted").length,
    scheduled: visiblePosts.filter((post) => post.status === "scheduled").length,
  }), [visiblePosts]);

  useEffect(() => {
    if (selectedPostStatus === "posted" && postStatusCounts.posted === 0 && postStatusCounts.scheduled > 0) {
      setSelectedPostStatus("scheduled");
    }
    if (selectedPostStatus === "scheduled" && postStatusCounts.scheduled === 0 && postStatusCounts.posted > 0) {
      setSelectedPostStatus("posted");
    }
  }, [postStatusCounts, selectedPostStatus]);

  const recentPosts = useMemo(() => {
    return visiblePosts
      .filter((post) => post.status === selectedPostStatus)
      .sort((left, right) => new Date(right.posted_at || right.scheduled_at || right.updated_at || right.created_at).getTime() - new Date(left.posted_at || left.scheduled_at || left.updated_at || left.created_at).getTime())
      .slice(0, 20);
  }, [selectedPostStatus, visiblePosts]);

  const postInsightsById = useMemo(() => {
    const values = new Map<number, AccountInsights["data"][number]>();
    visibleStats.forEach((item) => {
      item.insights.data.forEach((insight) => values.set(insight.post_id, insight));
    });
    return values;
  }, [visibleStats]);

  const postCommentsById = useMemo(() => {
    const values = new Map<number, number>();
    visibleStats.forEach((item) => {
      item.comments.forEach((comment) => {
        if (!comment.post_id) return;
        values.set(comment.post_id, (values.get(comment.post_id) ?? 0) + 1);
      });
    });
    return values;
  }, [visibleStats]);

  const postAccountLabelsById = useMemo(() => {
    const values = new Map<number, string>();
    visibleStats.forEach((item) => {
      item.posts.forEach((post) => values.set(post.id, accountLabel(item.account)));
    });
    return values;
  }, [visibleStats]);

  const selectedAccount = selectedAccountKey === "all"
    ? null
    : visibleStats[0]?.account ?? platformStats.find((item) => accountKey(item.account) === selectedAccountKey)?.account ?? null;
  const selectedScopeLabel = selectedAccount
    ? accountLabel(selectedAccount)
    : selectedPlatform === "all"
      ? "all platforms"
      : platformLabel(selectedPlatform);

  if (loading) return <div className="stats-loading">Loading social statistics...</div>;

  return (
    <section className="panel statistics-panel statistics-overview">
      <div className="statistics-overview__content">
        {error ? <div className="stats-error">{error}</div> : null}

        {statsByAccount.length === 0 ? (
          <div className="stats-loading">No active social accounts yet. Add accounts in Config to see social media statistics here.</div>
        ) : (
          <>
            <section className="stats-tabs-panel" aria-label="Statistics filters">
              <div className="stats-tabs-group">
                <span className="stats-tabs-label">Platform</span>
                <div className="stats-tabs-row">
                  <SectionTabs<PlatformSelection>
                    activeId={selectedPlatform}
                    ariaLabel="Social platform statistics"
                    className="social-platform-tabs stats-tabs-list"
                    tabClassName="social-tab"
                    activeTabClassName="social-tab--active"
                    onChange={(nextPlatform) => {
                      setSelectedPlatform(nextPlatform);
                      setSelectedAccountKey("all");
                    }}
                    items={[
                      { id: "all", label: "All platforms", badge: statsByAccount.length },
                      ...platformTabs.map((platform) => ({
                        id: platform,
                        label: platformLabel(platform),
                        leading: <PlatformIcon platform={platform} />,
                        badge: statsByAccount.filter((item) => item.account.platform === platform).length,
                      })),
                    ]}
                  />
                  <button
                    className="button-secondary dashboard-icon-button stats-refresh-button"
                    onClick={() => void load({ silent: true })}
                    disabled={refreshing}
                    aria-label="Refresh statistics"
                    title="Refresh"
                  >
                    <ArrowPathIcon aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {selectedPlatform !== "all" ? (
                <div className="stats-tabs-group">
                  <span className="stats-tabs-label">Account</span>
                  <SectionTabs
                    activeId={selectedAccountKey}
                    ariaLabel="Social account statistics"
                    className="social-platform-tabs stats-tabs-list"
                    tabClassName="social-tab"
                    activeTabClassName="social-tab--active"
                    onChange={setSelectedAccountKey}
                    items={[
                      {
                        id: "all",
                        label: `All ${platformLabel(selectedPlatform)} accounts`,
                        leading: <PlatformIcon platform={selectedPlatform} />,
                        badge: platformStats.length,
                      },
                      ...platformStats.map((item) => ({
                        id: accountKey(item.account),
                        label: item.account.username ? `@${item.account.username}` : `Account ${item.account.id}`,
                        leading: <PlatformIcon platform={item.account.platform} />,
                        badge: item.totalPosts,
                      })),
                    ]}
                  />
                </div>
              ) : null}
            </section>

            <section className="stats-section stats-performance-panel">
              <div className="stats-section__header">
                <div>
                  <h3>Publishing Overview</h3>
                  <p>Account health, posting volume, and last activity for {selectedScopeLabel}.</p>
                </div>
              </div>
              <div className="stats-grid stats-grid--summary">
                <StatCard label="Accounts" value={totals.accounts} sub={`visible in ${selectedScopeLabel}`} accent="blue" />
                <StatCard label="Published Posts" value={totals.published} sub={`${totals.posts} total created`} accent="green" />
                <StatCard label="Scheduled" value={totals.scheduled} sub="waiting to publish" accent="amber" />
                <StatCard label="Comments" value={totals.comments} sub={`${totals.replies} replied`} accent="purple" />
              </div>
              <div className="stats-account-grid">
                {visibleStats.map((item) => (
                  <article className="stats-account-card" key={accountKey(item.account)}>
                    <div className="stats-account-card__header">
                      <div>
                        <span className="stats-platform-chip">
                          <PlatformIcon platform={item.account.platform} />
                          {platformLabel(item.account.platform)}
                        </span>
                        <h4>{item.account.username ? `@${item.account.username}` : `Account ${item.account.id}`}</h4>
                      </div>
                      <span className={`stats-status-chip stats-status-chip--${item.account.status}`}>{item.account.status}</span>
                    </div>
                    <div className="stats-account-card__metrics">
                      <span><strong>{item.publishedPosts}</strong> published</span>
                      <span><strong>{item.scheduledPosts}</strong> scheduled</span>
                      <span><strong>{item.draftPosts}</strong> draft/approved</span>
                      <span><strong>{item.failedPosts}</strong> failed</span>
                    </div>
                    <p className="stats-account-card__note">
                      {item.lastPostAt ? `Latest activity ${formatDisplayDateTime(item.lastPostAt)}` : "No posts created for this account yet."}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section className="stats-section stats-table-section">
              <div className="stats-section__header">
                <div>
                  <h3>Engagement Performance</h3>
                  <p>Filtered to {selectedScopeLabel}. Views, likes, shares, and comments by account where platform APIs expose them.</p>
                </div>
              </div>
              <div className="stats-table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Total</th>
                      <th>Comments</th>
                      <th>Views</th>
                      <th>Likes</th>
                      <th>Shares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStats.map((item) => (
                      <tr key={accountKey(item.account)}>
                        <td>
                          <span className="stats-account-label">
                            <PlatformIcon platform={item.account.platform} />
                            {accountLabel(item.account)}
                          </span>
                        </td>
                        <td>{item.totalPosts}</td>
                        <td>{item.commentsCount}</td>
                        <td className={insightCellClass(item.insights)} title={item.insights.message}>{formatInsightMetric(item.insights, "views")}</td>
                        <td className={insightCellClass(item.insights)} title={item.insights.message}>{formatInsightMetric(item.insights, "likes")}</td>
                        <td className={insightCellClass(item.insights)} title={item.insights.message}>{formatInsightMetric(item.insights, "shares")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="stats-section stats-recent-section">
              <div className="stats-section__header">
                <div>
                  <h3>Social Posts</h3>
                  <p>{selectedPostStatus === "posted" ? "Published posts with per-post engagement metrics" : "Scheduled posts waiting to publish"} for {selectedScopeLabel}.</p>
                </div>
              </div>
              <SectionTabs
                activeId={selectedPostStatus}
                ariaLabel="Post status statistics"
                className="social-platform-tabs stats-tabs-list"
                tabClassName="social-tab"
                activeTabClassName="social-tab--active"
                onChange={setSelectedPostStatus}
                items={[
                  { id: "posted", label: "Published", badge: postStatusCounts.posted },
                  { id: "scheduled", label: "Scheduled", badge: postStatusCounts.scheduled },
                ]}
              />
              {recentPosts.length === 0 ? (
                <p className="stats-empty">No {selectedPostStatus === "posted" ? "published" : "scheduled"} posts yet.</p>
              ) : (
                <div className="stats-recent-list">
                  {recentPosts.map((post) => {
                    const insight = postInsightsById.get(post.id);
                    const fallback = postInsightFallback(post);
                    const comments = postCommentsById.get(post.id) ?? 0;
                    const insightComments = typeof insight?.replies === "number" && Number.isFinite(insight.replies) ? insight.replies : comments;
                    const postAccountLabel = postAccountLabelsById.get(post.id) ?? platformLabel(post.platform);
                    const mediaUrls = getDisplayPostImageUrls(post.image_url);
                    return (
                      <article className="stats-recent-post" key={`${post.platform}:${post.id}`}>
                        <div className="stats-recent-post__main">
                          <div className="stats-recent-post__topline">
                            <span className="stats-platform-chip">
                              <PlatformIcon platform={post.platform} />
                              {platformLabel(post.platform)}
                            </span>
                            <span className={`stats-post-status stats-post-status--${post.status}`}>{post.status}</span>
                          </div>
                          <p>{post.content || post.title || "Untitled post"}</p>
                          {mediaUrls.length > 0 ? (
                            <div className={`stats-post-media-grid ${mediaUrls.length > 1 ? "stats-post-media-grid--multi" : ""}`}>
                              {mediaUrls.map((mediaUrl, index) => {
                                const previewIsVideo = isVideoMediaUrl(mediaUrl);
                                return (
                                  <button
                                    key={`${mediaUrl}-${index}`}
                                    type="button"
                                    className="stats-post-media"
                                    onClick={() => setMediaViewerUrl(mediaUrl)}
                                    aria-label={`Open ${previewIsVideo ? "video" : "image"} preview ${index + 1}`}
                                  >
                                    {previewIsVideo ? (
                                      <>
                                        <video className="stats-post-media__asset" src={normalizeDashboardMediaUrl(mediaUrl)} muted playsInline preload="metadata" />
                                        <span className="stats-post-media__badge">Video</span>
                                      </>
                                    ) : (
                                      <img className="stats-post-media__asset" src={normalizeDashboardMediaUrl(mediaUrl)} alt={`Post preview ${index + 1}`} loading="lazy" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {selectedPostStatus === "posted" ? (
                            <div className="stats-post-metrics stats-post-metrics--published" aria-label="Post performance metrics">
                              <PostMetric metric="likes" value={formatPostInsightValue(insight?.likes, fallback)} />
                              <PostMetric metric="comments" value={insightComments.toLocaleString()} />
                              <PostMetric metric="shares" value={formatPostInsightValue(insight?.shares, fallback)} />
                              <PostMetric metric="replies" value={formatPostInsightValue(insight?.replies, fallback)} />
                              <PostMetric metric="reposts" value={formatPostInsightValue(insight?.reposts, fallback)} />
                              <PostMetric metric="quotes" value={formatPostInsightValue(insight?.quotes, fallback)} />
                              <PostMetric metric="views" value={formatPostInsightValue(insight?.views, fallback)} />
                            </div>
                          ) : (
                            <div className="stats-post-metrics stats-post-metrics--scheduled" aria-label="Scheduled post details">
                              <span><strong>{post.scheduled_at ? formatDisplayDateTime(post.scheduled_at) : "No date"}</strong>Scheduled for</span>
                              <span><strong>{postAccountLabel}</strong>Account</span>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {mediaViewerUrl ? (
        <div className="stats-media-viewer" onClick={() => setMediaViewerUrl(null)}>
          <div className="stats-media-viewer__dialog" onClick={(event) => event.stopPropagation()}>
            <ModalCloseButton className="stats-media-viewer__close" onClick={() => setMediaViewerUrl(null)} />
            {isVideoMediaUrl(mediaViewerUrl) ? (
              <video className="stats-media-viewer__asset" src={normalizeDashboardMediaUrl(mediaViewerUrl)} controls autoPlay playsInline />
            ) : (
              <img className="stats-media-viewer__asset" src={normalizeDashboardMediaUrl(mediaViewerUrl)} alt="Post media preview" />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
