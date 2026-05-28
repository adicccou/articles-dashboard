import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  CheckIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { SectionTabs } from "../components/SectionTabs";
import { api } from "../lib/api";
import type { StudioAccount, StudioCampaign, StudioCrawlerRun, StudioSignal, StudioStrategistPost, StudioSummary } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import "../styles/studio-page.css";

type Platform = "twitter" | "threads" | "reddit" | "instagram" | "linkedin";

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

type CrawlerTab = "comments" | "pain-points";

const PLATFORMS: Array<{ id: Platform; label: string }> = [
  { id: "twitter", label: "Twitter/X" },
  { id: "threads", label: "Threads" },
  { id: "reddit", label: "Reddit" },
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
];

const REPLY_CAPABLE_PLATFORMS = new Set<Platform>(["twitter", "threads", "reddit"]);

const DEFAULT_CAMPAIGN_RESULT_LIMIT = 10;

const CRAWLER_TABS: Array<{ id: CrawlerTab; label: string; campaignType: StudioCampaign["campaign_type"] }> = [
  { id: "comments", label: "Comment searcher", campaignType: "reply" },
  { id: "pain-points", label: "Painpoint analyzer", campaignType: "post" },
];

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

function sortRunsNewestFirst(runs: StudioCrawlerRun[]) {
  return [...runs].sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.finished_at || left.started_at || left.created_at).getTime();
    const rightTime = new Date(right.updated_at || right.finished_at || right.started_at || right.created_at).getTime();
    return rightTime - leftTime;
  });
}

function getCampaignDisplayStatus(
  campaign: StudioCampaign,
  runs: StudioCrawlerRun[],
): { label: string; tone: string } {
  const latestRun = sortRunsNewestFirst(runs)[0];
  if (!latestRun) {
    return { label: campaign.status, tone: statusTone(campaign.status) };
  }
  if (latestRun.status === "pending" || latestRun.status === "running") {
    return { label: "Working", tone: statusTone("running") };
  }
  if (latestRun.status === "completed") {
    return { label: "Ready", tone: statusTone("completed") };
  }
  if (latestRun.status === "failed") {
    return { label: "Failed", tone: statusTone("failed") };
  }
  return { label: campaign.status, tone: statusTone(campaign.status) };
}

function formatScheduledLabel(value: string | null | undefined) {
  const formatted = formatDisplayDateTime(value);
  return formatted ? `Scheduled on ${formatted}` : "Scheduled";
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

function isPlatformUrl(platform: string, value: unknown) {
  const url = normalizeExternalUrl(value);
  if (!url) return "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (platform === "reddit") return host.endsWith("reddit.com") ? url : "";
    if (platform === "threads") return host.endsWith("threads.net") ? url : "";
    if (platform === "twitter") return host.endsWith("x.com") || host.endsWith("twitter.com") ? url : "";
    return "";
  } catch {
    return "";
  }
}

function isSocialNavigationUrl(platform: string, value: unknown) {
  const url = isPlatformUrl(platform, value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (platform === "twitter") {
      return path === "/"
        || path.startsWith("/i/jf/onboarding")
        || path.startsWith("/login")
        || path.startsWith("/search")
        || path.startsWith("/home")
        || path.startsWith("/explore");
    }
    if (platform === "threads") {
      return path === "/" || path.startsWith("/login") || path.startsWith("/search");
    }
    if (platform === "reddit") {
      return path === "/" || path.startsWith("/login") || path.startsWith("/search");
    }
  } catch {
    return false;
  }
  return false;
}

function authorFromSocialUrl(platform: string, value: unknown) {
  const url = normalizeExternalUrl(value);
  if (!url) return "";
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (platform === "threads") {
      const handle = parts.find((part) => part.startsWith("@"));
      return handle ? handle.replace(/^@+/, "") : "";
    }
    if (platform === "twitter") {
      const first = parts[0] ?? "";
      return first && !["i", "search", "home", "explore"].includes(first.toLowerCase()) ? first.replace(/^@+/, "") : "";
    }
    if (platform === "reddit") {
      const userIndex = parts.findIndex((part) => ["user", "u"].includes(part.toLowerCase()));
      return userIndex >= 0 && parts[userIndex + 1] ? parts[userIndex + 1] : "";
    }
  } catch {
    return "";
  }
  return "";
}

function profileLinkForAuthor(platform: string, author: string) {
  const cleanAuthor = author.replace(/^@+/, "").trim();
  if (!cleanAuthor) return "";
  if (platform === "reddit") return `https://www.reddit.com/user/${encodeURIComponent(cleanAuthor)}`;
  if (platform === "threads") return `https://www.threads.net/@${encodeURIComponent(cleanAuthor)}`;
  return `https://x.com/${encodeURIComponent(cleanAuthor)}`;
}

type StudioIconName = "edit" | "regenerate" | "save" | "cancel" | "delete";

function StudioIcon({ name }: { name: StudioIconName }) {
  const icons = {
    cancel: XMarkIcon,
    delete: TrashIcon,
    edit: PencilSquareIcon,
    regenerate: ArrowPathIcon,
    save: CheckIcon,
  };
  const Icon = icons[name];
  return <Icon aria-hidden="true" className="h-4 w-4" />;
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
  const [selectedCrawlerTab, setSelectedCrawlerTab] = useState<CrawlerTab>("comments");
  const [uploadingPostId, setUploadingPostId] = useState<number | null>(null);
  const [schedulingPostId, setSchedulingPostId] = useState<number | null>(null);
  const [unpostingPostId, setUnpostingPostId] = useState<number | null>(null);
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editingPostText, setEditingPostText] = useState("");
  const [savingPostId, setSavingPostId] = useState<number | null>(null);
  const [regeneratingPostId, setRegeneratingPostId] = useState<number | null>(null);
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

  const availableApps = useMemo(
    () => summary.apps.filter((app) => app.status === "active"),
    [summary.apps],
  );

  const availableAccounts = useMemo(
    () => summary.accounts.filter((account) => account.status === "active"),
    [summary.accounts],
  );

  const availablePlatforms = useMemo(
    () => PLATFORMS.filter((platform) => availableAccounts.some((account) => account.platform === platform.id)),
    [availableAccounts],
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

  const editingPost = useMemo(
    () => summary.strategist_posts.find((post) => post.id === editingPostId) ?? null,
    [editingPostId, summary.strategist_posts],
  );
  const editingPostRun = editingPost ? runsById.get(editingPost.crawler_run_id) : null;
  const editingPostIsReply = editingPost
    ? editingPostRun?.campaign_type === "reply"
      || Boolean(editingPost.target_external_id || editingPost.target_url || editingPost.target_author || editingPost.target_text)
    : false;

  const availableReplyAccounts = useMemo(
    () => availableAccounts.filter((account) => REPLY_CAPABLE_PLATFORMS.has(account.platform)),
    [availableAccounts],
  );

  function buildEmptyCampaignForm(tab: CrawlerTab = selectedCrawlerTab): CampaignForm {
    const tabConfig = CRAWLER_TABS.find((item) => item.id === tab) ?? CRAWLER_TABS[0];
    const replyAccount = availableReplyAccounts[0] ?? null;
    const painPlatforms = availablePlatforms.length > 0
      ? availablePlatforms.map((platform) => platform.id)
      : PLATFORMS.map((platform) => platform.id);
    return {
      name: "",
      campaign_type: tabConfig.campaignType,
      result_limit: String(DEFAULT_CAMPAIGN_RESULT_LIMIT),
      app_id: availableApps[0] ? String(availableApps[0].id) : "",
      account_refs: tabConfig.campaignType === "reply" && replyAccount ? [replyAccount.ref] : [],
      platforms: tabConfig.campaignType === "reply" && replyAccount ? [replyAccount.platform] : painPlatforms,
      instructions: "",
      status: "active",
    };
  }

  function openCampaignModal(tab: CrawlerTab = selectedCrawlerTab) {
    setSelectedCrawlerTab(tab);
    setCampaignForm(buildEmptyCampaignForm(tab));
    setEditingCampaignId(null);
    setCampaignModalOpen(true);
    setFeedback(null);
    setError(null);
  }

  function openEditCampaign(campaign: StudioCampaign) {
    const selectedPlatform = campaign.platforms.find((platform) => availablePlatforms.some((item) => item.id === platform))
      ?? availablePlatforms[0]?.id
      ?? campaign.platforms[0]
      ?? "threads";
    const selectedAccountRef = campaign.account_refs.find((ref) => {
      const account = availableAccounts.find((item) => item.ref === ref);
      return account?.platform === selectedPlatform;
    }) ?? availableAccounts.find((account) => account.platform === selectedPlatform)?.ref ?? "";

    setCampaignForm({
      name: campaign.name,
      campaign_type: campaign.campaign_type,
      result_limit: String(campaign.result_limit ?? DEFAULT_CAMPAIGN_RESULT_LIMIT),
      app_id: availableApps.some((app) => app.id === campaign.app_id)
        ? String(campaign.app_id)
        : availableApps[0]
        ? String(availableApps[0].id)
        : "",
      account_refs: selectedAccountRef ? [selectedAccountRef] : [],
      platforms: availablePlatforms.some((item) => item.id === selectedPlatform) ? [selectedPlatform] : [],
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
    setCampaignForm(buildEmptyCampaignForm());
  }

  useEffect(() => {
    if (!campaignModalOpen) return;
    setCampaignForm((current) => {
      const nextAppId = availableApps.some((app) => String(app.id) === current.app_id)
        ? current.app_id
        : availableApps[0]
        ? String(availableApps[0].id)
        : "";
      const isReply = current.campaign_type === "reply";
      const selectedAccount = availableReplyAccounts.find((account) => account.ref === current.account_refs[0]) ?? availableReplyAccounts[0] ?? null;
      const painPlatforms = availablePlatforms.length > 0
        ? availablePlatforms.map((platform) => platform.id)
        : PLATFORMS.map((platform) => platform.id);
      const nextAccountRefs = isReply && selectedAccount ? [selectedAccount.ref] : [];
      const nextPlatforms = isReply && selectedAccount ? [selectedAccount.platform] : painPlatforms;
      const changed = nextAppId !== current.app_id
        || nextPlatforms.join(",") !== current.platforms.join(",")
        || nextAccountRefs.join(",") !== current.account_refs.join(",");
      return changed
        ? {
            ...current,
            app_id: nextAppId,
            platforms: nextPlatforms,
            account_refs: nextAccountRefs,
          }
        : current;
    });
  }, [availableApps, availablePlatforms, availableReplyAccounts, campaignModalOpen]);

  function closeSuggestionEditor() {
    if (savingPostId) return;
    setEditingPostId(null);
    setEditingPostText("");
  }

  async function saveCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isReplyCampaign = campaignForm.campaign_type === "reply";
    if (availableApps.length === 0) {
      setError("Add an active app in Config first so Studio can attach crawler results.");
      return;
    }
    if (isReplyCampaign && availableReplyAccounts.length === 0) {
      setError("Connect an active Twitter/X, Threads, or Reddit account in Config first.");
      return;
    }
    if (!campaignForm.name.trim() || !campaignForm.app_id) {
      setError("Campaign name is required.");
      return;
    }
    if (campaignForm.platforms.length === 0) {
      setError("No social platforms are available for this crawler.");
      return;
    }
    if (isReplyCampaign && campaignForm.account_refs.length === 0) {
      setError("Select a connected account.");
      return;
    }
    if (isReplyCampaign && campaignForm.platforms.some((platform) => !REPLY_CAPABLE_PLATFORMS.has(platform))) {
      setError("Reply campaigns are available for Twitter/X, Threads, and Reddit only.");
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
        account_refs: isReplyCampaign ? campaignForm.account_refs : [],
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

  async function unpostSuggestion(post: StudioStrategistPost) {
    try {
      setUnpostingPostId(post.id);
      const result = await api.unpostStudioStrategistPost(post.id);
      setSummary((current) => ({
        ...current,
        strategist_posts: current.strategist_posts.map((item) => item.id === post.id
          ? {
              ...item,
              status: result.status,
              scheduled_at: null,
              social_post_id: null,
              planner_item_id: null,
              updated_at: result.updated_at,
            }
          : item),
      }));
      setFeedback("Suggestion returned to Studio.");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unpost suggestion");
    } finally {
      setUnpostingPostId(null);
    }
  }

  async function saveSuggestionEdit(post: StudioStrategistPost) {
    const postText = editingPostText.trim();
    if (!postText) {
      setError("Suggestion text is required.");
      return;
    }

    try {
      setSavingPostId(post.id);
      setError(null);
      const result = await api.updateStudioStrategistPost(post.id, { post_text: postText });
      setSummary((current) => ({
        ...current,
        strategist_posts: current.strategist_posts.map((item) => item.id === post.id
          ? {
              ...item,
              post_text: postText,
              updated_at: result.updated_at,
            }
          : item),
      }));
      setEditingPostId(null);
      setEditingPostText("");
      setFeedback("Suggestion updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update suggestion");
    } finally {
      setSavingPostId(null);
    }
  }

  async function regenerateSuggestion(post: StudioStrategistPost) {
    const run = runsById.get(post.crawler_run_id);
    const isReply = run?.campaign_type === "reply"
      || Boolean(post.target_external_id || post.target_url || post.target_author || post.target_text);

    try {
      setRegeneratingPostId(post.id);
      setError(null);
      const updated = await api.regenerateStudioStrategistPost(post.id);
      setSummary((current) => ({
        ...current,
        strategist_posts: current.strategist_posts.map((item) => item.id === post.id ? updated : item),
      }));
      if (editingPostId === post.id) {
        setEditingPostId(null);
        setEditingPostText("");
      }
      setFeedback(isReply ? "Reply suggestion updated." : "Post suggestion updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update suggestion");
    } finally {
      setRegeneratingPostId(null);
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
    const rawProfileUrl = normalizeExternalUrl(rawString(signal?.raw_data, [
      "user_url",
      "user_profile_url",
      "profile_url",
      "account_url",
      "author_url",
      "author_profile_url",
    ]));
    if (rawProfileUrl) return rawProfileUrl;
    const author = String(post.target_author ?? signal?.author ?? rawString(signal?.raw_data, [
      "target_author",
      "author_username",
      "username",
      "screen_name",
      "handle",
    ])).replace(/^@+/, "").trim()
      || authorFromSocialUrl(post.platform, strategistCommentUrl(post, signal))
      || authorFromSocialUrl(post.platform, strategistPostUrl(post, signal));
    return profileLinkForAuthor(post.platform, author);
  }

  function profileLinkForSignal(signal: StudioSignal) {
    const rawProfileUrl = normalizeExternalUrl(rawString(signal.raw_data, [
      "user_url",
      "user_profile_url",
      "profile_url",
      "account_url",
      "author_url",
      "author_profile_url",
    ]));
    if (rawProfileUrl) return rawProfileUrl;
    const author = String(signal.author ?? rawString(signal.raw_data, [
      "target_author",
      "author_username",
      "username",
      "screen_name",
      "handle",
    ])).replace(/^@+/, "").trim()
      || authorFromSocialUrl(signal.platform, signalCommentUrl(signal))
      || authorFromSocialUrl(signal.platform, signalPostUrl(signal));
    return profileLinkForAuthor(signal.platform, author);
  }

  function signalRawUrl(signal: StudioSignal, keys: string[]) {
    return normalizeExternalUrl(rawString(signal.raw_data, keys));
  }

  function signalSourceUrl(signal: StudioSignal) {
    const rawUrl = signalRawUrl(signal, ["source_url", "url", "link", "href"]);
    return isLikelyContentUrl(signal.platform, rawUrl) || isLikelyContentUrl(signal.platform, signal.url);
  }

  function signalUrl(signal: StudioSignal, keys: string[], allowSourceFallback = false) {
    const rawUrl = signalRawUrl(signal, keys);
    const explicitUrl = isSocialNavigationUrl(signal.platform, rawUrl) ? "" : isLikelyContentUrl(signal.platform, rawUrl);
    return explicitUrl
      || isLikelyContentUrl(signal.platform, signal.url)
      || (allowSourceFallback ? signalSourceUrl(signal) : "");
  }

  function signalCommentUrl(signal?: StudioSignal | null) {
    return signal ? signalUrl(signal, [
      "comment_url",
      "comment_link",
      "reply_url",
      "reply_link",
      "target_comment_url",
      "target_url",
      "permalink",
    ], true) : "";
  }

  function signalPostUrl(signal?: StudioSignal | null) {
    if (!signal) return "";
    return signalUrl(signal, [
      "post_url",
      "post_link",
      "source_post_url",
      "parent_post_url",
      "thread_url",
      "tweet_url",
    ])
      || parentPostUrl(signal.platform, signalCommentUrl(signal))
      || signalSourceUrl(signal);
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
    const commentUrl = signalCommentUrl(signal);
    const postUrl = signalPostUrl(signal);
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
            <span className="studio-id">Reply suggestion</span>
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

  function isVisibleSignal(signal: StudioSignal, campaign?: StudioCampaign | null) {
    if (signal.status === "filtered" || signal.status === "rejected") return false;
    if (campaign?.campaign_type === "reply") {
      return Boolean(signalPostUrl(signal) && signalCommentUrl(signal) && profileLinkForSignal(signal));
    }
    return Boolean(signalPostUrl(signal) || signalCommentUrl(signal) || profileLinkForSignal(signal) || signal.snippet || signal.evidence);
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
    const showSourceLinks = isReplyData;
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
    const canModifySuggestion = post.status !== "scheduled" && post.status !== "posted";
    const suggestionLabel = isReplyData ? "Dashboard AI suggestion to reply" : "Post suggestion";
    const updateTitle = isReplyData ? "Generate new reply suggestion" : "Generate new post suggestion";

    if (isCommentWorkflow) {
      return (
        <article className="studio-post-card studio-reply-card" key={post.id}>
          {showSourceLinks ? (
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
          ) : null}

          {isReplyData ? (
            <div className="studio-reply-section">
              <span className="studio-id">Comment crawled by instructions</span>
              <p>{commentText}</p>
            </div>
          ) : null}

          <div className="studio-reply-section studio-reply-suggestion">
            <div className="studio-reply-section__header">
              <span className="studio-id">{suggestionLabel}</span>
              <div className="studio-row-actions">
                <button
                  className="button-secondary studio-icon-button"
                  type="button"
                  aria-label="Edit suggestion text"
                  title="Edit suggestion text"
                  disabled={!canModifySuggestion}
                  onClick={() => {
                    setEditingPostId(post.id);
                    setEditingPostText(post.post_text);
                  }}
                >
                  <StudioIcon name="edit" />
                </button>
                <button
                  className="button-secondary studio-update-button"
                  type="button"
                  aria-label={updateTitle}
                  title={updateTitle}
                  disabled={!canModifySuggestion || regeneratingPostId === post.id}
                  onClick={() => void regenerateSuggestion(post)}
                >
                  <StudioIcon name="regenerate" />
                  <span>{regeneratingPostId === post.id ? "Updating..." : "Update"}</span>
                </button>
              </div>
            </div>
            <p>{post.post_text}</p>
          </div>

          {scheduledLabel ? (
            <div className="studio-scheduled-actions">
              <p className="studio-scheduled-label">{scheduledLabel}</p>
              <button
                className="button-secondary"
                type="button"
                disabled={unpostingPostId === post.id}
                onClick={() => void unpostSuggestion(post)}
              >
                {unpostingPostId === post.id ? "Unposting..." : "Unpost"}
              </button>
            </div>
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
                <video src={normalizeDashboardMediaUrl(post.media_url)} controls />
              ) : (
                <img src={normalizeDashboardMediaUrl(post.media_url)} alt={`${post.idea || "Studio post"} media`} />
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
          <div className="studio-scheduled-actions">
            <p className="studio-scheduled-label">{scheduledLabel}</p>
            <button
              className="button-secondary"
              type="button"
              disabled={unpostingPostId === post.id}
              onClick={() => void unpostSuggestion(post)}
            >
              {unpostingPostId === post.id ? "Unposting..." : "Unpost"}
            </button>
          </div>
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
  const selectedVisibleSignals = selectedCampaign && selectedCampaignResults
    ? selectedCampaignResults.signals.filter((signal) => isVisibleSignal(signal, selectedCampaign))
    : [];
  const selectedCampaignResultLimit = selectedCampaign && selectedCampaignResults
    ? selectedCampaignResults.runs[0]?.result_limit ?? selectedCampaign.result_limit ?? DEFAULT_CAMPAIGN_RESULT_LIMIT
    : DEFAULT_CAMPAIGN_RESULT_LIMIT;
  const selectedCampaignDisplayStatus = selectedCampaign && selectedCampaignResults
    ? getCampaignDisplayStatus(selectedCampaign, selectedCampaignResults.runs)
    : null;
  const selectedCrawlerTabConfig = CRAWLER_TABS.find((tab) => tab.id === selectedCrawlerTab) ?? CRAWLER_TABS[0];
  const visibleCampaigns = summary.campaigns.filter((campaign) => campaign.campaign_type === selectedCrawlerTabConfig.campaignType);
  const campaignCountsByCrawlerTab = CRAWLER_TABS.reduce<Record<CrawlerTab, number>>((counts, tab) => {
    counts[tab.id] = summary.campaigns.filter((campaign) => campaign.campaign_type === tab.campaignType).length;
    return counts;
  }, { comments: 0, "pain-points": 0 });
  const campaignFormIsCommentsCrawler = campaignForm.campaign_type === "reply";
  const campaignFormTitle = campaignFormIsCommentsCrawler ? "comment searcher" : "painpoint analyzer";

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
                className="button-secondary dashboard-icon-button"
                type="button"
                onClick={() => openEditCampaign(selectedCampaign)}
                aria-label="Edit campaign"
                title="Edit"
              >
                <StudioIcon name="edit" />
              </button>
              <button
                className="button-secondary"
                type="button"
                disabled={rerunningCampaignId === selectedCampaign.id}
                onClick={() => void rerunCampaign(selectedCampaign)}
              >
                {rerunningCampaignId === selectedCampaign.id ? "Rerunning..." : "Rerun"}
              </button>
              <button
                className="button-secondary dashboard-icon-button"
                type="button"
                disabled={refreshing}
                onClick={() => void load({ silent: true })}
                aria-label="Refresh campaign"
                title="Refresh"
              >
                <ArrowPathIcon aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
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
                <span className={`studio-pill studio-pill--${selectedCampaignDisplayStatus?.tone ?? statusTone(selectedCampaign.status)}`}>
                  {selectedCampaignDisplayStatus?.label ?? selectedCampaign.status}
                </span>
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
                <h2>{selectedCampaign.campaign_type === "reply" ? "Reply suggestions" : "Post suggestions"}</h2>
              </div>
              <span className="studio-count">{selectedCampaignResults.posts.length}</span>
            </div>
            {selectedCampaignResults.posts.length > 0 ? (
              <div className="studio-post-grid">
                {selectedCampaignResults.posts.map(renderStrategistPost)}
              </div>
            ) : (
              <div className="studio-strategist-section">
                {selectedVisibleSignals.length === 0 ? (
                  <div className="studio-empty studio-empty--compact">No linked crawler results for this campaign yet.</div>
                ) : (
                  <div className="studio-signal-grid">
                    {selectedVisibleSignals.map(renderSignal)}
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="panel studio-overview">
          <div className="studio-crawler-tabs ui-tabs">
            <SectionTabs
              activeId={selectedCrawlerTab}
              ariaLabel="Studio crawler type"
              className="studio-crawler-tabs__list"
              tabClassName="social-tab"
              activeTabClassName="social-tab--active"
              onChange={setSelectedCrawlerTab}
              items={CRAWLER_TABS.map((tab) => ({
                id: tab.id,
                label: tab.label,
                badge: campaignCountsByCrawlerTab[tab.id],
              }))}
            />
            <div className="ui-tabs__actions studio-tabs__actions">
              <button type="button" onClick={() => openCampaignModal(selectedCrawlerTab)}>
                Create {selectedCrawlerTabConfig.label.toLowerCase()}
              </button>
              <button
                className="button-secondary dashboard-icon-button"
                type="button"
                disabled={refreshing}
                onClick={() => void load({ silent: true })}
                aria-label="Refresh campaigns"
                title="Refresh"
              >
                <ArrowPathIcon aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="studio-overview__campaigns studio-campaigns">
            {visibleCampaigns.length === 0 ? (
              <div className="studio-empty">No {selectedCrawlerTabConfig.label.toLowerCase()} campaigns yet.</div>
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
                {visibleCampaigns.map((campaign) => (
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
                        className="button-secondary dashboard-icon-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditCampaign(campaign);
                        }}
                        aria-label={`Edit ${campaign.name}`}
                        title="Edit"
                      >
                        <StudioIcon name="edit" />
                      </button>
                      <button
                        className="button-secondary studio-danger-button dashboard-icon-button"
                        type="button"
                        disabled={deletingCampaignId === campaign.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteCampaign(campaign);
                        }}
                        aria-label={deletingCampaignId === campaign.id ? `Deleting ${campaign.name}` : `Delete ${campaign.name}`}
                        title={deletingCampaignId === campaign.id ? "Deleting" : "Delete"}
                      >
                        <StudioIcon name="delete" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {editingPost ? (
        <div className="studio-modal-backdrop">
          <section
            aria-labelledby="studio-suggestion-editor-title"
            aria-modal="true"
            className="studio-suggestion-modal panel"
            role="dialog"
          >
            <div className="studio-suggestion-modal__header">
              <div>
                <p className="eyebrow">{editingPostIsReply ? "Reply suggestion" : "Post suggestion"}</p>
                <h2 id="studio-suggestion-editor-title">Edit suggestion text</h2>
              </div>
              <button
                className="button-secondary studio-icon-button"
                type="button"
                aria-label="Close suggestion editor"
                title="Close suggestion editor"
                disabled={savingPostId === editingPost.id}
                onClick={closeSuggestionEditor}
              >
                <StudioIcon name="cancel" />
              </button>
            </div>
            <textarea
              autoFocus
              className="studio-suggestion-modal__textarea"
              value={editingPostText}
              onChange={(event) => setEditingPostText(event.target.value)}
            />
            <div className="studio-modal__actions">
              <button
                className="button-secondary"
                type="button"
                disabled={savingPostId === editingPost.id}
                onClick={closeSuggestionEditor}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingPostId === editingPost.id || !editingPostText.trim()}
                onClick={() => void saveSuggestionEdit(editingPost)}
              >
                {savingPostId === editingPost.id ? "Saving..." : "Save suggestion"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {campaignModalOpen ? (
        <div className="studio-modal-backdrop">
          <form className="studio-modal panel" onSubmit={saveCampaign}>
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">{campaignFormIsCommentsCrawler ? "Comment searcher" : "Painpoint analyzer"}</p>
                <h2>{editingCampaignId ? `Edit ${campaignFormTitle}` : `Create ${campaignFormTitle}`}</h2>
                <p className="studio-muted">
                  {campaignFormIsCommentsCrawler
                    ? "Choose the account that replies and use instructions to guide the comment search."
                    : "Set the crawler name, result count, and instructions."}
                </p>
              </div>
              <ModalCloseButton onClick={closeCampaignModal} label="Close campaign modal" />
            </div>
            <label>
              Name
              <input value={campaignForm.name} onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            {campaignFormIsCommentsCrawler ? availableReplyAccounts.length > 0 ? (
              <div className="studio-check-grid" role="group" aria-label="Campaign account">
                {availableReplyAccounts.map((account) => (
                  <label className="studio-check" key={account.ref}>
                    <input
                      type="radio"
                      name="campaign-account"
                      checked={campaignForm.account_refs[0] === account.ref}
                      onChange={() => setCampaignForm((current) => ({
                        ...current,
                        campaign_type: "reply",
                        account_refs: [account.ref],
                        platforms: [account.platform],
                      }))}
                    />
                    <span>{account.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="studio-muted">Connect an active Twitter/X, Threads, or Reddit account in Config first.</p>
            ) : null}
            <label>
              Results needed
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
                {saving ? "Saving..." : editingCampaignId ? `Save ${campaignFormTitle}` : `Create ${campaignFormTitle}`}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
