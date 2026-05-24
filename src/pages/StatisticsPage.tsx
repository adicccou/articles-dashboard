import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { formatDisplayDateTime } from "../lib/datetime";
import type { StudioAccount, StudioStrategistPost, StudioSummary } from "../lib/types";
import "../styles/statistics-page.css";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "blue" | "amber" | "purple" | "red";
}) {
  return (
    <div className={`stat-card ${accent ? `stat-card--${accent}` : ""}`}>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {sub ? <span className="stat-card__sub">{sub}</span> : null}
    </div>
  );
}

function platformLabel(platform: StudioAccount["platform"]) {
  if (platform === "twitter") return "Twitter/X";
  if (platform === "threads") return "Threads";
  return "Reddit";
}

function postStatusLabel(status: StudioStrategistPost["status"]) {
  if (status === "asset_needed") return "Asset needed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function recentSort<T extends { scheduled_at?: string | null; created_at: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftDate = left.scheduled_at ?? left.created_at;
    const rightDate = right.scheduled_at ?? right.created_at;
    return new Date(rightDate).getTime() - new Date(leftDate).getTime();
  });
}

export function StatisticsPage() {
  const [studio, setStudio] = useState<StudioSummary | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load({ silent = false } = {}) {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const nextStudio = await api.getStudio();
      setStudio(nextStudio);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load statistics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const apps = useMemo(
    () => (studio?.apps ?? []).filter((app) => app.status !== "archived"),
    [studio],
  );

  useEffect(() => {
    if (apps.length === 0) {
      setSelectedAppId(null);
      return;
    }

    if (!apps.some((app) => app.id === selectedAppId)) {
      setSelectedAppId(apps[0]?.id ?? null);
    }
  }, [apps, selectedAppId]);

  const selectedApp = useMemo(
    () => apps.find((app) => app.id === selectedAppId) ?? null,
    [apps, selectedAppId],
  );

  const appCampaigns = useMemo(() => {
    if (!selectedApp || !studio) return [];
    return studio.campaigns.filter((campaign) => campaign.app_id === selectedApp.id && campaign.status !== "archived");
  }, [selectedApp, studio]);

  const appPosts = useMemo(() => {
    if (!selectedApp || !studio) return [];
    return recentSort(
      studio.strategist_posts.filter((post) => post.app_id === selectedApp.id && post.status !== "dismissed"),
    );
  }, [selectedApp, studio]);

  const connectedAccounts = useMemo(() => {
    if (!studio) return [];
    const refs = new Set(appCampaigns.flatMap((campaign) => campaign.account_refs));
    return studio.accounts.filter((account) => refs.has(account.ref));
  }, [appCampaigns, studio]);

  const activePlatforms = useMemo(
    () => Array.from(new Set(appCampaigns.flatMap((campaign) => campaign.platforms))),
    [appCampaigns],
  );

  const selectedMetrics = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const scheduledThisMonth = appPosts.filter((post) => {
      if (!post.scheduled_at) return false;
      const scheduled = new Date(post.scheduled_at);
      return scheduled.getMonth() === currentMonth && scheduled.getFullYear() === currentYear;
    }).length;

    return {
      totalPosts: appPosts.length,
      suggestedPosts: appPosts.filter((post) => post.status === "suggested" || post.status === "asset_needed").length,
      scheduledPosts: appPosts.filter((post) => post.status === "scheduled").length,
      postedPosts: appPosts.filter((post) => post.status === "posted").length,
      scheduledThisMonth,
      campaigns: appCampaigns.length,
      connectedAccounts: connectedAccounts.length,
    };
  }, [appCampaigns, appPosts, connectedAccounts]);

  if (loading) {
    return <div className="stats-loading">Loading statistics...</div>;
  }

  return (
    <section className="panel statistics-panel">
      <div className="panel__title-row">
        <h2>Statistics</h2>
        <button className="button-secondary" onClick={() => void load({ silent: true })} disabled={refreshing}>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div className="stats-error">{error}</div> : null}

      {apps.length === 0 ? (
        <div className="stats-loading">No apps yet. Add an app in Config to see post statistics here.</div>
      ) : (
        <>
          <div className="ui-tabs__list project-selector">
            {apps.map((app) => (
              <button
                key={app.id}
                className={selectedAppId === app.id ? "ui-tab project-tab ui-tab--active project-tab--active" : "ui-tab project-tab"}
                onClick={() => setSelectedAppId(app.id)}
              >
                {app.name}
              </button>
            ))}
          </div>

          {selectedApp ? (
            <>
              <div className="stats-context">
                <div>
                  <h3>{selectedApp.name} Posts</h3>
                  <p className="stats-context__copy">
                    {selectedApp.description?.trim() || "Post output, connected accounts, and campaign coverage for this app."}
                  </p>
                </div>
                <div className="stats-context__meta">
                  <span className={`stats-status-chip stats-status-chip--${selectedApp.status}`}>{selectedApp.status}</span>
                  {selectedApp.website_url ? (
                    <a href={selectedApp.website_url} target="_blank" rel="noreferrer">
                      Website
                    </a>
                  ) : null}
                  {selectedApp.app_store_url ? (
                    <a href={selectedApp.app_store_url} target="_blank" rel="noreferrer">
                      App
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="stats-grid stats-grid--posts">
                <StatCard
                  label="Posts"
                  value={selectedMetrics.totalPosts}
                  sub={`${selectedMetrics.suggestedPosts} waiting on review or assets`}
                  accent="blue"
                />
                <StatCard
                  label="Scheduled"
                  value={selectedMetrics.scheduledPosts}
                  sub={`${selectedMetrics.scheduledThisMonth} this month`}
                  accent="amber"
                />
                <StatCard
                  label="Posted"
                  value={selectedMetrics.postedPosts}
                  sub="published from strategist output"
                  accent="green"
                />
                <StatCard
                  label="Campaigns"
                  value={selectedMetrics.campaigns}
                  sub="active or paused for this app"
                  accent="purple"
                />
                <StatCard
                  label="Connected Accounts"
                  value={selectedMetrics.connectedAccounts}
                  sub={activePlatforms.length > 0 ? activePlatforms.map((platform) => platformLabel(platform)).join(" · ") : "No platforms connected"}
                  accent="red"
                />
              </div>

              <div className="stats-tag-panels">
                <section className="stats-tag-panel">
                  <div className="panel__title-row">
                    <h3>Connected Social Media</h3>
                    <span className="stats-count-pill">{connectedAccounts.length}</span>
                  </div>
                  {connectedAccounts.length === 0 ? (
                    <p className="stats-empty">No social accounts connected through campaigns yet.</p>
                  ) : (
                    <div className="stats-tag-list">
                      {connectedAccounts.map((account) => (
                        <span className="stats-tag" key={account.ref}>
                          {platformLabel(account.platform)}: @{account.username}
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                <section className="stats-tag-panel">
                  <div className="panel__title-row">
                    <h3>Campaigns</h3>
                    <span className="stats-count-pill">{appCampaigns.length}</span>
                  </div>
                  {appCampaigns.length === 0 ? (
                    <p className="stats-empty">No campaigns yet.</p>
                  ) : (
                    <div className="stats-tag-list">
                      {appCampaigns.map((campaign) => (
                        <span className="stats-tag stats-tag--campaign" key={campaign.id}>
                          {campaign.name}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <section className="stats-posts-section">
                <div className="panel__title-row">
                  <div>
                    <h3>Posts</h3>
                    <p className="muted">Recent strategist output for {selectedApp.name}.</p>
                  </div>
                  <span className="stats-count-pill">{appPosts.length}</span>
                </div>

                {appPosts.length === 0 ? (
                  <p className="stats-empty">No posts yet for this app.</p>
                ) : (
                  <div className="stats-post-list">
                    <div className="stats-post-list__row stats-post-list__row--header">
                      <span>Post</span>
                      <span>Platform</span>
                      <span>Status</span>
                      <span>Campaign</span>
                      <span>Scheduled</span>
                    </div>
                    {appPosts.slice(0, 12).map((post) => (
                      <div className="stats-post-list__row" key={post.id}>
                        <span>
                          <strong>{post.post_text}</strong>
                          {post.target_text ? <small>{post.target_text}</small> : null}
                        </span>
                        <span>{platformLabel(post.platform)}</span>
                        <span>
                          <span className={`stats-post-status stats-post-status--${post.status}`}>
                            {postStatusLabel(post.status)}
                          </span>
                        </span>
                        <span>{post.campaign_name || "Manual"}</span>
                        <span>{post.scheduled_at ? formatDisplayDateTime(post.scheduled_at) : "Not scheduled"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
