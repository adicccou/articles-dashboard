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
import type { ArticleRecord, InstagramInsightsResponse, JournlBreakdownItem, JournlStats, LinkedInInsightsResponse, RedditAccount, Site, SocialAccount, SocialComment, SocialPost, ThreadsInsightsResponse, TwitterInsightsResponse } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import { getDisplayPostImageUrls, isVideoMediaUrl } from "../lib/socialPostMedia";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { SectionTabs } from "../components/SectionTabs";
import type { DashboardSurface } from "../lib/surface";
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

type StatisticsPageProps = {
  surface?: DashboardSurface;
  articles?: ArticleRecord[];
  sites?: Site[];
};

type ArticleStatsTab = "articles" | "general";
type SiteArticleStats = {
  site: Site;
  total: number;
  drafts: number;
  scheduled: number;
  published: number;
  latestPublishedAt: string | null;
  nextScheduledAt: string | null;
};

function isScheduledArticle(article: ArticleRecord) {
  return article.status === "published" && article.published_at && new Date(article.published_at).getTime() > Date.now();
}

function isPublishedArticle(article: ArticleRecord) {
  return article.status === "published" && !isScheduledArticle(article);
}

function buildSiteArticleStats(articles: ArticleRecord[], sites: Site[]): SiteArticleStats[] {
  return sites.map((site) => {
    const siteArticles = articles.filter((article) => article.site_ids.includes(site.id));
    const drafts = siteArticles.filter((article) => article.status === "draft");
    const scheduled = siteArticles.filter((article) => isScheduledArticle(article));
    const published = siteArticles.filter((article) => isPublishedArticle(article));
    const latestPublishedAt = published
      .map((article) => article.published_at)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
    const nextScheduledAt = scheduled
      .map((article) => article.published_at)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;
    return {
      site,
      total: siteArticles.length,
      drafts: drafts.length,
      scheduled: scheduled.length,
      published: published.length,
      latestPublishedAt,
      nextScheduledAt,
    };
  }).sort((left, right) => right.total - left.total || left.site.name.localeCompare(right.site.name));
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function percentOf(count: number, total: number) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function articleSiteActivityLabel(siteStats: SiteArticleStats) {
  if (siteStats.nextScheduledAt) return "Next queued";
  if (siteStats.latestPublishedAt) return "Latest live";
  return "Waiting";
}

function articleSiteActivitySub(siteStats: SiteArticleStats) {
  if (siteStats.nextScheduledAt) return formatDisplayDateTime(siteStats.nextScheduledAt);
  if (siteStats.latestPublishedAt) return formatDisplayDateTime(siteStats.latestPublishedAt);
  return "No publish activity yet";
}

function siteSuggestions(siteSlug: string) {
  if (siteSlug === "journl") {
    return [
      "Country or timezone distribution once Journl stores geo fields on the user profile.",
      "Free-to-paid conversion by signup week and provider.",
      "Cancellation and expiry trend by month for Pro subscriptions.",
      "DAU, WAU, and feature usage once product events are connected.",
    ];
  }
  return [
    "Registered users and sign-up sources from that app's auth system.",
    "Plan or tier mix for free vs paid users.",
    "Active users in 7d and 30d with retention trends.",
    "Traffic, referrers, and geography after analytics is connected.",
  ];
}

function BreakdownPanel({
  title,
  description,
  items,
  countLabel = "users",
}: {
  title: string;
  description: string;
  items: JournlBreakdownItem[];
  countLabel?: string;
}) {
  return (
    <section className="stats-section stats-performance-panel">
      <div className="stats-section__header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="stats-empty">No data available yet.</p>
      ) : (
        <div className="stats-breakdown-list">
          {items.map((item) => (
            <div className="stats-breakdown-row" key={item.key}>
              <div className="stats-breakdown-row__main">
                <strong>{item.label}</strong>
                <span>{item.count} {countLabel}</span>
              </div>
              <span>{formatPercent(item.share)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ArticleAnalyticsTab({ articles, sites, siteStats }: { articles: ArticleRecord[]; sites: Site[]; siteStats: SiteArticleStats[] }) {
  const totals = useMemo(() => ({
    sites: sites.length,
    activeSites: sites.filter((site) => site.status === "active").length,
    articles: articles.length,
    drafts: articles.filter((article) => article.status === "draft").length,
    scheduled: articles.filter((article) => isScheduledArticle(article)).length,
    published: articles.filter((article) => isPublishedArticle(article)).length,
  }), [articles, sites]);

  const recentArticles = useMemo(() => {
    return [...articles]
      .sort((left, right) => {
        const leftTime = new Date(left.published_at ?? left.updated_at).getTime();
        const rightTime = new Date(right.published_at ?? right.updated_at).getTime();
        return rightTime - leftTime;
      })
      .slice(0, 10);
  }, [articles]);

  return (
    <>
      <section className="stats-section stats-performance-panel">
        <div className="stats-section__header">
          <div>
            <h3>Website Overview</h3>
            <p>Publishing status across your connected websites.</p>
          </div>
        </div>
        <div className="stats-grid stats-grid--summary">
          <StatCard label="Websites" value={totals.sites} sub={`${totals.activeSites} active`} accent="blue" />
          <StatCard label="Articles" value={totals.articles} sub="all connected content" accent="green" />
          <StatCard label="Drafts" value={totals.drafts} sub="not published yet" accent="purple" />
          <StatCard label="Scheduled" value={totals.scheduled} sub="waiting to go live" accent="amber" />
        </div>
      </section>

      <section className="stats-section stats-performance-panel">
        <div className="stats-section__header">
          <div>
            <h3>By Website</h3>
            <p>Per-site article counts and the latest publishing activity.</p>
          </div>
        </div>
        {siteStats.length === 0 ? (
          <p className="stats-empty">No websites connected yet. Add sites in Config to start tracking article stats here.</p>
        ) : (
          <div className="stats-account-list" aria-label="Website article status">
            {siteStats.map((item) => (
              <article className="stats-account-row" key={item.site.id}>
                <div className="stats-account-row__identity">
                  <span className="stats-platform-chip">{item.site.slug}</span>
                  <strong>{item.site.name}</strong>
                </div>
                <div className="stats-account-row__metrics">
                  <span><strong>{item.total}</strong> total</span>
                  <span><strong>{item.published}</strong> published</span>
                  <span><strong>{item.scheduled}</strong> scheduled</span>
                  <span><strong>{item.drafts}</strong> drafts</span>
                </div>
                <div className="stats-account-row__meta">
                  <span className={`stats-status-chip stats-status-chip--${item.site.status}`}>{item.site.status}</span>
                  <span>{articleSiteActivitySub(item)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="stats-section stats-performance-panel">
        <div className="stats-section__header">
          <div>
            <h3>Recent Articles</h3>
            <p>Your latest drafts, scheduled pieces, and published articles across all websites.</p>
          </div>
        </div>
        {recentArticles.length === 0 ? (
          <p className="stats-empty">No articles yet.</p>
        ) : (
          <div className="stats-recent-list">
            {recentArticles.map((article) => {
              const labels = sites.filter((site) => article.site_ids.includes(site.id)).map((site) => site.name);
              const status = article.status === "draft" ? "Draft" : isScheduledArticle(article) ? "Scheduled" : "Published";
              const statusClass = status === "Published" ? "published" : status.toLowerCase();
              const timestamp = article.published_at ?? article.updated_at;
              return (
                <article className="stats-recent-post" key={article.id}>
                  <div className="stats-recent-post__main">
                    <div className="stats-recent-post__topline">
                      <span className="stats-platform-chip">{labels[0] ?? "Unassigned"}{labels.length > 1 ? ` +${labels.length - 1}` : ""}</span>
                      <span className={`stats-post-status stats-post-status--${statusClass}`}>{status}</span>
                    </div>
                    <p>{article.title}</p>
                    <div className="stats-post-metrics stats-post-metrics--scheduled" aria-label="Article details">
                      <span><strong>{article.category?.name || "Uncategorized"}</strong>Category</span>
                      <span><strong>{formatDisplayDateTime(timestamp)}</strong>{status === "Draft" ? "Updated" : status === "Scheduled" ? "Scheduled for" : "Published"}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function GeneralSitePanel({
  siteStats,
  journlStats,
  journlStatsLoading,
  journlStatsError,
}: {
  siteStats: SiteArticleStats;
  journlStats: JournlStats | null;
  journlStatsLoading: boolean;
  journlStatsError: string | null;
}) {
  const isJournl = siteStats.site.slug === "journl";
  const paidShare = journlStats ? percentOf(journlStats.subscriptions, journlStats.total_accounts) : 0;
  const publishedShare = percentOf(siteStats.published, siteStats.total);

  return (
    <>
      <section className="stats-section stats-performance-panel">
        <div className="stats-section__header">
          <div>
            <h3>{siteStats.site.name}</h3>
            <p>General site health and whatever live app analytics we can pull right now for {siteStats.site.domain}.</p>
          </div>
        </div>
        <div className="stats-site-meta">
          <span className="stats-platform-chip">{siteStats.site.slug}</span>
          <span>{siteStats.site.domain}</span>
          <span className={`stats-status-chip stats-status-chip--${siteStats.site.status}`}>{siteStats.site.status}</span>
          <span>{articleSiteActivitySub(siteStats)}</span>
        </div>
        <div className="stats-grid stats-grid--summary">
          <StatCard label="Connected Articles" value={siteStats.total} sub={`${siteStats.published} published, ${siteStats.scheduled} scheduled`} accent="blue" />
          <StatCard label="Published Share" value={formatPercent(publishedShare)} sub="of connected content already live" accent="green" />
          <StatCard label="Drafts" value={siteStats.drafts} sub="still in the dashboard queue" accent="purple" />
          <StatCard label="Activity" value={articleSiteActivityLabel(siteStats)} sub={articleSiteActivitySub(siteStats)} accent="amber" />
        </div>
      </section>

      <section className="stats-section stats-performance-panel">
        <div className="stats-section__header">
          <div>
            <h3>App Accounts</h3>
            <p>{isJournl ? "Live account, plan, and sign-in source metrics from Journl's auth users." : `No app-user analytics source is connected yet for ${siteStats.site.name}.`}</p>
          </div>
        </div>
        {isJournl ? (
          journlStatsLoading ? (
            <p className="stats-empty">Loading Journl account stats...</p>
          ) : journlStats ? (
            <div className="stats-grid stats-grid--summary">
              <StatCard label="Registered" value={journlStats.total_accounts} sub="all non-anonymous Journl accounts" accent="blue" />
              <StatCard label="Active 30d" value={journlStats.active_30d} sub={`${journlStats.active_7d} active in 7d`} accent="green" />
              <StatCard label="Paid Plans" value={journlStats.subscriptions} sub={`${formatPercent(paidShare)} of registered users`} accent="amber" />
              <StatCard label="New 30d" value={journlStats.new_30d} sub={`${journlStats.new_7d} joined in 7d`} accent="purple" />
            </div>
          ) : (
            <p className="stats-empty">
              {journlStatsError
                ? `Journl account stats are not connected yet: ${journlStatsError}`
                : "Journl account stats are not connected yet."}
            </p>
          )
        ) : (
          <p className="stats-empty">
            We can already show connected site status and publishing cadence for {siteStats.site.name}. To show registered users, plans, or sign-up sources here, this site needs its auth or analytics backend wired into the dashboard.
          </p>
        )}
      </section>

      {isJournl && journlStats ? (
        <>
          <BreakdownPanel
            title="Plan Breakdown"
            description="Which Journl plans people are currently on."
            items={journlStats.plan_breakdown}
          />
          <BreakdownPanel
            title="Signup Sources"
            description="Based on the first auth provider used to create the account."
            items={journlStats.provider_breakdown}
          />
          <BreakdownPanel
            title="Activity Window"
            description="Recent sign-in activity from Supabase Auth timestamps."
            items={journlStats.activity_breakdown}
          />
          <section className="stats-section stats-performance-panel">
            <div className="stats-section__header">
              <div>
                <h3>Coverage</h3>
                <p>What this Journl panel can and cannot show from the current source.</p>
              </div>
            </div>
            <div className="stats-callout">
              <strong>Available now</strong>
              <p>Registered users, plan mix, cancelled Pro renewals, recent sign-ins, and sign-up source/provider.</p>
            </div>
            <div className="stats-callout">
              <strong>Still missing</strong>
              <p>Country, timezone, referrer, device, and feature-usage analytics need extra tracking or profile fields beyond the current auth data.</p>
            </div>
          </section>
        </>
      ) : null}

      <section className="stats-section stats-performance-panel">
        <div className="stats-section__header">
          <div>
            <h3>Suggested Next Stats</h3>
            <p>The most useful additions after the current source is working.</p>
          </div>
        </div>
        <ul className="stats-suggestion-list">
          {siteSuggestions(siteStats.site.slug).map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

function ArticleStatisticsPage({ articles, sites }: { articles: ArticleRecord[]; sites: Site[] }) {
  const [selectedTab, setSelectedTab] = useState<ArticleStatsTab>("articles");
  const hasJournl = useMemo(() => sites.some((site) => site.slug === "journl"), [sites]);
  const [journlStats, setJournlStats] = useState<JournlStats | null>(null);
  const [journlStatsLoading, setJournlStatsLoading] = useState(false);
  const [journlStatsError, setJournlStatsError] = useState<string | null>(null);
  const siteStats = useMemo(() => buildSiteArticleStats(articles, sites), [articles, sites]);
  const preferredSiteSlug = useMemo(
    () => siteStats.find((item) => item.site.slug === "journl")?.site.slug ?? siteStats[0]?.site.slug ?? "",
    [siteStats],
  );
  const [selectedSiteSlug, setSelectedSiteSlug] = useState(preferredSiteSlug);

  useEffect(() => {
    if (!siteStats.some((item) => item.site.slug === selectedSiteSlug)) {
      setSelectedSiteSlug(preferredSiteSlug);
    }
  }, [preferredSiteSlug, selectedSiteSlug, siteStats]);

  useEffect(() => {
    if (!hasJournl) {
      setJournlStats(null);
      setJournlStatsLoading(false);
      setJournlStatsError(null);
      return;
    }
    let cancelled = false;
    setJournlStatsLoading(true);
    setJournlStatsError(null);
    api.getJournlStats()
      .then((stats) => {
        if (!cancelled) {
          setJournlStats(stats);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setJournlStats(null);
          setJournlStatsError(error instanceof Error ? error.message : "Failed to load Journl app stats.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setJournlStatsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasJournl]);

  const selectedSiteStats = siteStats.find((item) => item.site.slug === selectedSiteSlug) ?? siteStats[0] ?? null;

  return (
    <section className="panel statistics-panel statistics-overview">
      <div className="statistics-overview__content">
        <section className="stats-tabs-panel" aria-label="Statistics sections">
          <div className="stats-tabs-toolbar">
            <div className="stats-tabs-row">
              <SectionTabs<ArticleStatsTab>
                activeId={selectedTab}
                ariaLabel="Article statistics sections"
                className="social-platform-tabs stats-tabs-list"
                tabClassName="social-tab"
                activeTabClassName="social-tab--active"
                onChange={setSelectedTab}
                items={[
                  { id: "articles", label: "Articles", badge: articles.length },
                  { id: "general", label: "General", badge: siteStats.length },
                ]}
              />
            </div>
          </div>
        </section>

        {selectedTab === "articles" ? (
          <ArticleAnalyticsTab articles={articles} sites={sites} siteStats={siteStats} />
        ) : (
          <>
            {siteStats.length > 0 ? (
              <section className="stats-tabs-panel" aria-label="General statistics filters">
                <div className="stats-tabs-toolbar">
                  <div className="stats-tabs-row stats-tabs-row--account">
                    <span className="stats-tabs-label">Website</span>
                    <SectionTabs
                      activeId={selectedSiteSlug}
                      ariaLabel="Website general statistics"
                      className="social-platform-tabs stats-tabs-list"
                      tabClassName="social-tab"
                      activeTabClassName="social-tab--active"
                      onChange={setSelectedSiteSlug}
                      items={siteStats.map((item) => ({
                        id: item.site.slug,
                        label: item.site.slug,
                        badge: item.total,
                        title: item.site.domain,
                      }))}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {selectedSiteStats ? (
              <GeneralSitePanel
                siteStats={selectedSiteStats}
                journlStats={journlStats}
                journlStatsLoading={journlStatsLoading}
                journlStatsError={journlStatsError}
              />
            ) : (
              <p className="stats-empty">No websites connected yet. Add sites in Config to start building general analytics here.</p>
            )}
          </>
        )}
      </div>
    </section>
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

function MarketingStatisticsPage() {
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
              <div className="stats-tabs-toolbar">
                <div className="stats-tabs-row stats-tabs-row--platform">
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

                  {selectedPlatform === "all" ? (
                    <button
                      className="button-secondary dashboard-icon-button stats-refresh-button"
                      onClick={() => void load({ silent: true })}
                      disabled={refreshing}
                      aria-label="Refresh statistics"
                      title="Refresh"
                    >
                      <ArrowPathIcon aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
                    </button>
                  ) : null}
                </div>

                {selectedPlatform !== "all" ? (
                  <div className="stats-tabs-row stats-tabs-row--account">
                    <button
                      className="button-secondary dashboard-icon-button stats-refresh-button"
                      onClick={() => void load({ silent: true })}
                      disabled={refreshing}
                      aria-label="Refresh statistics"
                      title="Refresh"
                    >
                      <ArrowPathIcon aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
                    </button>
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
                        },
                        ...platformStats.map((item) => ({
                          id: accountKey(item.account),
                          label: item.account.username ? `@${item.account.username}` : `Account ${item.account.id}`,
                          leading: <PlatformIcon platform={item.account.platform} />,
                        })),
                      ]}
                    />
                  </div>
                ) : null}
              </div>
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
              <div className="stats-account-list" aria-label="Account publishing status">
                {visibleStats.map((item) => {
                  const accountName = item.account.username ? `@${item.account.username}` : `Account ${item.account.id}`;
                  return (
                    <article className="stats-account-row" key={accountKey(item.account)}>
                      <div className="stats-account-row__identity">
                        <span className="stats-platform-chip">
                          <PlatformIcon platform={item.account.platform} />
                          {platformLabel(item.account.platform)}
                        </span>
                        <strong>{accountName}</strong>
                      </div>
                      <div className="stats-account-row__metrics">
                        <span><strong>{item.publishedPosts}</strong> published</span>
                        <span><strong>{item.scheduledPosts}</strong> scheduled</span>
                        <span><strong>{item.draftPosts}</strong> draft/approved</span>
                        <span><strong>{item.failedPosts}</strong> failed</span>
                      </div>
                      <div className="stats-account-row__meta">
                        <span className={`stats-status-chip stats-status-chip--${item.account.status}`}>{item.account.status}</span>
                        <span>{item.lastPostAt ? `Latest ${formatDisplayDateTime(item.lastPostAt)}` : "No posts yet"}</span>
                      </div>
                    </article>
                  );
                })}
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

export function StatisticsPage({ surface = "marketing", articles = [], sites = [] }: StatisticsPageProps) {
  if (surface === "articles") {
    return <ArticleStatisticsPage articles={articles} sites={sites} />;
  }
  return <MarketingStatisticsPage />;
}
