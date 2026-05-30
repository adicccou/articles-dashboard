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
import type { NavView } from "../components/TopNav";
import { api } from "../lib/api";
import { hasStudioAppConnection, STUDIO_APP_CONNECTION_REQUIREMENT } from "../lib/studioApps";
import type { StudioAccount, StudioCampaign, StudioCrawlerRun, StudioSignal, StudioStrategistPost, StudioSummary } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import "../styles/studio-page.css";

type Platform = "twitter" | "threads" | "reddit" | "instagram" | "linkedin";

type StudioPageProps = {
  onUpload: (file: File) => Promise<{ key: string; url: string }>;
  onNavigate?: (view: NavView) => void;
};

type CampaignForm = {
  name: string;
  campaign_type: "post" | "reply";
  result_limit: string;
  app_id: string;
  account_refs: string[];
  platforms: Platform[];
  instructions: string;
  depth: PainDepth;
  objective: string;
  target_audience: string;
  pain_theme: string;
  competitors: string;
  exclude: string;
  search_surfaces: string[];
  output_mode: PainOutputMode;
  min_score: string;
  recent_window: PainRecentWindow;
  include_comments: boolean;
  require_evidence: boolean;
  avoid_noise: boolean;
  status: StudioCampaign["status"];
};

type CrawlerTab = "comments" | "pain-points";
type PainDepth = "quick" | "standard" | "deep";
type PainOutputMode = "signals" | "post_ideas" | "reply_targets" | "schedule_drafts";
type PainRecentWindow = "3days" | "week" | "month" | "quarter" | "any";

type PlatformSearchOption = {
  id: string;
  label: string;
  description: string;
  defaultSelected?: boolean;
};

type PainTemplate = {
  id: string;
  label: string;
  objective: string;
  pain_theme?: string;
  target_audience?: string;
  competitors?: string;
  exclude?: string;
  output_mode?: PainOutputMode;
  depth?: PainDepth;
  search_surfaces?: string[];
};

type StudioSetupGate = {
  blocked: boolean;
  headline: string;
  details: string[];
  missingApp: boolean;
  missingAccount: boolean;
  appActionLabel: string;
  accountActionLabel: string;
};

const DEFAULT_CRAWLER_TAB: CrawlerTab = "pain-points";

const PLATFORMS: Array<{ id: Platform; label: string }> = [
  { id: "twitter", label: "Twitter/X" },
  { id: "threads", label: "Threads" },
  { id: "reddit", label: "Reddit" },
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
];

const REPLY_CAPABLE_PLATFORMS = new Set<Platform>(["twitter", "threads", "reddit"]);
const CONNECTED_SEARCH_PLATFORMS = new Set<Platform>(["twitter", "threads", "reddit", "instagram"]);

const DEFAULT_CAMPAIGN_RESULT_LIMIT = 10;
const PAIN_TEMPLATE_STORAGE_KEY = "oilor-studio-pain-agent-templates";

const CRAWLER_TABS: Array<{ id: CrawlerTab; label: string; campaignType: StudioCampaign["campaign_type"] }> = [
  { id: "comments", label: "Comment Searcher", campaignType: "reply" },
  { id: "pain-points", label: "Pain Point Agent", campaignType: "post" },
];

const VISIBLE_CRAWLER_TABS = CRAWLER_TABS.filter((tab) => tab.id === DEFAULT_CRAWLER_TAB);

const PAIN_DEPTHS: Array<{ id: PainDepth; label: string; resultLimit: number; description: string }> = [
  { id: "quick", label: "Quick", resultLimit: 6, description: "Small scan for a fast read." },
  { id: "standard", label: "Standard", resultLimit: 12, description: "Balanced scan for reusable signals." },
  { id: "deep", label: "Deep", resultLimit: 24, description: "Broader scan before planning content." },
];

const PAIN_OUTPUT_MODES: Array<{ id: PainOutputMode; label: string; description: string }> = [
  { id: "signals", label: "Save signals", description: "Collect evidence and pain points only." },
  { id: "post_ideas", label: "Generate post ideas", description: "Turn signals into draft-ready ideas." },
  { id: "reply_targets", label: "Find reply targets", description: "Prioritize posts worth replying to." },
  { id: "schedule_drafts", label: "Schedule-ready drafts", description: "Create drafts shaped for the calendar." },
];

const PAIN_RECENT_WINDOWS: Array<{ id: PainRecentWindow; label: string }> = [
  { id: "3days", label: "Last 3 days" },
  { id: "week", label: "Last week" },
  { id: "month", label: "Last month" },
  { id: "quarter", label: "Last 90 days" },
  { id: "any", label: "Any time" },
];

const PLATFORM_SEARCH_OPTIONS: Record<Platform, PlatformSearchOption[]> = {
  twitter: [
    {
      id: "twitter_recent_posts",
      label: "Recent keyword posts",
      description: "X API recent search with the connected account credentials.",
      defaultSelected: true,
    },
    {
      id: "twitter_live_replies",
      label: "Live reply threads",
      description: "Search for reply-like conversations and complaints.",
    },
  ],
  threads: [
    {
      id: "threads_keyword_top",
      label: "Top keyword posts",
      description: "Threads keyword_search using TOP ranking.",
      defaultSelected: true,
    },
    {
      id: "threads_conversation_replies",
      label: "Conversation replies",
      description: "Use reply/comment context when the API returns reply metadata.",
    },
  ],
  reddit: [
    {
      id: "reddit_subreddit_posts",
      label: "Subreddit post search",
      description: "Reddit OAuth search inside selected or instructed subreddits.",
      defaultSelected: true,
    },
    {
      id: "reddit_comment_threads",
      label: "Comment threads",
      description: "Prioritize discussions with useful comment evidence.",
    },
  ],
  instagram: [],
  linkedin: [],
};

const BUILTIN_PAIN_TEMPLATES: PainTemplate[] = [
  {
    id: "complaints",
    label: "Find complaints",
    objective: "Find repeated complaints, broken workflows, and moments where people sound frustrated.",
    pain_theme: "workflow friction, missing features, confusing steps",
    output_mode: "post_ideas",
    depth: "standard",
  },
  {
    id: "feature-requests",
    label: "Feature requests",
    objective: "Find people asking for features, workarounds, integrations, or better ways to solve this job.",
    pain_theme: "feature requests, workarounds, unmet needs",
    output_mode: "signals",
    depth: "standard",
  },
  {
    id: "competitor-frustration",
    label: "Competitor frustration",
    objective: "Find users frustrated with competitor tools and capture what they wish was different.",
    pain_theme: "competitor alternatives, switching intent, pricing objections",
    output_mode: "post_ideas",
    depth: "deep",
  },
  {
    id: "pricing-objections",
    label: "Pricing objections",
    objective: "Find objections around price, value, limits, trials, and upgrade decisions.",
    pain_theme: "pricing, value proof, upgrade objections",
    output_mode: "post_ideas",
    depth: "standard",
  },
  {
    id: "reply-opportunities",
    label: "Reply opportunities",
    objective: "Find posts where a helpful, non-salesy reply could answer the user's problem.",
    pain_theme: "questions, stuck users, advice requests",
    output_mode: "reply_targets",
    depth: "quick",
  },
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
    depth: "standard",
    objective: "",
    target_audience: "",
    pain_theme: "",
    competitors: "",
    exclude: "",
    search_surfaces: defaultSearchSurfacesForPlatforms(["threads"]),
    output_mode: "post_ideas",
    min_score: "60",
    recent_window: "month",
    include_comments: true,
    require_evidence: true,
    avoid_noise: true,
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
  if (platform === "instagram") return "Instagram";
  if (platform === "linkedin") return "LinkedIn";
  return platform;
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function platformForSearchSurface(surfaceId: string): Platform | null {
  for (const [platform, options] of Object.entries(PLATFORM_SEARCH_OPTIONS) as Array<[Platform, PlatformSearchOption[]]>) {
    if (options.some((option) => option.id === surfaceId)) return platform;
  }
  return null;
}

function defaultSearchSurfacesForPlatforms(platforms: Platform[]) {
  return platforms.flatMap((platform) => {
    const defaults = PLATFORM_SEARCH_OPTIONS[platform].filter((option) => option.defaultSelected);
    return (defaults.length > 0 ? defaults : PLATFORM_SEARCH_OPTIONS[platform].slice(0, 1)).map((option) => option.id);
  });
}

function validSearchSurfacesForPlatforms(surfaceIds: string[], platforms: Platform[]) {
  const platformSet = new Set(platforms);
  return uniqueValues(surfaceIds.filter((surfaceId) => {
    const platform = platformForSearchSurface(surfaceId);
    return Boolean(platform && platformSet.has(platform));
  }));
}

function accountRefsForPlatforms(platforms: Platform[], accounts: StudioAccount[]) {
  return platforms
    .map((platform) => accounts.find((account) => account.platform === platform && account.status === "active")?.ref)
    .filter((ref): ref is string => Boolean(ref));
}

function painDepthConfig(depth: PainDepth) {
  return PAIN_DEPTHS.find((item) => item.id === depth) ?? PAIN_DEPTHS[1];
}

function outputModeConfig(mode: PainOutputMode) {
  return PAIN_OUTPUT_MODES.find((item) => item.id === mode) ?? PAIN_OUTPUT_MODES[1];
}

function firstSentence(value: string, fallback: string) {
  const cleaned = " ".concat(value).trim();
  if (!cleaned) return fallback;
  return cleaned.replace(/\s+/g, " ").slice(0, 72);
}

function readCustomPainTemplates(): PainTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PAIN_TEMPLATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: String(item?.id ?? ""),
        label: String(item?.label ?? ""),
        objective: String(item?.objective ?? ""),
        pain_theme: item?.pain_theme ? String(item.pain_theme) : undefined,
        target_audience: item?.target_audience ? String(item.target_audience) : undefined,
        competitors: item?.competitors ? String(item.competitors) : undefined,
        exclude: item?.exclude ? String(item.exclude) : undefined,
        output_mode: item?.output_mode as PainOutputMode | undefined,
        depth: item?.depth as PainDepth | undefined,
        search_surfaces: Array.isArray(item?.search_surfaces) ? item.search_surfaces.map(String) : undefined,
      }))
      .filter((item) => item.id && item.label && item.objective)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function writeCustomPainTemplates(templates: PainTemplate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PAIN_TEMPLATE_STORAGE_KEY, JSON.stringify(templates.slice(0, 12)));
}

function selectedSearchSurfaceLabels(surfaceIds: string[]) {
  const labels: string[] = [];
  for (const option of Object.values(PLATFORM_SEARCH_OPTIONS).flat()) {
    if (surfaceIds.includes(option.id)) labels.push(option.label);
  }
  return labels;
}

function buildPainCampaignName(form: CampaignForm, appName?: string | null) {
  const base = firstSentence(form.objective || form.pain_theme, "Pain point search");
  const prefix = appName ? `${appName}: ` : "";
  return `${prefix}${base}`.slice(0, 96);
}

function buildPainAgentInstructions(form: CampaignForm, appName?: string | null) {
  const depth = painDepthConfig(form.depth);
  const outputMode = outputModeConfig(form.output_mode);
  const platformNames = form.platforms.map(platformLabel).join(", ");
  const surfaceNames = selectedSearchSurfaceLabels(form.search_surfaces).join(", ");
  const quality = [
    `minimum opportunity score ${form.min_score || "60"}`,
    `time window ${PAIN_RECENT_WINDOWS.find((item) => item.id === form.recent_window)?.label ?? "Last month"}`,
    form.include_comments ? "include comments/replies when available" : "focus on source posts only",
    form.require_evidence ? "require clear evidence snippets and URLs" : "allow weaker evidence if the theme repeats",
    form.avoid_noise ? "filter spam, giveaways, generic news, and low-intent chatter" : "allow broader noisy discovery",
  ];

  return [
    `Pain Point Agent objective: ${form.objective.trim()}`,
    appName ? `Product/app: ${appName}` : "",
    form.target_audience.trim() ? `Target audience: ${form.target_audience.trim()}` : "",
    form.pain_theme.trim() ? `Pain theme: ${form.pain_theme.trim()}` : "",
    form.competitors.trim() ? `Competitors/alternatives to watch: ${form.competitors.trim()}` : "",
    form.exclude.trim() ? `Exclude: ${form.exclude.trim()}` : "",
    `Platforms: ${platformNames}`,
    `Connected-account search surfaces: ${surfaceNames || "default platform search APIs"}`,
    `Depth: ${depth.label} search; collect about ${depth.resultLimit} high-quality accepted signals.`,
    `Quality controls: ${quality.join("; ")}.`,
    `Output mode: ${outputMode.label}. ${outputMode.description}`,
    "Save each useful result with the pain point, evidence snippet, source URL, audience, and opportunity score.",
  ].filter(Boolean).join("\n");
}

function buildPainSearchPlan(form: CampaignForm, appName?: string | null) {
  const product = appName?.trim() || "the selected product";
  const objective = form.objective.trim();
  const theme = form.pain_theme.trim();
  const competitors = form.competitors.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
  const querySeeds = [
    objective,
    theme ? `${product} ${theme}` : "",
    `${product} pain points complaints`,
    `${product} alternative frustration`,
    ...competitors.map((competitor) => `${competitor} alternative complaint`),
  ].filter(Boolean);
  const queries = uniqueValues(querySeeds.map((item) => item.replace(/\s+/g, " ").trim())).slice(0, 5);
  return {
    queries,
    platforms: form.platforms.map(platformLabel),
    surfaces: selectedSearchSurfaceLabels(form.search_surfaces),
    depth: painDepthConfig(form.depth),
    outputMode: outputModeConfig(form.output_mode),
  };
}

function buildStudioSetupGate(
  tab: CrawlerTab,
  activeAppCount: number,
  configuredAppCount: number,
  replyAccountCount: number,
  searchPlatformCount: number,
): StudioSetupGate {
  const missingApp = configuredAppCount === 0;
  const missingAccount = tab === "comments" ? replyAccountCount === 0 : searchPlatformCount === 0;
  const details: string[] = [];

  if (missingApp) {
    details.push(
      activeAppCount > 0
        ? `Finish app setup first. Active apps need at least one ${STUDIO_APP_CONNECTION_REQUIREMENT} before Studio can use them.`
        : `Add an active app with at least one ${STUDIO_APP_CONNECTION_REQUIREMENT} before starting Studio.`,
    );
  }

  if (missingAccount) {
    details.push(
      tab === "comments"
        ? "Connect at least one active Twitter/X, Threads, or Reddit account before creating a comment searcher."
        : "Connect at least one active Twitter/X, Threads, or Reddit account with search access before creating a pain-point agent.",
    );
  }

  return {
    blocked: missingApp || missingAccount,
    headline:
      tab === "comments"
        ? "Complete setup before creating a comment searcher."
        : "Complete setup before creating a pain-point agent.",
    details,
    missingApp,
    missingAccount,
    appActionLabel: activeAppCount > 0 ? "Finish app setup" : "Add app",
    accountActionLabel: tab === "comments" ? "Connect reply account" : "Connect search account",
  };
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

function latestRunForCampaign(runs: StudioCrawlerRun[]) {
  return sortRunsNewestFirst(runs)[0] ?? null;
}

function isActiveCrawlerRun(run: StudioCrawlerRun | null | undefined) {
  return run?.status === "pending" || run?.status === "running";
}

function formatElapsedTime(value: string | null | undefined) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function runProgressState(run: StudioCrawlerRun, campaign?: StudioCampaign | null) {
  const startedAt = run.started_at || run.created_at;
  const elapsedMinutes = startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000))
    : 0;
  const isReply = (campaign?.campaign_type ?? run.campaign_type) === "reply";
  const resultLabel = isReply ? "reply targets" : "pain signals and post ideas";
  const platforms = (campaign?.platforms ?? run.platforms).map(platformLabel).join(", ") || "selected platforms";

  if (run.status === "pending") {
    return {
      label: "Queued",
      detail: `Waiting for the crawler worker to start ${platforms}.`,
      elapsed: formatElapsedTime(run.created_at),
      step: 0,
      resultLabel,
    };
  }

  if (elapsedMinutes >= 6) {
    return {
      label: "Deep retry search",
      detail: `Still searching ${platforms} and re-checking weak results with AI filters.`,
      elapsed: formatElapsedTime(startedAt),
      step: 2,
      resultLabel,
    };
  }

  if (elapsedMinutes >= 3) {
    return {
      label: "Filtering with AI",
      detail: `Reading captured pages and scoring useful ${resultLabel}.`,
      elapsed: formatElapsedTime(startedAt),
      step: 2,
      resultLabel,
    };
  }

  return {
    label: "Searching connected accounts",
    detail: `Searching ${platforms} with the selected connected accounts.`,
    elapsed: formatElapsedTime(startedAt),
    step: 1,
    resultLabel,
  };
}

function getCampaignDisplayStatus(
  campaign: StudioCampaign,
  runs: StudioCrawlerRun[],
): { label: string; tone: string } {
  const latestRun = latestRunForCampaign(runs);
  if (!latestRun) {
    return { label: campaign.status, tone: statusTone(campaign.status) };
  }
  if (latestRun.status === "pending") {
    return { label: "Queued", tone: statusTone("pending") };
  }
  if (latestRun.status === "running") {
    return { label: "Searching", tone: statusTone("running") };
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

export function StudioPage({ onUpload, onNavigate }: StudioPageProps) {
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
  const [rerunAfterSave, setRerunAfterSave] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [deletingCampaignId, setDeletingCampaignId] = useState<number | null>(null);
  const [rerunningCampaignId, setRerunningCampaignId] = useState<number | null>(null);
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(emptyCampaignForm);
  const [customPainTemplates, setCustomPainTemplates] = useState<PainTemplate[]>(readCustomPainTemplates);
  const [templateName, setTemplateName] = useState("");
  const [selectedCrawlerTab, setSelectedCrawlerTab] = useState<CrawlerTab>(DEFAULT_CRAWLER_TAB);
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
    writeCustomPainTemplates(customPainTemplates);
  }, [customPainTemplates]);

  useEffect(() => {
    if (selectedCampaignId && !summary.campaigns.some((campaign) => campaign.id === selectedCampaignId)) {
      setSelectedCampaignId(null);
    }
  }, [selectedCampaignId, summary.campaigns]);

  const runsById = useMemo(
    () => new Map(summary.crawler_runs.map((run) => [run.id, run])),
    [summary.crawler_runs],
  );

  const activeStudioRuns = useMemo(
    () => summary.crawler_runs.filter(isActiveCrawlerRun),
    [summary.crawler_runs],
  );

  useEffect(() => {
    if (campaignModalOpen || activeStudioRuns.length === 0) return;
    const refreshId = window.setInterval(() => {
      void load({ silent: true });
    }, 12000);
    return () => window.clearInterval(refreshId);
  }, [activeStudioRuns.length, campaignModalOpen]);

  const activeApps = useMemo(
    () => summary.apps.filter((app) => app.status === "active"),
    [summary.apps],
  );

  const availableApps = useMemo(
    () => activeApps.filter(hasStudioAppConnection),
    [activeApps],
  );

  const availableAccounts = useMemo(
    () => summary.accounts.filter((account) => account.status === "active"),
    [summary.accounts],
  );

  const availablePlatforms = useMemo(
    () => PLATFORMS.filter((platform) => availableAccounts.some((account) => account.platform === platform.id)),
    [availableAccounts],
  );

  const availableSearchPlatforms = useMemo(
    () => availablePlatforms.filter((platform) => CONNECTED_SEARCH_PLATFORMS.has(platform.id)),
    [availablePlatforms],
  );

  const unavailableSearchPlatforms = useMemo(
    () => availablePlatforms.filter((platform) => !CONNECTED_SEARCH_PLATFORMS.has(platform.id)),
    [availablePlatforms],
  );

  const availableSearchAccounts = useMemo(
    () => availableAccounts.filter((account) => CONNECTED_SEARCH_PLATFORMS.has(account.platform)),
    [availableAccounts],
  );

  const unavailableSearchAccounts = useMemo(
    () => availableAccounts.filter((account) => !CONNECTED_SEARCH_PLATFORMS.has(account.platform)),
    [availableAccounts],
  );

  const accountLabelByRef = useMemo(
    () => new Map(summary.accounts.map((account) => [account.ref, account.label])),
    [summary.accounts],
  );

  const selectedFormApp = useMemo(
    () => availableApps.find((app) => String(app.id) === campaignForm.app_id) ?? availableApps[0] ?? null,
    [availableApps, campaignForm.app_id],
  );

  const painSearchPlan = useMemo(
    () => buildPainSearchPlan(campaignForm, selectedFormApp?.name),
    [campaignForm, selectedFormApp?.name],
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

  const setupGatesByTab = useMemo<Record<CrawlerTab, StudioSetupGate>>(() => ({
    comments: buildStudioSetupGate("comments", activeApps.length, availableApps.length, availableReplyAccounts.length, availableSearchPlatforms.length),
    "pain-points": buildStudioSetupGate("pain-points", activeApps.length, availableApps.length, availableReplyAccounts.length, availableSearchPlatforms.length),
  }), [activeApps.length, availableApps.length, availableReplyAccounts.length, availableSearchPlatforms.length]);

  function openConfigSetup(tab: "apps" | "accounts", modal: "app" | "account") {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("config_tab", tab);
      url.searchParams.set("config_modal", modal);
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) {
        window.history.replaceState(window.history.state, "", nextUrl);
      }
      if (!onNavigate) {
        window.location.assign(nextUrl);
        return;
      }
    }
    setError(null);
    setFeedback(null);
    onNavigate?.("config");
  }

  function buildEmptyCampaignForm(tab: CrawlerTab = selectedCrawlerTab): CampaignForm {
    const tabConfig = CRAWLER_TABS.find((item) => item.id === tab) ?? CRAWLER_TABS[0];
    const replyAccount = availableReplyAccounts[0] ?? null;
    const painPlatforms = availableSearchPlatforms.map((platform) => platform.id);
    return {
      name: "",
      campaign_type: tabConfig.campaignType,
      result_limit: String(tabConfig.campaignType === "reply" ? DEFAULT_CAMPAIGN_RESULT_LIMIT : painDepthConfig("standard").resultLimit),
      app_id: availableApps[0] ? String(availableApps[0].id) : "",
      account_refs: tabConfig.campaignType === "reply" && replyAccount ? [replyAccount.ref] : accountRefsForPlatforms(painPlatforms, availableAccounts),
      platforms: tabConfig.campaignType === "reply" && replyAccount ? [replyAccount.platform] : painPlatforms,
      instructions: "",
      depth: "standard",
      objective: "",
      target_audience: "",
      pain_theme: "",
      competitors: "",
      exclude: "",
      search_surfaces: defaultSearchSurfacesForPlatforms(painPlatforms),
      output_mode: "post_ideas",
      min_score: "60",
      recent_window: "month",
      include_comments: true,
      require_evidence: true,
      avoid_noise: true,
      status: "active",
    };
  }

  function openCampaignModal(tab: CrawlerTab = selectedCrawlerTab) {
    setSelectedCrawlerTab(tab);
    const setupGate = setupGatesByTab[tab];
    if (setupGate.blocked) {
      setError(setupGate.details.join(" "));
      setFeedback(null);
      return;
    }
    setCampaignForm(buildEmptyCampaignForm(tab));
    setEditingCampaignId(null);
    setCampaignModalOpen(true);
    setFeedback(null);
    setError(null);
  }

  function openEditCampaign(campaign: StudioCampaign, options?: { rerunAfterSave?: boolean }) {
    const isReply = campaign.campaign_type === "reply";
    const selectedPlatform = campaign.platforms.find((platform) => availablePlatforms.some((item) => item.id === platform))
      ?? availablePlatforms[0]?.id
      ?? campaign.platforms[0]
      ?? "threads";
    const painPlatforms = campaign.platforms.filter((platform) => availableSearchPlatforms.some((item) => item.id === platform));
    const selectedAccountRef = campaign.account_refs.find((ref) => {
      const account = availableAccounts.find((item) => item.ref === ref);
      return account?.platform === selectedPlatform;
    }) ?? availableAccounts.find((account) => account.platform === selectedPlatform)?.ref ?? "";
    const nextPlatforms = isReply
      ? availablePlatforms.some((item) => item.id === selectedPlatform)
        ? [selectedPlatform]
        : []
      : painPlatforms.length > 0
      ? painPlatforms
      : availableSearchPlatforms.map((platform) => platform.id);

    setCampaignForm({
      name: campaign.name,
      campaign_type: campaign.campaign_type,
      result_limit: String(campaign.result_limit ?? DEFAULT_CAMPAIGN_RESULT_LIMIT),
      app_id: availableApps.some((app) => app.id === campaign.app_id)
        ? String(campaign.app_id)
        : availableApps[0]
        ? String(availableApps[0].id)
        : "",
      account_refs: isReply
        ? selectedAccountRef ? [selectedAccountRef] : []
        : campaign.account_refs.length > 0
        ? campaign.account_refs
        : accountRefsForPlatforms(nextPlatforms, availableAccounts),
      platforms: nextPlatforms,
      instructions: campaign.instructions,
      depth: campaign.result_limit >= 20 ? "deep" : campaign.result_limit <= 6 ? "quick" : "standard",
      objective: isReply ? "" : campaign.instructions,
      target_audience: "",
      pain_theme: "",
      competitors: "",
      exclude: "",
      search_surfaces: defaultSearchSurfacesForPlatforms(nextPlatforms),
      output_mode: isReply ? "reply_targets" : "post_ideas",
      min_score: "60",
      recent_window: "month",
      include_comments: true,
      require_evidence: true,
      avoid_noise: true,
      status: campaign.status,
    });
    setEditingCampaignId(campaign.id);
    setRerunAfterSave(Boolean(options?.rerunAfterSave));
    setCampaignModalOpen(true);
    setFeedback(null);
    setError(null);
  }

  function closeCampaignModal() {
    setCampaignModalOpen(false);
    setEditingCampaignId(null);
    setRerunAfterSave(false);
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
      const connectedSearchPlatformIds = availableSearchPlatforms.map((platform) => platform.id);
      const currentSearchPlatforms = current.platforms.filter((platform) => connectedSearchPlatformIds.includes(platform));
      const painPlatforms = currentSearchPlatforms.length > 0 ? currentSearchPlatforms : connectedSearchPlatformIds;
      const nextAccountRefs = isReply && selectedAccount ? [selectedAccount.ref] : [];
      const nextPlatforms = isReply && selectedAccount ? [selectedAccount.platform] : painPlatforms;
      const nextPainAccountRefs = isReply ? nextAccountRefs : accountRefsForPlatforms(nextPlatforms, availableAccounts);
      const nextSearchSurfaces = isReply
        ? current.search_surfaces
        : validSearchSurfacesForPlatforms(current.search_surfaces, nextPlatforms).length > 0
        ? validSearchSurfacesForPlatforms(current.search_surfaces, nextPlatforms)
        : defaultSearchSurfacesForPlatforms(nextPlatforms);
      const changed = nextAppId !== current.app_id
        || nextPlatforms.join(",") !== current.platforms.join(",")
        || nextPainAccountRefs.join(",") !== current.account_refs.join(",")
        || nextSearchSurfaces.join(",") !== current.search_surfaces.join(",");
      return changed
        ? {
            ...current,
            app_id: nextAppId,
            platforms: nextPlatforms,
            account_refs: nextPainAccountRefs,
            search_surfaces: nextSearchSurfaces,
          }
        : current;
    });
  }, [availableAccounts, availableApps, availableReplyAccounts, availableSearchPlatforms, campaignModalOpen]);

  function closeSuggestionEditor() {
    if (savingPostId) return;
    setEditingPostId(null);
    setEditingPostText("");
  }

  function togglePainAccount(account: typeof availableAccounts[number]) {
    setCampaignForm((current) => {
      const account_refs = current.account_refs.includes(account.ref)
        ? current.account_refs.filter((ref) => ref !== account.ref)
        : uniqueValues([...current.account_refs, account.ref]);
      const platforms = uniqueValues(
        availableAccounts
          .filter((acc) => account_refs.includes(acc.ref))
          .map((acc) => acc.platform)
      );
      const searchSurfaces = validSearchSurfacesForPlatforms(current.search_surfaces, platforms);
      return {
        ...current,
        account_refs,
        platforms,
        search_surfaces: searchSurfaces.length > 0 ? searchSurfaces : defaultSearchSurfacesForPlatforms(platforms),
      };
    });
  }

  function togglePainPlatform(platform: Platform) {
    setCampaignForm((current) => {
      const platforms = current.platforms.includes(platform)
        ? current.platforms.filter((item) => item !== platform)
        : uniqueValues([...current.platforms, platform]);
      const searchSurfaces = validSearchSurfacesForPlatforms(current.search_surfaces, platforms);
      return {
        ...current,
        platforms,
        account_refs: accountRefsForPlatforms(platforms, availableAccounts),
        search_surfaces: searchSurfaces.length > 0 ? searchSurfaces : defaultSearchSurfacesForPlatforms(platforms),
      };
    });
  }

  function toggleSearchSurface(surfaceId: string) {
    setCampaignForm((current) => ({
      ...current,
      search_surfaces: current.search_surfaces.includes(surfaceId)
        ? current.search_surfaces.filter((item) => item !== surfaceId)
        : uniqueValues([...current.search_surfaces, surfaceId]),
    }));
  }

  function applyPainTemplate(template: PainTemplate) {
    setCampaignForm((current) => {
      const searchSurfaces = template.search_surfaces
        ? validSearchSurfacesForPlatforms(template.search_surfaces, current.platforms)
        : [];
      return {
        ...current,
        objective: template.objective,
        pain_theme: template.pain_theme ?? current.pain_theme,
        target_audience: template.target_audience ?? current.target_audience,
        competitors: template.competitors ?? current.competitors,
        exclude: template.exclude ?? current.exclude,
        output_mode: template.output_mode ?? current.output_mode,
        depth: template.depth ?? current.depth,
        result_limit: String(painDepthConfig(template.depth ?? current.depth).resultLimit),
        search_surfaces: searchSurfaces.length > 0 ? searchSurfaces : current.search_surfaces,
      };
    });
  }

  function savePainTemplate() {
    const objective = campaignForm.objective.trim();
    if (!objective) {
      setError("Add an investigation objective before saving a template.");
      return;
    }
    const label = templateName.trim() || firstSentence(objective, "Pain template");
    setCustomPainTemplates((current) => [
      {
        id: `custom-${Date.now()}`,
        label,
        objective,
        pain_theme: campaignForm.pain_theme.trim() || undefined,
        target_audience: campaignForm.target_audience.trim() || undefined,
        competitors: campaignForm.competitors.trim() || undefined,
        exclude: campaignForm.exclude.trim() || undefined,
        output_mode: campaignForm.output_mode,
        depth: campaignForm.depth,
        search_surfaces: campaignForm.search_surfaces,
      },
      ...current,
    ].slice(0, 12));
    setTemplateName("");
    setFeedback(`Template "${label}" saved on this browser.`);
    setError(null);
  }

  function deletePainTemplate(templateId: string) {
    setCustomPainTemplates((current) => current.filter((template) => template.id !== templateId));
  }

  async function saveCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isReplyCampaign = campaignForm.campaign_type === "reply";
    const isPainAgent = !isReplyCampaign;
    const setupGate = setupGatesByTab[isReplyCampaign ? "comments" : "pain-points"];
    if (setupGate.blocked) {
      setError(setupGate.details.join(" "));
      return;
    }
    if (isPainAgent && !campaignForm.objective.trim()) {
      setError("Tell the Pain Point Agent what to investigate.");
      return;
    }
    if (!campaignForm.app_id) {
      setError("Product selection is required.");
      return;
    }
    if (isReplyCampaign && !campaignForm.name.trim()) {
      setError("Campaign name is required.");
      return;
    }
    if (campaignForm.platforms.length === 0) {
      setError("Choose at least one connected search platform.");
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
    if (isPainAgent && campaignForm.search_surfaces.length === 0) {
      setError("Choose at least one search API option.");
      return;
    }
    if (isReplyCampaign && !campaignForm.instructions.trim()) {
      setError("Comment search instructions are required.");
      return;
    }
    const resultLimit = isPainAgent
      ? painDepthConfig(campaignForm.depth).resultLimit
      : Math.round(Number(campaignForm.result_limit));
    if (!Number.isFinite(resultLimit) || resultLimit < 1 || resultLimit > 50) {
      setError("Results needed must be a number from 1 to 50.");
      return;
    }
    try {
      setSaving(true);
      const instructions = isPainAgent
        ? buildPainAgentInstructions(campaignForm, selectedFormApp?.name)
        : campaignForm.instructions.trim();
      const name = isPainAgent
        ? campaignForm.name.trim() || buildPainCampaignName(campaignForm, selectedFormApp?.name)
        : campaignForm.name.trim();
      const accountRefs = isPainAgent
        ? accountRefsForPlatforms(campaignForm.platforms, availableAccounts)
        : campaignForm.account_refs;
      const payload = {
        name,
        app_id: Number(campaignForm.app_id),
        campaign_type: campaignForm.campaign_type,
        result_limit: resultLimit,
        account_refs: accountRefs,
        search_surfaces: campaignForm.search_surfaces,
        platforms: campaignForm.platforms,
        instructions,
        status: campaignForm.status,
      };

      if (editingCampaignId) {
        await api.updateStudioCampaign(editingCampaignId, payload);
        if (rerunAfterSave) {
          const run = await api.createStudioCrawlerRun({
            campaign_id: editingCampaignId,
            result_limit: resultLimit,
            search_surfaces: campaignForm.search_surfaces,
          });
          setSelectedCampaignId(editingCampaignId);
          setFeedback(`${studioId("CMP", editingCampaignId)} updated and ${studioId("CR", run.id)} queued. Progress will auto-refresh while the agent searches.`);
        } else {
          setFeedback(`${studioId("CMP", editingCampaignId)} updated.`);
        }
      } else {
        const campaign = await api.createStudioCampaign(payload);
        const run = await api.createStudioCrawlerRun({
          campaign_id: campaign.id,
          result_limit: resultLimit,
          search_surfaces: campaignForm.search_surfaces,
        });
        setSelectedCampaignId(campaign.id);
        setFeedback(`${studioId("CMP", campaign.id)} created and ${studioId("CR", run.id)} queued. Progress will auto-refresh while the agent searches.`);
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
    const setupGate = setupGatesByTab[campaign.campaign_type === "reply" ? "comments" : "pain-points"];
    if (setupGate.blocked) {
      setError(setupGate.details.join(" "));
      return;
    }

    try {
      setRerunningCampaignId(campaign.id);
      setError(null);
      const run = await api.createStudioCrawlerRun({
        campaign_id: campaign.id,
        search_surfaces: campaign.search_surfaces?.length
          ? campaign.search_surfaces
          : defaultSearchSurfacesForPlatforms(campaign.platforms as Platform[]),
      });
      setFeedback(`${studioId("CR", run.id)} queued. Progress will auto-refresh while the agent searches.`);
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
  const selectedLatestRun = selectedCampaignResults ? latestRunForCampaign(selectedCampaignResults.runs) : null;
  const selectedRunProgress = selectedLatestRun && isActiveCrawlerRun(selectedLatestRun)
    ? runProgressState(selectedLatestRun, selectedCampaign)
    : null;
  const selectedVisibleSignals = selectedCampaign && selectedCampaignResults
    ? selectedCampaignResults.signals.filter((signal) => isVisibleSignal(signal, selectedCampaign))
    : [];
  const selectedCampaignResultLimit = selectedCampaign && selectedCampaignResults
    ? selectedLatestRun?.result_limit ?? selectedCampaign.result_limit ?? DEFAULT_CAMPAIGN_RESULT_LIMIT
    : DEFAULT_CAMPAIGN_RESULT_LIMIT;
  const selectedCampaignDisplayStatus = selectedCampaign && selectedCampaignResults
    ? getCampaignDisplayStatus(selectedCampaign, selectedCampaignResults.runs)
    : null;
  const selectedCrawlerTabConfig = VISIBLE_CRAWLER_TABS.find((tab) => tab.id === selectedCrawlerTab) ?? VISIBLE_CRAWLER_TABS[0];
  const selectedSetupGate = setupGatesByTab[selectedCrawlerTab];
  const visibleCampaigns = summary.campaigns.filter((campaign) => campaign.campaign_type === selectedCrawlerTabConfig.campaignType);
  const visibleActiveRunCount = visibleCampaigns.reduce((count, campaign) => {
    const runs = campaignResultsById.get(campaign.id)?.runs ?? [];
    return count + (runs.some(isActiveCrawlerRun) ? 1 : 0);
  }, 0);
  const campaignCountsByCrawlerTab = CRAWLER_TABS.reduce<Record<CrawlerTab, number>>((counts, tab) => {
    counts[tab.id] = summary.campaigns.filter((campaign) => campaign.campaign_type === tab.campaignType).length;
    return counts;
  }, { comments: 0, "pain-points": 0 });
  const campaignFormIsCommentsCrawler = campaignForm.campaign_type === "reply";
  const campaignFormTitle = campaignFormIsCommentsCrawler ? "comment searcher" : "pain point agent";

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
                  onClick={() => openEditCampaign(selectedCampaign, { rerunAfterSave: true })}
                >
                  Rerun with changes
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
            {selectedRunProgress && selectedLatestRun ? (
              <div className="studio-run-progress" aria-live="polite">
                <div className="studio-run-progress__main">
                  <span className="studio-run-spinner" aria-hidden="true" />
                  <div>
                    <span className="studio-id">{studioId("CR", selectedLatestRun.id)}</span>
                    <h3>{selectedRunProgress.label}</h3>
                    <p>{selectedRunProgress.detail}</p>
                  </div>
                </div>
                <div className="studio-run-progress__meta">
                  <span>{selectedRunProgress.elapsed ? `Started ${selectedRunProgress.elapsed}` : "Starting now"}</span>
                  <span>Auto-refreshing every 12s</span>
                </div>
                <div className="studio-run-steps" aria-label="Crawler progress">
                  {["Queued", "Searching", "Filtering", "Results"].map((step, index) => (
                    <span
                      className={`studio-run-step ${index <= selectedRunProgress.step ? "studio-run-step--active" : ""}`}
                      key={step}
                    >
                      {step}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
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
            {VISIBLE_CRAWLER_TABS.length > 1 ? (
              <SectionTabs
                activeId={selectedCrawlerTab}
                ariaLabel="Studio crawler type"
                className="studio-crawler-tabs__list"
                tabClassName="social-tab"
                activeTabClassName="social-tab--active"
                onChange={setSelectedCrawlerTab}
                items={VISIBLE_CRAWLER_TABS.map((tab) => ({
                  id: tab.id,
                  label: tab.label,
                  badge: campaignCountsByCrawlerTab[tab.id],
                }))}
              />
            ) : null}
            <div className="ui-tabs__actions studio-tabs__actions">
              <button
                type="button"
                disabled={selectedSetupGate.blocked}
                onClick={() => openCampaignModal(selectedCrawlerTab)}
                title={selectedSetupGate.blocked ? selectedSetupGate.headline : undefined}
              >
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

          {selectedSetupGate.blocked ? (
            <div className="studio-setup-banner" aria-live="polite">
              <div className="studio-setup-banner__details">
                <strong>{selectedSetupGate.headline}</strong>
                {selectedSetupGate.details.map((detail) => (
                  <p key={detail}>{detail}</p>
                ))}
              </div>
              <div className="studio-setup-banner__actions">
                {selectedSetupGate.missingApp ? (
                  <button type="button" onClick={() => openConfigSetup("apps", "app")}>
                    {selectedSetupGate.appActionLabel}
                  </button>
                ) : null}
                {selectedSetupGate.missingAccount ? (
                  <button className="button-secondary" type="button" onClick={() => openConfigSetup("accounts", "account")}>
                    {selectedSetupGate.accountActionLabel}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {visibleActiveRunCount > 0 ? (
            <div className="studio-run-banner" aria-live="polite">
              <span className="studio-run-spinner" aria-hidden="true" />
              <div>
                <strong>{visibleActiveRunCount} agent {visibleActiveRunCount === 1 ? "run is" : "runs are"} working</strong>
                <p>Studio is searching connected accounts, filtering weak results, and will refresh this list automatically.</p>
              </div>
            </div>
          ) : null}

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
                  <span>Results</span>
                  <span>Instructions</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {visibleCampaigns.map((campaign) => {
                  const campaignResults = campaignResultsById.get(campaign.id) ?? { runs: [], signals: [], posts: [] };
                  const latestRun = latestRunForCampaign(campaignResults.runs);
                  const runProgress = latestRun && isActiveCrawlerRun(latestRun)
                    ? runProgressState(latestRun, campaign)
                    : null;
                  const displayStatus = getCampaignDisplayStatus(campaign, campaignResults.runs);
                  const runCount = campaignResults.runs.length;
                  const signalLabel = campaign.campaign_type === "reply" ? "targets" : "signals";
                  return (
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
                        {campaign.account_refs.map((ref) => accountLabelByRef.get(ref) ?? ref).join(", ") || "Default connected accounts"}
                      </p>
                      <div className="studio-result-summary">
                        <strong>{campaignResults.signals.length}</strong>
                        <span>{signalLabel}</span>
                        <strong>{campaignResults.posts.length}</strong>
                        <span>{campaign.campaign_type === "reply" ? "replies" : "ideas"}</span>
                        <strong>{runCount}</strong>
                        <span>{runCount === 1 ? "run" : "runs"}</span>
                      </div>
                      <p className="studio-card__copy studio-card__copy--clamped" title={campaign.instructions || "No instructions saved."}>
                        {campaign.instructions || "No instructions saved."}
                      </p>
                      <div className="studio-status-stack">
                        <span className={`studio-pill studio-pill--${displayStatus.tone}`}>{displayStatus.label}</span>
                        {runProgress ? (
                          <span className="studio-run-mini">
                            <span className="studio-run-spinner" aria-hidden="true" />
                            <span>{runProgress.label}</span>
                            {runProgress.elapsed ? <small>{runProgress.elapsed}</small> : null}
                          </span>
                        ) : null}
                      </div>
                      <div className="studio-row-actions">
                        <button
                          className="button-secondary"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditCampaign(campaign, { rerunAfterSave: true });
                          }}
                        >
                          Rerun with changes
                        </button>
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
                  );
                })}
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
          <form className={`studio-modal panel ${campaignFormIsCommentsCrawler ? "" : "studio-modal--wide studio-agent-modal"}`} onSubmit={saveCampaign}>
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">{campaignFormIsCommentsCrawler ? "Comment Searcher" : "Pain Point Agent"}</p>
                <h2>{editingCampaignId ? `Edit ${campaignFormTitle}` : `Create ${campaignFormTitle}`}</h2>
                <p className="studio-muted">
                  {campaignFormIsCommentsCrawler
                    ? "Choose the account that replies and use instructions to guide the comment search."
                    : "Tell the agent what to investigate, where to search, and what output to prepare."}
                </p>
              </div>
              <ModalCloseButton onClick={closeCampaignModal} label="Close campaign modal" />
            </div>

            <div className="studio-agent-grid studio-agent-grid--two">
              <label>
                Product
                <select
                  value={campaignForm.app_id}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, app_id: event.target.value }))}
                  required
                >
                  {availableApps.map((app) => (
                    <option value={app.id} key={app.id}>{app.name}</option>
                  ))}
                </select>
                {availableApps.length === 0 ? (
                  <small className="studio-muted">Finish app setup in Config. Studio needs at least one {STUDIO_APP_CONNECTION_REQUIREMENT}.</small>
                ) : null}
              </label>
              <label>
                {campaignFormIsCommentsCrawler ? "Name" : "Run name"}
                <input
                  value={campaignForm.name}
                  placeholder={campaignFormIsCommentsCrawler ? "" : "Auto-generated from the objective"}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))}
                  required={campaignFormIsCommentsCrawler}
                />
              </label>
            </div>

            {campaignFormIsCommentsCrawler ? (
              <>
                {availableReplyAccounts.length > 0 ? (
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
                )}
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
                <label>
                  Instructions
                  <textarea
                    rows={5}
                    value={campaignForm.instructions}
                    onChange={(event) => setCampaignForm((current) => ({ ...current, instructions: event.target.value }))}
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label className="studio-agent-primary">
                  What should the agent investigate?
                  <textarea
                    rows={4}
                    value={campaignForm.objective}
                    placeholder="Example: Find founders complaining that content planning tools are too scattered, manual, or hard to turn into scheduled posts."
                    onChange={(event) => setCampaignForm((current) => ({ ...current, objective: event.target.value }))}
                    required
                  />
                </label>

                <div className="studio-agent-grid">

                  <label>
                    Competitors
                    <input
                      value={campaignForm.competitors}
                      placeholder="Buffer, Hootsuite, Notion, spreadsheets"
                      onChange={(event) => setCampaignForm((current) => ({ ...current, competitors: event.target.value }))}
                    />
                  </label>
                  <label>
                    Exclude
                    <input
                      value={campaignForm.exclude}
                      placeholder="Jobs, giveaways, generic news"
                      onChange={(event) => setCampaignForm((current) => ({ ...current, exclude: event.target.value }))}
                    />
                  </label>
                </div>

                <section className="studio-agent-section">
                  <div className="studio-agent-section__header">
                    <div>
                      <span className="studio-id">Templates</span>
                      <h3>Template manager</h3>
                    </div>
                    <div className="studio-template-save">
                      <input
                        value={templateName}
                        placeholder="Template name"
                        onChange={(event) => setTemplateName(event.target.value)}
                      />
                      <button className="button-secondary" type="button" onClick={savePainTemplate}>
                        Save current
                      </button>
                    </div>
                  </div>
                  <div className="studio-template-list">
                    {[...BUILTIN_PAIN_TEMPLATES, ...customPainTemplates].map((template) => (
                      <span className="studio-template-pill" key={template.id}>
                        <button type="button" onClick={() => applyPainTemplate(template)}>
                          {template.label}
                        </button>
                        {template.id.startsWith("custom-") ? (
                          <button
                            aria-label={`Delete template ${template.label}`}
                            className="studio-template-delete"
                            type="button"
                            onClick={() => deletePainTemplate(template.id)}
                          >
                            x
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </section>

                <section className="studio-agent-section">
                  <div className="studio-agent-section__header">
                    <div>
                      <span className="studio-id">Connected search accounts</span>
                      <h3>Accounts</h3>
                    </div>
                    <span className="studio-count">{campaignForm.account_refs.length}</span>
                  </div>
                  {availableSearchAccounts.length > 0 ? (
                    <div className="studio-check-grid" role="group" aria-label="Accounts">
                      {availableSearchAccounts.map((account) => {
                        const checked = campaignForm.account_refs.includes(account.ref);
                        return (
                          <label className="studio-check" key={account.ref}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePainAccount(account)}
                            />
                            <span>{account.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="studio-empty studio-empty--compact">Connect a Twitter/X, Threads, Reddit, or Instagram account before starting a pain-point search.</div>
                  )}
                  {unavailableSearchAccounts.length > 0 ? (
                    <p className="studio-muted">
                      {uniqueValues(unavailableSearchAccounts.map((account) => PLATFORMS.find(p => p.id === account.platform)?.label ?? account.platform)).join(", ")} connected for publishing/insights, but not selectable here because the current crawler search APIs do not support them yet.
                    </p>
                  ) : null}
                </section>

                <section className="studio-agent-section">
                  <div className="studio-agent-section__header">
                    <div>
                      <span className="studio-id">Run setup</span>
                      <h3>Depth</h3>
                    </div>
                  </div>
                  <div className="studio-choice-row studio-choice-row--three">
                    {PAIN_DEPTHS.map((depth) => (
                      <button
                        className={`studio-choice ${campaignForm.depth === depth.id ? "studio-choice--active" : ""}`}
                        type="button"
                        key={depth.id}
                        onClick={() => setCampaignForm((current) => ({
                          ...current,
                          depth: depth.id,
                          result_limit: String(depth.resultLimit),
                        }))}
                      >
                        <strong>{depth.label}</strong>
                        <span>{depth.description}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="studio-agent-section">
                  <div className="studio-agent-section__header">
                    <div>
                      <span className="studio-id">Run setup</span>
                      <h3>Output</h3>
                    </div>
                  </div>
                  <div className="studio-choice-row studio-choice-row--four">
                    {PAIN_OUTPUT_MODES.map((mode) => (
                      <button
                        className={`studio-choice ${campaignForm.output_mode === mode.id ? "studio-choice--active" : ""}`}
                        type="button"
                        key={mode.id}
                        onClick={() => setCampaignForm((current) => ({ ...current, output_mode: mode.id }))}
                      >
                        <strong>{mode.label}</strong>
                        <span>{mode.description}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="studio-agent-section">
                  <div className="studio-agent-section__header">
                    <div>
                      <span className="studio-id">Quality controls</span>
                      <h3>Filter rules</h3>
                    </div>
                  </div>
                  <div className="studio-agent-grid">
                    <label>
                      Minimum score
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={campaignForm.min_score}
                        onChange={(event) => setCampaignForm((current) => ({ ...current, min_score: event.target.value }))}
                      />
                    </label>
                    <label>
                      Time window
                      <select
                        value={campaignForm.recent_window}
                        onChange={(event) => setCampaignForm((current) => ({ ...current, recent_window: event.target.value as PainRecentWindow }))}
                      >
                        {PAIN_RECENT_WINDOWS.map((item) => (
                          <option value={item.id} key={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="studio-check">
                      <input
                        type="checkbox"
                        checked={campaignForm.include_comments}
                        onChange={(event) => setCampaignForm((current) => ({ ...current, include_comments: event.target.checked }))}
                      />
                      <span>Include comments and replies</span>
                    </label>
                    <label className="studio-check">
                      <input
                        type="checkbox"
                        checked={campaignForm.require_evidence}
                        onChange={(event) => setCampaignForm((current) => ({ ...current, require_evidence: event.target.checked }))}
                      />
                      <span>Require evidence and source links</span>
                    </label>
                    <label className="studio-check">
                      <input
                        type="checkbox"
                        checked={campaignForm.avoid_noise}
                        onChange={(event) => setCampaignForm((current) => ({ ...current, avoid_noise: event.target.checked }))}
                      />
                      <span>Avoid spam and generic news</span>
                    </label>
                  </div>
                </section>

                <section className="studio-search-plan">
                  <div className="studio-agent-section__header">
                    <div>
                      <span className="studio-id">Search plan preview</span>
                      <h3>{painSearchPlan.depth.label} search {"->"} {painSearchPlan.outputMode.label}</h3>
                    </div>
                  </div>
                  <div className="studio-search-plan__body">
                    <div>
                      <span className="studio-id">Queries</span>
                      <ul>
                        {(painSearchPlan.queries.length > 0 ? painSearchPlan.queries : ["Add an objective to preview queries."]).map((query) => (
                          <li key={query}>{query}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="studio-id">Sources</span>
                      <p>{painSearchPlan.platforms.join(", ") || "No connected search platform selected."}</p>
                      <p>{painSearchPlan.surfaces.join(", ") || "No search API option selected."}</p>
                    </div>
                  </div>
                </section>
              </>
            )}
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
            <div className="studio-modal__actions">
              <button className="button-secondary" type="button" onClick={closeCampaignModal}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingCampaignId
                  ? rerunAfterSave
                    ? "Save & rerun"
                    : `Save ${campaignFormTitle}`
                  : campaignFormIsCommentsCrawler
                  ? `Create ${campaignFormTitle}`
                  : "Start search"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
