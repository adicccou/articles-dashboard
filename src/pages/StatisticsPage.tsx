import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { api } from "../lib/api";
import type { RedditAccount, SocialAccount, SocialComment, SocialPost } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import "../styles/statistics-page.css";

type Platform = SocialPost["platform"];
type Account = Pick<SocialAccount, "id" | "platform" | "username" | "status" | "tags">;
type AccountStats = {
  account: Account;
  posts: SocialPost[];
  comments: SocialComment[];
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  draftPosts: number;
  failedPosts: number;
  commentsCount: number;
  repliesSent: number;
  lastPostAt: string | null;
};

const PLATFORMS: Platform[] = ["twitter", "threads", "reddit", "instagram", "linkedin", "facebook", "youtube"];
const COMMENT_PLATFORMS = new Set<Platform>(["twitter", "threads", "reddit"]);
const INSIGHT_METRICS = ["Views", "Likes", "Shares"];
const REQUEST_TIMEOUT_MS = 20000;

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

      setAccounts(activeAccounts);
      setPosts(allPosts);
      setCommentsByAccount(Object.fromEntries(commentEntries));
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
      return {
        account,
        posts: accountPosts,
        comments: accountComments,
        totalPosts: accountPosts.length,
        publishedPosts: accountPosts.filter((post) => post.status === "posted").length,
        scheduledPosts: accountPosts.filter((post) => post.status === "scheduled").length,
        draftPosts: accountPosts.filter((post) => post.status === "draft" || post.status === "approved").length,
        failedPosts: accountPosts.filter((post) => post.status === "failed").length,
        commentsCount: accountComments.length,
        repliesSent: accountComments.filter((comment) => comment.reply_status === "replied" || comment.owner_reply_text).length,
        lastPostAt: latestDate(accountPosts),
      };
    }).sort((left, right) => right.publishedPosts - left.publishedPosts || right.totalPosts - left.totalPosts);
  }, [accounts, commentsByAccount, posts]);

  const totals = useMemo(() => ({
    accounts: statsByAccount.length,
    posts: statsByAccount.reduce((sum, item) => sum + item.totalPosts, 0),
    published: statsByAccount.reduce((sum, item) => sum + item.publishedPosts, 0),
    scheduled: statsByAccount.reduce((sum, item) => sum + item.scheduledPosts, 0),
    comments: statsByAccount.reduce((sum, item) => sum + item.commentsCount, 0),
    replies: statsByAccount.reduce((sum, item) => sum + item.repliesSent, 0),
  }), [statsByAccount]);

  const recentPosts = useMemo(() => {
    return [...posts]
      .sort((left, right) => new Date(right.posted_at || right.scheduled_at || right.updated_at || right.created_at).getTime() - new Date(left.posted_at || left.scheduled_at || left.updated_at || left.created_at).getTime())
      .slice(0, 8);
  }, [posts]);

  if (loading) return <div className="stats-loading">Loading social statistics...</div>;

  return (
    <section className="panel statistics-panel statistics-overview">
      <div className="statistics-overview__bar">
        <div className="panel__title-row">
          <div>
            <h2>Social Media Statistics</h2>
            <p className="statistics-overview__subtitle">Account-level publishing and reply performance across connected social platforms.</p>
          </div>
          <button
            className="button-secondary dashboard-icon-button"
            onClick={() => void load({ silent: true })}
            disabled={refreshing}
            aria-label="Refresh statistics"
            title="Refresh"
          >
            <ArrowPathIcon aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="statistics-overview__content">
        {error ? <div className="stats-error">{error}</div> : null}

        {statsByAccount.length === 0 ? (
          <div className="stats-loading">No active social accounts yet. Add accounts in Config to see social media statistics here.</div>
        ) : (
          <>
            <div className="stats-grid stats-grid--summary">
              <StatCard label="Accounts" value={totals.accounts} sub="active accounts in Config" accent="blue" />
              <StatCard label="Published Posts" value={totals.published} sub={`${totals.posts} total created`} accent="green" />
              <StatCard label="Scheduled" value={totals.scheduled} sub="waiting to publish" accent="amber" />
              <StatCard label="Comments" value={totals.comments} sub={`${totals.replies} replied`} accent="purple" />
            </div>

            <section className="stats-section">
              <div className="stats-section__header">
                <div>
                  <h3>Account Performance</h3>
                  <p>Each card shows the publishing health and available engagement for one connected account.</p>
                </div>
              </div>
              <div className="stats-account-grid">
                {statsByAccount.map((item) => (
                  <article className="stats-account-card" key={accountKey(item.account)}>
                    <div className="stats-account-card__header">
                      <div>
                        <span className="stats-platform-chip">{platformLabel(item.account.platform)}</span>
                        <h4>{item.account.username ? `@${item.account.username}` : `Account ${item.account.id}`}</h4>
                      </div>
                      <span className={`stats-status-chip stats-status-chip--${item.account.status}`}>{item.account.status}</span>
                    </div>
                    <div className="stats-account-card__metrics">
                      <span><strong>{item.publishedPosts}</strong> published</span>
                      <span><strong>{item.scheduledPosts}</strong> scheduled</span>
                      <span><strong>{item.commentsCount}</strong> comments</span>
                      <span><strong>{item.repliesSent}</strong> replies sent</span>
                    </div>
                    <div className="stats-insight-row">
                      {INSIGHT_METRICS.map((metric) => (
                        <span key={metric}><strong>-</strong>{metric}</span>
                      ))}
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
                  <h3>Post Performance By Account</h3>
                  <p>Views, likes, and shares need platform insights APIs before exact numbers can be shown.</p>
                </div>
              </div>
              <div className="stats-table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Total</th>
                      <th>Published</th>
                      <th>Scheduled</th>
                      <th>Draft/Approved</th>
                      <th>Failed</th>
                      <th>Comments</th>
                      <th>Views</th>
                      <th>Likes</th>
                      <th>Shares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsByAccount.map((item) => (
                      <tr key={accountKey(item.account)}>
                        <td>{accountLabel(item.account)}</td>
                        <td>{item.totalPosts}</td>
                        <td>{item.publishedPosts}</td>
                        <td>{item.scheduledPosts}</td>
                        <td>{item.draftPosts}</td>
                        <td>{item.failedPosts}</td>
                        <td>{item.commentsCount}</td>
                        <td className="stats-unavailable">Not connected</td>
                        <td className="stats-unavailable">Not connected</td>
                        <td className="stats-unavailable">Not connected</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="stats-section stats-recent-section">
              <div className="stats-section__header">
                <div>
                  <h3>Recent Social Posts</h3>
                  <p>Latest created, scheduled, and published posts across all connected social accounts.</p>
                </div>
              </div>
              {recentPosts.length === 0 ? (
                <p className="stats-empty">No social posts yet.</p>
              ) : (
                <div className="stats-recent-list">
                  {recentPosts.map((post) => (
                    <article className="stats-recent-post" key={`${post.platform}:${post.id}`}>
                      <div>
                        <span className="stats-platform-chip">{platformLabel(post.platform)}</span>
                        <p>{post.content || post.title || "Untitled post"}</p>
                      </div>
                      <span className={`stats-post-status stats-post-status--${post.status}`}>{post.status}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
