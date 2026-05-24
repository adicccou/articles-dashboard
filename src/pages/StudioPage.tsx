import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { StudioAccount, StudioCampaign, StudioSignal, StudioStrategistPost, StudioSummary } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import "../styles/studio-page.css";

type Platform = "twitter" | "threads" | "reddit";

type StudioPageProps = {
  onUpload: (file: File) => Promise<{ key: string; url: string }>;
};

type CampaignForm = {
  name: string;
  campaign_type: "post" | "reply";
  result_limit: string;
  app_id: string;
  account_refs: string[];
  platforms: Platform[];
  instructions: string;
  status: StudioCampaign["status"];
};

const PLATFORMS: Array<{ id: Platform; label: string }> = [
  { id: "twitter", label: "Twitter/X" },
  { id: "threads", label: "Threads" },
  { id: "reddit", label: "Reddit" },
];

const DEFAULT_CAMPAIGN_RESULT_LIMIT = 10;

function emptyCampaignForm(): CampaignForm {
  return {
    name: "",
    campaign_type: "post",
    result_limit: String(DEFAULT_CAMPAIGN_RESULT_LIMIT),
    app_id: "",
    account_refs: [],
    platforms: ["threads"],
    instructions: "",
    status: "active",
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
  if (["pending", "running", "suggested", "asset_needed", "candidate", "filtered"].includes(status)) return "info";
  if (["failed", "archived", "rejected"].includes(status)) return "danger";
  return "neutral";
}

function formatScheduledLabel(value: string | null | undefined) {
  const formatted = formatDisplayDateTime(value);
  return formatted ? `Scheduled on ${formatted}` : "Scheduled";
}

function toggleArrayValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function accountMatchesPlatforms(account: StudioAccount, platforms: Platform[]) {
  return platforms.length === 0 || platforms.includes(account.platform);
}

function normalizeExternalUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function isLikelyContentUrl(platform: string, value: unknown) {
  const url = normalizeExternalUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (platform === "reddit") return /\/comments\/[A-Za-z0-9_]+/i.test(path) ? url : "";
    if (platform === "threads") return /\/@[^/]+\/post\/|\/t\//i.test(path) ? url : "";
    if (platform === "twitter") return /\/status(?:es)?\/\d+|\/i\/web\/status\/\d+/i.test(path) ? url : "";
    return url;
  } catch {
    return "";
  }
}

type StudioIconName = "edit" | "regenerate" | "save" | "cancel" | "delete";

function StudioIcon({ name }: { name: StudioIconName }) {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      {name === "edit" ? (
        <>
          <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
          <path d="m13.5 6.5 4 4" />
        </>
      ) : null}
      {name === "regenerate" ? (
        <>
          <path d="M20 12a8 8 0 0 1-14.9 4" />
          <path d="M4 16h4v4" />
          <path d="M4 12a8 8 0 0 1 14.9-4" />
          <path d="M20 8h-4V4" />
        </>
      ) : null}
      {name === "save" ? <path d="m20 6-11 11-5-5" /> : null}
      {name === "cancel" ? (
        <>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </>
      ) : null}
      {name === "delete" ? (
        <>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </>
      ) : null}
    </svg>
  );
}

export function StudioPage({ onUpload }: StudioPageProps) {
  const [summary, setSummary] = useState<StudioSummary>({
    accounts: [],
    apps: [],
    campaigns: [],
    crawler_runs: [],
    signals: [],
    strategist_posts: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [deletingCampaignId, setDeletingCampaignId] = useState<number | null>(null);
  const [rerunningCampaignId, setRerunningCampaignId] = useState<number | null>(null);
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(emptyCampaignForm);
  const [uploadingPostId, setUploadingPostId] = useState<number | null>(null);
  const [schedulingPostId, setSchedulingPostId] = useState<number | null>(null);
  const [deletingSignalId, setDeletingSignalId] = useState<number | null>(null);

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
        signals: Array.isArray(next.signals) ? next.signals : [],
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
    if (selectedCampaignId && !summary.campaigns.some((campaign) => campaign.id === selectedCampaignId)) {
      setSelectedCampaignId(null);
    }
  }, [selectedCampaignId, summary.campaigns]);

  const runsById = useMemo(
    () => new Map(summary.crawler_runs.map((run) => [run.id, run])),
    [summary.crawler_runs],
  );

  const campaignAccounts = useMemo(
    () => summary.accounts.filter((account) => accountMatchesPlatforms(account, campaignForm.platforms)),
    [campaignForm.platforms, summary.accounts],
  );

  const accountLabelByRef = useMemo(
    () => new Map(summary.accounts.map((account) => [account.ref, account.label])),
    [summary.accounts],
  );

  const campaignResultsById = useMemo(() => {
    const results = new Map<number, {
      runs: typeof summary.crawler_runs;
      signals: StudioSignal[];
      posts: StudioStrategistPost[];
    }>();

    for (const campaign of summary.campaigns) {
      results.set(campaign.id, { runs: [], signals: [], posts: [] });
    }

    for (const run of summary.crawler_runs) {
      if (!run.campaign_id) continue;
      results.get(run.campaign_id)?.runs.push(run);
    }

    for (const signal of summary.signals) {
      const campaignId = signal.campaign_id ?? runsById.get(signal.crawler_run_id)?.campaign_id ?? null;
      if (!campaignId) continue;
      results.get(campaignId)?.signals.push(signal);
    }

    for (const post of summary.strategist_posts) {
      const campaignId = post.campaign_id ?? runsById.get(post.crawler_run_id)?.campaign_id ?? null;
      if (!campaignId) continue;
      results.get(campaignId)?.posts.push(post);
    }

    return results;
  }, [runsById, summary.campaigns, summary.crawler_runs, summary.signals, summary.strategist_posts]);

  function openCampaignModal() {
    setCampaignForm(emptyCampaignForm());
    setEditingCampaignId(null);
    setCampaignModalOpen(true);
    setFeedback(null);
    setError(null);
  }

  function openEditCampaign(campaign: StudioCampaign) {
    setCampaignForm({
      name: campaign.name,
      campaign_type: campaign.campaign_type,
      result_limit: String(campaign.result_limit ?? DEFAULT_CAMPAIGN_RESULT_LIMIT),
      app_id: String(campaign.app_id),
      account_refs: campaign.account_refs,
      platforms: campaign.platforms,
      instructions: campaign.instructions,
      status: campaign.status,
    });
    setEditingCampaignId(campaign.id);
    setCampaignModalOpen(true);
    setFeedback(null);
    setError(null);
  }

  function closeCampaignModal() {
    setCampaignModalOpen(false);
    setEditingCampaignId(null);
    setCampaignForm(emptyCampaignForm());
  }

  async function saveCampaign(event: React.FormEvent<HTMLFormElement>) {
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
    const resultLimit = Math.round(Number(campaignForm.result_limit));
    if (!Number.isFinite(resultLimit) || resultLimit < 1 || resultLimit > 50) {
      setError("Results needed must be a number from 1 to 50.");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        name: campaignForm.name.trim(),
        app_id: Number(campaignForm.app_id),
        campaign_type: campaignForm.campaign_type,
        result_limit: resultLimit,
        account_refs: campaignForm.account_refs,
        platforms: campaignForm.platforms,
        instructions: campaignForm.instructions.trim(),
        status: campaignForm.status,
      };

      if (editingCampaignId) {
        await api.updateStudioCampaign(editingCampaignId, payload);
        setFeedback(`${studioId("CMP", editingCampaignId)} updated.`);
      } else {
        const campaign = await api.createStudioCampaign(payload);
        const run = await api.createStudioCrawlerRun({
          campaign_id: campaign.id,
          result_limit: resultLimit,
        });
        setSelectedCampaignId(campaign.id);
        setFeedback(`${studioId("CMP", campaign.id)} created and ${studioId("CR", run.id)} queued.`);
      }

      closeCampaignModal();
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCampaign(campaign: StudioCampaign) {
    const confirmed = window.confirm(`Delete ${studioId("CMP", campaign.id)}?`);
    if (!confirmed) return;

    try {
      setDeletingCampaignId(campaign.id);
      setError(null);
      await api.deleteStudioCampaign(campaign.id);
      setFeedback(`${studioId("CMP", campaign.id)} deleted.`);
      if (selectedCampaignId === campaign.id) setSelectedCampaignId(null);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete campaign");
    } finally {
      setDeletingCampaignId(null);
    }
  }

  async function rerunCampaign(campaign: StudioCampaign) {
    try {
      setRerunningCampaignId(campaign.id);
      setError(null);
      const run = await api.createStudioCrawlerRun({ campaign_id: campaign.id });
      setFeedback(`${studioId("CR", run.id)} queued. Crawler will run again and generate new strategist options.`);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rerun crawler");
    } finally {
      setRerunningCampaignId(null);
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
      setSummary((current) => ({
        ...current,
        strategist_posts: current.strategist_posts.map((item) => item.id === post.id
          ? {
              ...item,
              status: "scheduled",
              scheduled_at: result.scheduled_at,
              social_post_id: result.social_post_id,
              planner_item_id: result.planner_item_id,
            }
          : item),
      }));
      setFeedback(formatScheduledLabel(result.scheduled_at));
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule post");
    } finally {
      setSchedulingPostId(null);
    }
  }

  async function deleteSignal(signal: StudioSignal) {
    const confirmed = window.confirm("Delete this crawler result?");
    if (!confirmed) return;

    try {
      setDeletingSignalId(signal.id);
      setError(null);
      await api.deleteStudioSignal(signal.id);
      setFeedback("Crawler result deleted.");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete crawler result");
    } finally {
      setDeletingSignalId(null);
    }
  }

  function rawString(value: unknown, keys: string[]) {
    if (!value || typeof value !== "object") return "";
    const raw = value as Record<string, unknown>;
    for (const key of keys) {
      const candidate = String(raw[key] ?? "").trim();
      if (candidate) return candidate;
    }
    return "";
  }

  function parentPostUrl(platform: string, value: unknown) {
    const url = normalizeExternalUrl(value);
    if (!url) return "";
    if (platform !== "reddit") return url;
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const commentsIndex = parts.findIndex((part) => part.toLowerCase() === "comments");
      if (commentsIndex >= 0 && parts.length > commentsIndex + 2) {
        parsed.pathname = `/${parts.slice(0, commentsIndex + 3).join("/")}/`;
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  function hasReplyIntentText(value: string) {
    return /\b(comment|comments|reply|replies|respond|response)\b/i.test(value);
  }

  function profileLinkForPost(post: StudioStrategistPost, signal?: StudioSignal | null) {
    const rawProfileUrl = normalizeExternalUrl(rawString(signal?.raw_data, ["user_url", "profile_url", "account_url", "author_url"]));
    if (rawProfileUrl) return rawProfileUrl;
    const author = String(post.target_author ?? signal?.author ?? "").replace(/^@+/, "").trim();
    if (!author) return "";
    if (post.platform === "reddit") return `https://www.reddit.com/user/${encodeURIComponent(author)}`;
    if (post.platform === "threads") return `https://www.threads.net/@${encodeURIComponent(author)}`;
    return `https://x.com/${encodeURIComponent(author)}`;
  }

  function profileLinkForSignal(signal: StudioSignal) {
    const author = String(signal.author ?? "").replace(/^@+/, "").trim();
    if (!author) return "";
    if (signal.platform === "reddit") return `https://www.reddit.com/user/${encodeURIComponent(author)}`;
    if (signal.platform === "threads") return `https://www.threads.net/@${encodeURIComponent(author)}`;
    return `https://x.com/${encodeURIComponent(author)}`;
  }

  function signalUrl(signal: StudioSignal, keys: string[]) {
    const rawUrl = rawString(signal.raw_data, keys);
    return isLikelyContentUrl(signal.platform, rawUrl) || isLikelyContentUrl(signal.platform, signal.url);
  }

  function signalCommentUrl(signal?: StudioSignal | null) {
    return signal ? signalUrl(signal, ["comment_url", "reply_url", "target_url"]) : "";
  }

  function signalPostUrl(signal?: StudioSignal | null) {
    return signal ? signalUrl(signal, ["post_url", "source_post_url", "parent_post_url", "thread_url"]) : "";
  }

  function matchingSignalForPost(post: StudioStrategistPost, fallbackIndex = 0) {
    const targetUrl = normalizeExternalUrl(post.target_url);
    const targetText = String(post.target_text ?? "").trim().toLowerCase();
    const runSignals = summary.signals.filter((signal) => (
      signal.crawler_run_id === post.crawler_run_id && signal.platform === post.platform
    ));
    return runSignals.find((signal) => {
      const urls = [
        signalCommentUrl(signal),
        signalPostUrl(signal),
        normalizeExternalUrl(signal.url),
      ].filter(Boolean);
      return Boolean(targetUrl && urls.includes(targetUrl));
    }) ?? runSignals.find((signal) => {
      if (!targetText) return false;
      const signalText = [
        signal.snippet,
        signal.evidence,
        signal.title,
        signal.pain_point,
      ].join(" ").toLowerCase();
      return signalText.includes(targetText.slice(0, 80));
    }) ?? runSignals[fallbackIndex % Math.max(runSignals.length, 1)] ?? null;
  }

  function strategistCommentUrl(post: StudioStrategistPost, signal?: StudioSignal | null) {
    return isLikelyContentUrl(post.platform, post.target_url) || signalCommentUrl(signal);
  }

  function strategistPostUrl(post: StudioStrategistPost, signal?: StudioSignal | null) {
    const commentUrl = strategistCommentUrl(post, signal);
    return signalPostUrl(signal) || parentPostUrl(post.platform, commentUrl);
  }

  function renderSignal(signal: StudioSignal) {
    const profileUrl = profileLinkForSignal(signal);
    const commentUrl = signalUrl(signal, ["comment_url", "reply_url", "target_url"]);
    const postUrl = signalUrl(signal, ["post_url", "source_post_url", "parent_post_url", "thread_url"]);
    const commentText = signal.snippet || signal.evidence || signal.title || "No comment text saved.";

    return (
      <article className="studio-post-card studio-reply-card studio-signal-card" key={signal.id}>
        <div className="studio-signal-links">
          <div className="studio-link-pill-row">
            {postUrl ? (
              <a className="studio-link-pill" href={postUrl} target="_blank" rel="noreferrer" title={postUrl}>
                Post
              </a>
            ) : (
              <span className="studio-link-pill studio-link-pill--muted" title="No real post link captured">No post</span>
            )}
            {commentUrl ? (
              <a className="studio-link-pill" href={commentUrl} target="_blank" rel="noreferrer" title={commentUrl}>
                Comment
              </a>
            ) : (
              <span className="studio-link-pill studio-link-pill--muted" title="No real comment link captured">No comment</span>
            )}
            {profileUrl ? (
              <a className="studio-link-pill" href={profileUrl} target="_blank" rel="noreferrer" title="Open comment user account">
                User
              </a>
            ) : (
              <span className="studio-link-pill studio-link-pill--muted" title="No comment user account link">No user</span>
            )}
          </div>
          <div className="studio-row-actions studio-row-actions--compact">
            <button
              className="button-secondary studio-icon-button studio-danger-button"
              type="button"
              aria-label={deletingSignalId === signal.id ? "Deleting crawler result" : "Delete crawler result"}
              title={deletingSignalId === signal.id ? "Deleting crawler result" : "Delete crawler result"}
              disabled={deletingSignalId === signal.id}
              onClick={() => void deleteSignal(signal)}
            >
              <StudioIcon name="delete" />
            </button>
          </div>
        </div>

        <div className="studio-reply-section">
          <span className="studio-id">Comment</span>
          <p>{commentText}</p>
        </div>

        <div className="studio-reply-section studio-reply-suggestion">
          <div className="studio-reply-section__header">
            <span className="studio-id">Suggestion reply</span>
            <div className="studio-row-actions">
              <button className="button-secondary studio-icon-button" type="button" aria-label="Edit suggestion" title="Edit suggestion" disabled>
                <StudioIcon name="edit" />
              </button>
              <button className="button-secondary studio-icon-button" type="button" aria-label="Regenerate suggestion" title="Regenerate suggestion" disabled>
                <StudioIcon name="regenerate" />
              </button>
            </div>
          </div>
          <p>No suggestion yet.</p>
        </div>

        <button type="button" disabled>Schedule it</button>
      </article>
    );
  }

  function renderStrategistPost(post: StudioStrategistPost, index = 0) {
    const run = runsById.get(post.crawler_run_id);
    const isReplyData = run?.campaign_type === "reply"
      || Boolean(post.target_external_id || post.target_url || post.target_author || post.target_text);
    const isCommentWorkflow = isReplyData || hasReplyIntentText([
      run?.campaign_name,
      run?.instructions,
      post.campaign_name,
      post.idea,
    ].filter(Boolean).join(" "));
    const needsMedia = post.media_type === "photo" || post.media_type === "video";
    const canSchedule = post.status !== "scheduled"
      && (!needsMedia || Boolean(post.media_url))
      && (!isReplyData || Boolean(post.target_external_id));
    const matchedSignal = matchingSignalForPost(post, index);
    const commentUrl = strategistCommentUrl(post, matchedSignal);
    const postUrl = strategistPostUrl(post, matchedSignal);
    const profileUrl = profileLinkForPost(post, matchedSignal);
    const commentText = post.target_text || matchedSignal?.snippet || matchedSignal?.evidence || "No crawled comment text saved.";
    const scheduledLabel = post.status === "scheduled" || post.scheduled_at
      ? formatScheduledLabel(post.scheduled_at)
      : null;

    if (isCommentWorkflow) {
      return (
        <article className="studio-post-card studio-reply-card" key={post.id}>
          <div className="studio-link-pill-row">
            {postUrl ? (
              <a className="studio-link-pill" href={postUrl} target="_blank" rel="noreferrer" title={postUrl}>
                Post
              </a>
            ) : (
              <span className="studio-link-pill studio-link-pill--muted" title="No real post link captured">No post</span>
            )}
            {commentUrl ? (
              <a className="studio-link-pill" href={commentUrl} target="_blank" rel="noreferrer" title={commentUrl}>
                Comment
              </a>
            ) : (
              <span className="studio-link-pill studio-link-pill--muted" title="No real comment link captured">No comment</span>
            )}
            {profileUrl ? (
              <a className="studio-link-pill" href={profileUrl} target="_blank" rel="noreferrer" title="Open user account">
                User
              </a>
            ) : (
              <span className="studio-link-pill studio-link-pill--muted" title="No user account link captured">No user</span>
            )}
          </div>

          <div className="studio-reply-section">
            <span className="studio-id">Comment crawled by instructions</span>
            <p>{commentText}</p>
          </div>

          <div className="studio-reply-section studio-reply-suggestion">
            <span className="studio-id">Dashboard AI suggestion to reply</span>
            <p>{post.post_text}</p>
          </div>

          {scheduledLabel ? (
            <p className="studio-scheduled-label">{scheduledLabel}</p>
          ) : (
            <button type="button" disabled={!canSchedule || schedulingPostId === post.id} onClick={() => void scheduleSuggestion(post)}>
              {schedulingPostId === post.id ? "Scheduling..." : "Schedule it"}
            </button>
          )}
          {isReplyData && !post.target_external_id ? <p className="error">Missing reply target ID.</p> : null}
        </article>
      );
    }

    return (
      <article className="studio-post-card" key={post.id}>
        <div className="studio-card__header">
          <span className="studio-id">{studioId("SP", post.id)}</span>
          <span className={`studio-pill studio-pill--${statusTone(post.status)}`}>{post.status}</span>
        </div>
        <div className="studio-chip-row">
          <span className="studio-chip">{platformLabel(post.platform)}</span>
          <span className="studio-chip">{isReplyData ? "Reply" : "Post"}</span>
          <span className="studio-chip">{post.media_type === "none" ? "Text" : post.media_type}</span>
          {post.campaign_name || run?.campaign_name ? (
            <span className="studio-chip">{post.campaign_name || run?.campaign_name}</span>
          ) : null}
        </div>
        <h2>{post.idea || "Post idea"}</h2>
        {isReplyData ? (
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
        {scheduledLabel ? (
          <p className="studio-scheduled-label">{scheduledLabel}</p>
        ) : (
          <button type="button" disabled={!canSchedule || schedulingPostId === post.id} onClick={() => void scheduleSuggestion(post)}>
            {schedulingPostId === post.id ? "Scheduling..." : "Schedule it"}
          </button>
        )}
        {isReplyData && !post.target_external_id ? <p className="error">Missing reply target ID.</p> : null}
      </article>
    );
  }

  if (loading) {
    return <section className="panel">Loading Studio...</section>;
  }

  const selectedCampaign = selectedCampaignId
    ? summary.campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null
    : null;
  const selectedCampaignResults = selectedCampaign
    ? campaignResultsById.get(selectedCampaign.id) ?? { runs: [], signals: [], posts: [] }
    : null;
  const selectedCampaignResultLimit = selectedCampaign && selectedCampaignResults
    ? selectedCampaignResults.runs[0]?.result_limit ?? selectedCampaign.result_limit ?? DEFAULT_CAMPAIGN_RESULT_LIMIT
    : DEFAULT_CAMPAIGN_RESULT_LIMIT;

  return (
    <div className="studio-page stack">
      {error ? <p className="error panel">{error}</p> : null}
      {feedback ? <p className="studio-feedback panel">{feedback}</p> : null}

      {selectedCampaign && selectedCampaignResults ? (
        <>
          <section className="panel studio-campaign-detail-card">
            <div className="studio-detail-topbar">
              <button className="button-secondary" type="button" onClick={() => setSelectedCampaignId(null)}>
                Back
              </button>
              <div className="studio-detail-title">
                <span className="studio-id">{studioId("CMP", selectedCampaign.id)}</span>
                <h2>{selectedCampaign.name}</h2>
              </div>
              <div className="studio-tabs__actions">
              <button
                className="button-secondary"
                type="button"
                onClick={() => openEditCampaign(selectedCampaign)}
              >
                Edit
              </button>
              <button
                className="button-secondary"
                type="button"
                disabled={rerunningCampaignId === selectedCampaign.id}
                onClick={() => void rerunCampaign(selectedCampaign)}
              >
                {rerunningCampaignId === selectedCampaign.id ? "Rerunning..." : "Rerun"}
              </button>
              <button className="button-secondary" type="button" disabled={refreshing} onClick={() => void load({ silent: true })}>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
              </div>
            </div>
            <div className="studio-campaign-overview">
              <div>
                <span className="studio-id">App</span>
                <strong>{selectedCampaign.app_name || `App #${selectedCampaign.app_id}`}</strong>
              </div>
              <div>
                <span className="studio-id">Type</span>
                <div className="studio-chip-row">
                  <span className="studio-chip">{selectedCampaign.campaign_type === "reply" ? "Reply" : "Post"}</span>
                  {selectedCampaign.platforms.map((platform) => (
                    <span className="studio-chip" key={platform}>{platformLabel(platform)}</span>
                  ))}
                </div>
              </div>
              <div>
                <span className="studio-id">Accounts</span>
                <p className="studio-muted">
                  {selectedCampaign.account_refs.map((ref) => accountLabelByRef.get(ref) ?? ref).join(", ") || "No accounts"}
                </p>
              </div>
              <div>
                <span className="studio-id">Results needed</span>
                <strong>{selectedCampaignResultLimit}</strong>
              </div>
              <div>
                <span className="studio-id">Status</span>
                <span className={`studio-pill studio-pill--${statusTone(selectedCampaign.status)}`}>{selectedCampaign.status}</span>
              </div>
              <div className="studio-campaign-overview__instructions">
                <span className="studio-id">Instructions</span>
                <p>{selectedCampaign.instructions || "No instructions saved."}</p>
              </div>
            </div>
          </section>

          <section className="panel studio-strategist-page">
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">Strategist</p>
                <h2>Suggestions</h2>
              </div>
              <span className="studio-count">{selectedCampaignResults.posts.length}</span>
            </div>
            {selectedCampaignResults.posts.length > 0 ? (
              <div className="studio-post-grid">
                {selectedCampaignResults.posts.map(renderStrategistPost)}
              </div>
            ) : (
              <div className="studio-strategist-section">
                {selectedCampaignResults.signals.length === 0 ? (
                  <div className="studio-empty studio-empty--compact">No crawler results for this campaign yet.</div>
                ) : (
                  <div className="studio-signal-grid">
                    {selectedCampaignResults.signals.map(renderSignal)}
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="panel studio-tabs">
            <div className="studio-tabs__heading">
              <h2 className="studio-tabs__title">Strategist</h2>
              <div className="studio-tabs__actions">
                <button type="button" onClick={openCampaignModal}>
                  Create campaign
                </button>
                <button className="button-secondary" type="button" disabled={refreshing} onClick={() => void load({ silent: true })}>
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
          </section>

          <section className="panel studio-campaigns">
            <div className="panel__title-row">
              <h2>Campaigns</h2>
              <span className="studio-count">{summary.campaigns.length}</span>
            </div>
            {summary.campaigns.length === 0 ? (
              <div className="studio-empty">No campaigns yet.</div>
            ) : (
              <div className="studio-campaign-list">
                <div className="studio-campaign-row studio-campaign-row--head">
                  <span>Campaign</span>
                  <span>App</span>
                  <span>Type</span>
                  <span>Accounts</span>
                  <span>Instructions</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {summary.campaigns.map((campaign) => (
                  <article
                    className="studio-campaign-row studio-campaign-row--clickable"
                    key={campaign.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedCampaignId(campaign.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedCampaignId(campaign.id);
                      }
                    }}
                  >
                    <div className="studio-campaign-main">
                      <span className="studio-id">{studioId("CMP", campaign.id)}</span>
                      <strong>{campaign.name}</strong>
                    </div>
                    <p className="studio-muted">{campaign.app_name || `App #${campaign.app_id}`}</p>
                    <div className="studio-chip-row">
                      <span className="studio-chip">{campaign.campaign_type === "reply" ? "Reply" : "Post"}</span>
                      {campaign.platforms.map((platform) => (
                        <span className="studio-chip" key={platform}>{platformLabel(platform)}</span>
                      ))}
                    </div>
                    <p className="studio-muted studio-campaign-accounts">
                      {campaign.account_refs.map((ref) => accountLabelByRef.get(ref) ?? ref).join(", ") || "No accounts"}
                    </p>
                    <p className="studio-card__copy">{campaign.instructions || "No instructions saved."}</p>
                    <span className={`studio-pill studio-pill--${statusTone(campaign.status)}`}>{campaign.status}</span>
                    <div className="studio-row-actions">
                      <button
                        className="button-secondary"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditCampaign(campaign);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="button-secondary studio-danger-button"
                        type="button"
                        disabled={deletingCampaignId === campaign.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteCampaign(campaign);
                        }}
                      >
                        {deletingCampaignId === campaign.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {campaignModalOpen ? (
        <div className="studio-modal-backdrop">
          <form className="studio-modal panel" onSubmit={saveCampaign}>
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">Campaign</p>
                <h2>{editingCampaignId ? "Edit campaign" : "Create campaign"}</h2>
                <p className="studio-muted">Set the campaign target and queue the Pain Crawler from here.</p>
              </div>
              <button className="button-secondary" type="button" onClick={closeCampaignModal}>
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
              How many results we need
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={campaignForm.result_limit}
                onChange={(event) => setCampaignForm((current) => ({ ...current, result_limit: event.target.value }))}
                required
              />
            </label>
            {editingCampaignId ? (
              <label>
                Status
                <select
                  value={campaignForm.status}
                  onChange={(event) => setCampaignForm((current) => ({
                    ...current,
                    status: event.target.value as StudioCampaign["status"],
                  }))}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            ) : null}
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
              <button className="button-secondary" type="button" onClick={closeCampaignModal}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingCampaignId ? "Save campaign" : "Create campaign"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
