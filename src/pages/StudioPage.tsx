import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { StudioAccount, StudioApp, StudioStrategistPost, StudioSummary } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import "../styles/studio-page.css";

type StudioTab = "crawler" | "strategist";
type Platform = "twitter" | "threads" | "reddit";

type StudioPageProps = {
  onUpload: (file: File) => Promise<{ key: string; url: string }>;
};

type AppForm = {
  id?: number;
  name: string;
  website_url: string;
  app_store_url: string;
  description: string;
  ai_context: string;
  status: StudioApp["status"];
};

type CampaignForm = {
  name: string;
  campaign_type: "post" | "reply";
  app_id: string;
  account_refs: string[];
  platforms: Platform[];
  instructions: string;
};

const PLATFORMS: Array<{ id: Platform; label: string }> = [
  { id: "twitter", label: "Twitter/X" },
  { id: "threads", label: "Threads" },
  { id: "reddit", label: "Reddit" },
];

function emptyAppForm(): AppForm {
  return {
    name: "",
    website_url: "",
    app_store_url: "",
    description: "",
    ai_context: "",
    status: "active",
  };
}

function emptyCampaignForm(): CampaignForm {
  return {
    name: "",
    campaign_type: "post",
    app_id: "",
    account_refs: [],
    platforms: ["threads"],
    instructions: "",
  };
}

function studioId(prefix: string, id: number) {
  return `${prefix}-${String(id).padStart(4, "0")}`;
}

function platformLabel(platform: string) {
  if (platform === "twitter") return "Twitter/X";
  if (platform === "threads") return "Threads";
  if (platform === "reddit") return "Reddit";
  return platform;
}

function statusTone(status: string) {
  if (["active", "completed", "scheduled", "posted"].includes(status)) return "success";
  if (["pending", "running", "suggested", "asset_needed"].includes(status)) return "info";
  if (["failed", "archived"].includes(status)) return "danger";
  return "neutral";
}

function toggleArrayValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function accountMatchesPlatforms(account: StudioAccount, platforms: Platform[]) {
  return platforms.length === 0 || platforms.includes(account.platform);
}

export function StudioPage({ onUpload }: StudioPageProps) {
  const [summary, setSummary] = useState<StudioSummary>({
    accounts: [],
    apps: [],
    campaigns: [],
    crawler_runs: [],
    strategist_posts: [],
  });
  const [tab, setTab] = useState<StudioTab>("crawler");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [appForm, setAppForm] = useState<AppForm>(emptyAppForm);
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(emptyCampaignForm);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [uploadingPostId, setUploadingPostId] = useState<number | null>(null);
  const [schedulingPostId, setSchedulingPostId] = useState<number | null>(null);

  async function load({ silent = false } = {}) {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const next = await api.getStudio();
      setSummary({
        accounts: Array.isArray(next.accounts) ? next.accounts : [],
        apps: Array.isArray(next.apps) ? next.apps : [],
        campaigns: Array.isArray(next.campaigns) ? next.campaigns : [],
        crawler_runs: Array.isArray(next.crawler_runs) ? next.crawler_runs : [],
        strategist_posts: Array.isArray(next.strategist_posts) ? next.strategist_posts : [],
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Studio");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (selectedRunId !== null) return;
    const latestCompleted = summary.crawler_runs.find((run) => run.status === "completed");
    if (latestCompleted) setSelectedRunId(latestCompleted.id);
  }, [selectedRunId, summary.crawler_runs]);

  const strategistRuns = useMemo(
    () => summary.crawler_runs.filter((run) => run.status === "completed" || run.status === "failed" || run.status === "running"),
    [summary.crawler_runs],
  );

  const selectedRun = useMemo(
    () => summary.crawler_runs.find((run) => run.id === selectedRunId) ?? strategistRuns[0] ?? null,
    [selectedRunId, strategistRuns, summary.crawler_runs],
  );

  const selectedRunPosts = useMemo(
    () => selectedRun
      ? summary.strategist_posts.filter((post) => post.crawler_run_id === selectedRun.id)
      : [],
    [selectedRun, summary.strategist_posts],
  );

  const campaignAccounts = useMemo(
    () => summary.accounts.filter((account) => accountMatchesPlatforms(account, campaignForm.platforms)),
    [campaignForm.platforms, summary.accounts],
  );

  function openCampaignModal() {
    setCampaignForm(emptyCampaignForm());
    setCampaignModalOpen(true);
    setFeedback(null);
    setError(null);
  }

  function openSettingsModal() {
    setSettingsModalOpen(true);
    setFeedback(null);
    setError(null);
  }

  async function saveApp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appForm.name.trim()) {
      setError("App name is required.");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        name: appForm.name.trim(),
        website_url: appForm.website_url.trim() || null,
        app_store_url: appForm.app_store_url.trim() || null,
        description: appForm.description.trim(),
        ai_context: appForm.ai_context.trim(),
        status: appForm.status,
      };
      if (appForm.id) {
        await api.updateStudioApp(appForm.id, payload);
        setFeedback("App updated.");
      } else {
        await api.createStudioApp(payload);
        setFeedback("App added.");
      }
      setAppForm(emptyAppForm());
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save app");
    } finally {
      setSaving(false);
    }
  }

  async function deleteApp(app: StudioApp) {
    if (!confirm(`Delete ${app.name}?`)) return;
    try {
      setSaving(true);
      await api.deleteStudioApp(app.id);
      if (appForm.id === app.id) setAppForm(emptyAppForm());
      setFeedback("App deleted.");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete app");
    } finally {
      setSaving(false);
    }
  }

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignForm.name.trim() || !campaignForm.app_id) {
      setError("Campaign name and app are required.");
      return;
    }
    if (campaignForm.platforms.length === 0) {
      setError("Select at least one social platform.");
      return;
    }
    if (campaignForm.account_refs.length === 0) {
      setError("Select at least one connected account.");
      return;
    }
    if (!campaignForm.instructions.trim()) {
      setError("Pain Crawler instructions are required.");
      return;
    }
    try {
      setSaving(true);
      const campaign = await api.createStudioCampaign({
        name: campaignForm.name.trim(),
        app_id: Number(campaignForm.app_id),
        campaign_type: campaignForm.campaign_type,
        account_refs: campaignForm.account_refs,
        platforms: campaignForm.platforms,
        instructions: campaignForm.instructions.trim(),
      });
      const run = await api.createStudioCrawlerRun({
        campaign_id: campaign.id,
      });
      setSelectedRunId(run.id);
      setTab("strategist");
      setCampaignModalOpen(false);
      setCampaignForm(emptyCampaignForm());
      setFeedback(`${studioId("CMP", campaign.id)} created and ${studioId("CR", run.id)} queued.`);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setSaving(false);
    }
  }

  async function uploadMediaForPost(post: StudioStrategistPost, file: File) {
    try {
      setUploadingPostId(post.id);
      const uploaded = await onUpload(file);
      await api.updateStudioStrategistPost(post.id, { media_url: uploaded.url });
      setFeedback("Media attached.");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload media");
    } finally {
      setUploadingPostId(null);
    }
  }

  async function scheduleSuggestion(post: StudioStrategistPost) {
    try {
      setSchedulingPostId(post.id);
      const result = await api.scheduleStudioStrategistPost(post.id, {
        media_url: post.media_url || null,
      });
      setFeedback(`Scheduled for ${formatDisplayDateTime(result.scheduled_at)}.`);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule post");
    } finally {
      setSchedulingPostId(null);
    }
  }

  if (loading) {
    return <section className="panel">Loading Studio...</section>;
  }

  return (
    <div className="studio-page stack">
      {error ? <p className="error panel">{error}</p> : null}
      {feedback ? <p className="studio-feedback panel">{feedback}</p> : null}

      <section className="studio-topbar panel">
        <div>
          <p className="eyebrow">Studio</p>
          <h1>Marketing Automation</h1>
        </div>
        <div className="studio-topbar__actions">
          <button className="studio-icon-button" type="button" onClick={openSettingsModal} aria-label="Open Studio settings" title="Apps settings">
            ⚙
          </button>
          <button type="button" onClick={openCampaignModal}>
            Create campaign
          </button>
          <button className="button-secondary" type="button" disabled={refreshing} onClick={() => void load({ silent: true })}>
            Refresh
          </button>
        </div>
      </section>

      <section className="panel studio-tabs">
        {[
          { id: "crawler" as const, label: `Pain Crawler (${summary.crawler_runs.length})` },
          { id: "strategist" as const, label: `Strategist (${summary.strategist_posts.length})` },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`studio-tab ${tab === item.id ? "studio-tab--active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </section>

      <section className="panel studio-campaigns">
        <div className="panel__title-row">
          <h2>Campaigns</h2>
          <span className="studio-count">{summary.campaigns.length}</span>
        </div>
        {summary.campaigns.length === 0 ? (
          <div className="studio-empty">No campaigns yet.</div>
        ) : (
          <div className="studio-card-grid studio-card-grid--campaigns">
            {summary.campaigns.map((campaign) => (
              <article className="studio-card" key={campaign.id}>
                <div className="studio-card__header">
                  <span className="studio-id">{studioId("CMP", campaign.id)}</span>
                  <span className={`studio-pill studio-pill--${statusTone(campaign.status)}`}>{campaign.status}</span>
                </div>
                <h2>{campaign.name}</h2>
                <p className="studio-muted">{campaign.app_name || `App #${campaign.app_id}`}</p>
                <div className="studio-chip-row">
                  <span className="studio-chip">{campaign.campaign_type === "reply" ? "Reply" : "Post"}</span>
                  {campaign.platforms.map((platform) => (
                    <span className="studio-chip" key={platform}>{platformLabel(platform)}</span>
                  ))}
                </div>
                <p className="studio-card__copy">{campaign.instructions || "No instructions saved."}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {tab === "crawler" ? (
        <section className="panel studio-crawler-panel">
          <div className="panel__title-row">
            <h2>Pain Crawler</h2>
            <span className="studio-count">{summary.crawler_runs.length}</span>
          </div>
          {summary.crawler_runs.length === 0 ? (
            <div className="studio-empty">No crawler runs yet. Create a campaign to queue the first run.</div>
          ) : (
            <div className="studio-card-grid">
              {summary.crawler_runs.map((run) => (
                <article className="studio-card" key={run.id}>
                  <div className="studio-card__header">
                    <span className="studio-id">{studioId("CR", run.id)}</span>
                    <span className={`studio-pill studio-pill--${statusTone(run.status)}`}>{run.status}</span>
                  </div>
                  <h2>{run.campaign_name || run.app_name || `App #${run.app_id}`}</h2>
                  <div className="studio-chip-row">
                    <span className="studio-chip">{run.campaign_type === "reply" ? "Reply" : "Post"}</span>
                    {run.platforms.map((platform) => (
                      <span className="studio-chip" key={platform}>{platformLabel(platform)}</span>
                    ))}
                  </div>
                  <p className="studio-card__copy">{run.crawler_summary || run.instructions}</p>
                  {run.error_message ? <p className="error">{run.error_message}</p> : null}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "strategist" ? (
        <section className="studio-strategist-layout">
          <aside className="panel studio-run-list">
            <div className="panel__title-row">
              <h2>Crawler results</h2>
            </div>
            {strategistRuns.length === 0 ? (
              <p className="studio-muted">No crawler results yet.</p>
            ) : strategistRuns.map((run) => (
              <button
                className={`studio-run-button ${selectedRun?.id === run.id ? "studio-run-button--active" : ""}`}
                key={run.id}
                type="button"
                onClick={() => setSelectedRunId(run.id)}
              >
                <span>{studioId("CR", run.id)}</span>
                <small>{run.app_name || run.campaign_name || run.status}</small>
              </button>
            ))}
          </aside>

          <section className="panel studio-strategist-panel">
            {selectedRun ? (
              <>
                <div className="panel__title-row">
                  <div>
                    <p className="eyebrow">{studioId("CR", selectedRun.id)}</p>
                    <h2>{selectedRun.campaign_name || selectedRun.app_name || "Crawler result"}</h2>
                  </div>
                  <span className={`studio-pill studio-pill--${statusTone(selectedRun.status)}`}>{selectedRun.status}</span>
                </div>
                {selectedRun.crawler_summary ? <p className="studio-card__copy">{selectedRun.crawler_summary}</p> : null}
                {selectedRun.error_message ? <p className="error">{selectedRun.error_message}</p> : null}
                {selectedRunPosts.length === 0 ? (
                  <div className="studio-empty">Strategist posts will appear here after the crawler finishes.</div>
                ) : (
                  <div className="studio-post-grid">
                    {selectedRunPosts.map((post) => {
                      const isReply = selectedRun.campaign_type === "reply";
                      const needsMedia = post.media_type === "photo" || post.media_type === "video";
                      const canSchedule = post.status !== "scheduled"
                        && (!needsMedia || Boolean(post.media_url))
                        && (!isReply || Boolean(post.target_external_id));
                      return (
                        <article className="studio-post-card" key={post.id}>
                          <div className="studio-card__header">
                            <span className="studio-id">{studioId("SP", post.id)}</span>
                            <span className={`studio-pill studio-pill--${statusTone(post.status)}`}>{post.status}</span>
                          </div>
                          <div className="studio-chip-row">
                            <span className="studio-chip">{platformLabel(post.platform)}</span>
                            <span className="studio-chip">{isReply ? "Reply" : "Post"}</span>
                            <span className="studio-chip">{post.media_type === "none" ? "Text" : post.media_type}</span>
                          </div>
                          <h2>{post.idea || "Post idea"}</h2>
                          {isReply ? (
                            <div className="studio-target-box">
                              <strong>Target</strong>
                              {post.target_url ? (
                                <a href={post.target_url} target="_blank" rel="noreferrer">{post.target_url}</a>
                              ) : (
                                <span>No target link</span>
                              )}
                              {post.target_author ? <span>@{post.target_author}</span> : null}
                              {post.target_text ? <p>{post.target_text}</p> : null}
                            </div>
                          ) : null}
                          <p className="studio-post-card__text">{post.post_text}</p>
                          <div className="studio-why">
                            <strong>Why</strong>
                            <p>{post.rationale || "No strategist note."}</p>
                          </div>
                          {needsMedia ? (
                            <div className="studio-media-box">
                              {post.media_url ? (
                                post.media_type === "video" ? (
                                  <video src={post.media_url} controls />
                                ) : (
                                  <img src={post.media_url} alt={`${post.idea || "Studio post"} media`} />
                                )
                              ) : (
                                <span>{post.media_type} needed</span>
                              )}
                              <label className="studio-upload-button">
                                <input
                                  type="file"
                                  accept={post.media_type === "video" ? "video/*" : "image/*"}
                                  disabled={uploadingPostId === post.id}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void uploadMediaForPost(post, file);
                                  }}
                                />
                                {uploadingPostId === post.id ? "Uploading..." : post.media_url ? "Replace media" : "Upload media"}
                              </label>
                            </div>
                          ) : null}
                          <button type="button" disabled={!canSchedule || schedulingPostId === post.id} onClick={() => void scheduleSuggestion(post)}>
                            {post.status === "scheduled" ? "Scheduled" : schedulingPostId === post.id ? "Scheduling..." : "Autoschedule it"}
                          </button>
                          {isReply && !post.target_external_id ? <p className="error">Missing reply target ID.</p> : null}
                          {post.scheduled_at ? <p className="studio-muted">{formatDisplayDateTime(post.scheduled_at)}</p> : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="studio-empty">No strategist run selected.</div>
            )}
          </section>
        </section>
      ) : null}

      {settingsModalOpen ? (
        <div className="studio-modal-backdrop">
          <section className="studio-modal studio-modal--wide panel">
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">Studio settings</p>
                <h2>Apps</h2>
              </div>
              <button className="button-secondary" type="button" onClick={() => setSettingsModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="studio-app-settings">
              <form className="studio-form studio-settings-form" onSubmit={saveApp}>
                <div className="panel__title-row">
                  <h2>{appForm.id ? "Edit app" : "Add app"}</h2>
                  {appForm.id ? (
                    <button className="button-secondary" type="button" onClick={() => setAppForm(emptyAppForm())}>
                      Cancel edit
                    </button>
                  ) : null}
                </div>
                <label>
                  App name
                  <input value={appForm.name} onChange={(event) => setAppForm((current) => ({ ...current, name: event.target.value }))} required />
                </label>
                <div className="grid-two">
                  <label>
                    Website
                    <input value={appForm.website_url} onChange={(event) => setAppForm((current) => ({ ...current, website_url: event.target.value }))} />
                  </label>
                  <label>
                    App store URL
                    <input value={appForm.app_store_url} onChange={(event) => setAppForm((current) => ({ ...current, app_store_url: event.target.value }))} />
                  </label>
                </div>
                <label>
                  App info
                  <textarea rows={4} value={appForm.description} onChange={(event) => setAppForm((current) => ({ ...current, description: event.target.value }))} />
                </label>
                <label>
                  AI context
                  <textarea rows={5} value={appForm.ai_context} onChange={(event) => setAppForm((current) => ({ ...current, ai_context: event.target.value }))} />
                </label>
                <button type="submit" disabled={saving}>
                  {saving ? "Saving..." : appForm.id ? "Save app" : "Add app"}
                </button>
              </form>

              <div className="studio-app-list">
                <div className="panel__title-row">
                  <h2>App list</h2>
                  <span className="studio-count">{summary.apps.length}</span>
                </div>
                {summary.apps.length === 0 ? (
                  <div className="studio-empty">No apps yet.</div>
                ) : (
                  <div className="studio-card-grid">
                    {summary.apps.map((app) => (
                      <article className="studio-card" key={app.id}>
                        <div className="studio-card__header">
                          <span className="studio-id">{studioId("APP", app.id)}</span>
                          <span className={`studio-pill studio-pill--${statusTone(app.status)}`}>{app.status}</span>
                        </div>
                        <h2>{app.name}</h2>
                        <p className="studio-card__copy">{app.description || "No app info yet."}</p>
                        {app.ai_context ? <p className="studio-muted">{app.ai_context}</p> : null}
                        <div className="studio-card__actions">
                          <button
                            className="button-secondary"
                            type="button"
                            onClick={() => setAppForm({
                              id: app.id,
                              name: app.name,
                              website_url: app.website_url || "",
                              app_store_url: app.app_store_url || "",
                              description: app.description || "",
                              ai_context: app.ai_context || "",
                              status: app.status,
                            })}
                          >
                            Edit
                          </button>
                          <button
                            className="button-secondary studio-danger-button"
                            type="button"
                            disabled={saving}
                            onClick={() => void deleteApp(app)}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {campaignModalOpen ? (
        <div className="studio-modal-backdrop">
          <form className="studio-modal panel" onSubmit={createCampaign}>
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">Campaign</p>
                <h2>Create campaign</h2>
                <p className="studio-muted">Set the campaign target and queue the Pain Crawler from here.</p>
              </div>
              <button className="button-secondary" type="button" onClick={() => setCampaignModalOpen(false)}>
                Close
              </button>
            </div>
            <label>
              Campaign name
              <input value={campaignForm.name} onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label>
              App
              <select value={campaignForm.app_id} onChange={(event) => setCampaignForm((current) => ({ ...current, app_id: event.target.value }))} required>
                <option value="">Select app</option>
                {summary.apps.map((app) => (
                  <option key={app.id} value={app.id}>{app.name}</option>
                ))}
              </select>
            </label>
            <div className="studio-choice-row" role="group" aria-label="Campaign type">
              {(["post", "reply"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`studio-choice ${campaignForm.campaign_type === mode ? "studio-choice--active" : ""}`}
                  onClick={() => setCampaignForm((current) => ({ ...current, campaign_type: mode }))}
                >
                  {mode === "post" ? "Post" : "Reply"}
                </button>
              ))}
            </div>
            <div className="studio-check-grid">
              {PLATFORMS.map((platform) => (
                <label className="studio-check" key={platform.id}>
                  <input
                    type="checkbox"
                    checked={campaignForm.platforms.includes(platform.id)}
                    onChange={() => setCampaignForm((current) => {
                      const platforms = toggleArrayValue(current.platforms, platform.id);
                      return {
                        ...current,
                        platforms,
                        account_refs: current.account_refs.filter((ref) => {
                          const account = summary.accounts.find((item) => item.ref === ref);
                          return account ? platforms.includes(account.platform) : false;
                        }),
                      };
                    })}
                  />
                  <span>{platform.label}</span>
                </label>
              ))}
            </div>
            <div className="studio-check-list">
              {campaignAccounts.length === 0 ? (
                <p className="studio-muted">No matching connected accounts.</p>
              ) : campaignAccounts.map((account) => (
                <label className="studio-check" key={account.ref}>
                  <input
                    type="checkbox"
                    checked={campaignForm.account_refs.includes(account.ref)}
                    onChange={() => setCampaignForm((current) => ({
                      ...current,
                      account_refs: toggleArrayValue(current.account_refs, account.ref),
                    }))}
                  />
                  <span>{account.label}</span>
                </label>
              ))}
            </div>
            <label>
              Instructions
              <textarea
                rows={5}
                value={campaignForm.instructions}
                onChange={(event) => setCampaignForm((current) => ({ ...current, instructions: event.target.value }))}
                required
              />
            </label>
            <div className="studio-modal__actions">
              <button className="button-secondary" type="button" onClick={() => setCampaignModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? "Creating..." : "Create campaign"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
