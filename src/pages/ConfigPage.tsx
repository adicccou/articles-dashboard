import { useEffect, useState, type FormEvent } from "react";
import { ArrowPathIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/solid";
import type { IconType } from "react-icons";
import { FaFacebookF, FaLinkedinIn } from "react-icons/fa6";
import { SiInstagram, SiReddit, SiThreads, SiX, SiYoutube } from "react-icons/si";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { APIConnectionPanel, type SettingsTabId } from "../components/APIConnectionPanel";
import type { RedditAccount, Site, SocialAccount, SocialAccountInput, StudioApp, AppSettings, AppSettingsInput } from "../lib/types";
import type { DashboardSurface } from "../lib/surface";
import { api } from "../lib/api";
import { formatDisplayDate } from "../lib/datetime";
import "../styles/config-page.css";

type ConfigTab = "apps" | "accounts" | "general" | "ai" | "rules";
type AccountPlatform = "twitter" | "threads" | "reddit" | "facebook" | "linkedin" | "instagram" | "youtube";
type AccountStatus = "active" | "inactive";
type AccountConnectionMode = "official_api";
type ConfigModal = "app" | "account" | "site" | null;

type ConfigPageProps = {
  surface: DashboardSurface;
  settings: AppSettings;
  syncMessage: string | null;
  onSaveSettings: (payload: AppSettingsInput) => Promise<unknown>;
  onSyncAgent: () => Promise<unknown>;
};

type AppForm = {
  id?: number;
  name: string;
  website_url: string;
  app_store_url: string;
  articles_api_url: string;
  description: string;
  ai_context: string;
  status: StudioApp["status"];
};

type SiteForm = {
  id?: number;
  name: string;
  slug: string;
  domain: string;
  status: Site["status"];
};

type AccountForm = {
  id?: number;
  platform: AccountPlatform;
  connection_mode: AccountConnectionMode;
  username: string;
  status: AccountStatus;
  api_key: string;
  api_secret: string;
  access_token: string;
  access_secret: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  scopes: string;
  user_id: string;
  page_id: string;
  refresh_token: string;
  tags: string;
};

type ManagedAccount = {
  id: number;
  platform: AccountPlatform;
  connection_mode: AccountConnectionMode;
  username: string;
  profile_username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  tags?: string[] | null;
  status: AccountStatus;
  credentials_ready?: boolean | number;
  created_at: string;
  updated_at: string;
};

type AppSiteRow = {
  key: string;
  app?: StudioApp;
  site?: Site;
  name: string;
  subtitle: string;
  domain: string | null;
  status: string;
  updatedAt: string;
};

const THREADS_FULL_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_read_replies",
  "threads_manage_replies",
  "threads_keyword_search",
  "threads_manage_insights",
].join(",");

const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
].join(",");

const LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "w_member_social",
].join(" ");

const FACEBOOK_SCOPES = [
  "public_profile",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
].join(",");

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
].join(" ");

const platformOptions: Array<{ id: AccountPlatform; label: string }> = [
  { id: "twitter", label: "Twitter/X" },
  { id: "threads", label: "Threads" },
  { id: "reddit", label: "Reddit" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
];

const platformIcons: Record<AccountPlatform, IconType> = {
  twitter: SiX,
  threads: SiThreads,
  reddit: SiReddit,
  facebook: FaFacebookF,
  linkedin: FaLinkedinIn,
  instagram: SiInstagram,
  youtube: SiYoutube,
};

const hiddenAccountPlatforms = new Set<AccountPlatform>(["youtube"]);

function emptyAppForm(): AppForm {
  return {
    name: "",
    website_url: "",
    app_store_url: "",
    articles_api_url: "",
    description: "",
    ai_context: "",
    status: "active",
  };
}

function emptySiteForm(): SiteForm {
  return {
    name: "",
    slug: "",
    domain: "",
    status: "active",
  };
}

function emptyAccountForm(platform: AccountPlatform = "twitter"): AccountForm {
  return {
    platform,
    connection_mode: "official_api",
    username: "",
    status: "active",
    api_key: "",
    api_secret: "",
    access_token: "",
    access_secret: "",
    client_id: "",
    client_secret: "",
    redirect_uri: "",
    scopes:
      platform === "threads"
        ? THREADS_FULL_SCOPES
        : platform === "facebook"
        ? FACEBOOK_SCOPES
        : platform === "linkedin"
        ? LINKEDIN_SCOPES
        : platform === "instagram"
        ? INSTAGRAM_SCOPES
        : platform === "youtube"
        ? YOUTUBE_SCOPES
        : "",
    user_id: "",
    page_id: "",
    refresh_token: "",
    tags: "",
  };
}

function platformLabel(platform: AccountPlatform) {
  return platformOptions.find((item) => item.id === platform)?.label ?? platform;
}

function cleanAccountValue(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/^@+/, "");
}

function cleanAccountTag(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 32);
}

function normalizeAccountTags(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
    ? raw.split(/[,\n]+/)
    : [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = cleanAccountTag(value);
    if (!tag || seen.has(tag)) continue;
    tags.push(tag);
    seen.add(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function looksLikeEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value);
}

function prefersAtPrefix(platform: AccountPlatform) {
  return platform === "twitter" || platform === "threads" || platform === "instagram";
}

function resolveProfileUsername(account: Pick<SocialAccount, "username">) {
  return cleanAccountValue(account.username);
}

function accountHandleLabel(account: Pick<ManagedAccount, "platform" | "username" | "profile_username">) {
  const handle = cleanAccountValue(account.profile_username || account.username);
  if (!handle) return platformLabel(account.platform);
  return prefersAtPrefix(account.platform) ? `@${handle}` : handle;
}

function accountSubtitle(account: Pick<ManagedAccount, "platform" | "username" | "profile_username" | "display_name">) {
  const explicitName = String(account.display_name ?? "").trim();
  if (explicitName) return explicitName;

  const storedName = cleanAccountValue(account.username);
  const visibleHandle = cleanAccountValue(account.profile_username || account.username);
  if (storedName && storedName.toLowerCase() !== visibleHandle.toLowerCase()) {
    return storedName;
  }
  return platformLabel(account.platform);
}

function accountAvatarCandidates(account: Pick<ManagedAccount, "id" | "platform" | "username" | "profile_username" | "avatar_url">) {
  const candidates: string[] = [];
  const addCandidate = (value: string | null | undefined) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || candidates.includes(trimmed)) return;
    candidates.push(trimmed);
  };

  if (account.avatar_url) {
    addCandidate(`/api/social/accounts/${account.id}/avatar`);
    addCandidate(account.avatar_url);
  }

  const handle = cleanAccountValue(account.profile_username || account.username);
  if (!handle || looksLikeEmail(handle) || /\s/.test(handle)) return candidates;

  if (account.platform === "twitter") addCandidate(`https://unavatar.io/x/${encodeURIComponent(handle)}`);
  if (account.platform === "threads" || account.platform === "instagram") {
    addCandidate(`https://unavatar.io/instagram/${encodeURIComponent(handle)}`);
  }
  if (account.platform === "reddit") addCandidate(`https://unavatar.io/reddit/${encodeURIComponent(handle)}`);

  return candidates;
}

function accountInitials(account: Pick<ManagedAccount, "platform" | "username" | "profile_username" | "display_name">) {
  const source = accountSubtitle(account) || cleanAccountValue(account.profile_username || account.username) || platformLabel(account.platform);
  const initials = source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || platformLabel(account.platform).slice(0, 1).toUpperCase();
}

function AccountAvatar({ account }: { account: ManagedAccount }) {
  const candidates = accountAvatarCandidates(account);
  const avatarSignature = candidates.join("|");
  const [avatarIndex, setAvatarIndex] = useState(() => candidates.length ? 0 : -1);

  useEffect(() => {
    setAvatarIndex(candidates.length ? 0 : -1);
  }, [avatarSignature]);

  const src = avatarIndex >= 0 ? candidates[avatarIndex] : "";

  return (
    <div className="config-account-avatar" aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            setAvatarIndex((current) => (current + 1 < candidates.length ? current + 1 : -1));
          }}
        />
      ) : (
        <span className="config-account-avatar__fallback">{accountInitials(account)}</span>
      )}
    </div>
  );
}

function AccountPlatformLogo({ platform }: { platform: AccountPlatform }) {
  const Icon = platformIcons[platform];
  return (
    <span className={`config-account-platform config-account-platform--${platform}`} aria-hidden="true">
      <Icon />
    </span>
  );
}

function statusTone(status: string) {
  if (status === "active") return "success";
  if (status === "archived") return "danger";
  return "neutral";
}

function accountStatusTone(status: string) {
  return status === "active" ? "success" : "danger";
}

function accountStatusLabel(status: string) {
  return status === "active" ? "Connected" : "Failed to connect";
}

function isExtraPlatform(platform: AccountPlatform): platform is "facebook" | "linkedin" | "instagram" | "youtube" {
  return platform === "facebook" || platform === "linkedin" || platform === "instagram" || platform === "youtube";
}

type OfficialFieldKey =
  | "api_key"
  | "api_secret"
  | "access_token"
  | "access_secret"
  | "client_id"
  | "client_secret"
  | "redirect_uri"
  | "scopes"
  | "user_id"
  | "page_id"
  | "refresh_token";

type OfficialFieldSpec = {
  key: OfficialFieldKey;
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  requiredOnCreate?: boolean;
};

const officialFieldsByPlatform: Record<Exclude<AccountPlatform, "reddit">, OfficialFieldSpec[][]> = {
  twitter: [
    [
      { key: "api_key", label: "API Key", type: "password" },
      { key: "api_secret", label: "API Secret", type: "password" },
    ],
    [
      { key: "access_token", label: "Access Token", type: "password" },
      { key: "access_secret", label: "Access Secret", type: "password" },
    ],
  ],
  threads: [
    [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client Secret", type: "password" },
    ],
    [
      { key: "redirect_uri", label: "Redirect URI" },
    ],
    [
      { key: "scopes", label: "Scopes" },
    ],
    [
      { key: "access_token", label: "Access Token", type: "password", requiredOnCreate: false },
      { key: "user_id", label: "User ID", requiredOnCreate: false },
    ],
  ],
  facebook: [
    [
      { key: "client_id", label: "App ID" },
      { key: "client_secret", label: "App Secret", type: "password" },
    ],
    [
      { key: "redirect_uri", label: "Redirect URI" },
    ],
    [
      { key: "scopes", label: "Scopes" },
    ],
    [
      { key: "access_token", label: "Access Token", type: "password" },
      { key: "user_id", label: "Page ID" },
    ],
  ],
  linkedin: [
    [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client Secret", type: "password" },
    ],
    [
      { key: "redirect_uri", label: "Redirect URI" },
    ],
    [
      { key: "scopes", label: "Scopes" },
    ],
    [
      { key: "access_token", label: "Access Token", type: "password" },
      { key: "user_id", label: "Author URN", placeholder: "urn:li:person:..." },
    ],
  ],
  instagram: [
    [
      { key: "client_id", label: "App ID" },
      { key: "client_secret", label: "App Secret", type: "password" },
    ],
    [
      { key: "redirect_uri", label: "Redirect URI" },
    ],
    [
      { key: "scopes", label: "Scopes" },
    ],
    [
      { key: "access_token", label: "Access Token", type: "password" },
      { key: "user_id", label: "Professional Account ID" },
    ],
    [
      { key: "page_id", label: "Facebook Page ID" },
    ],
  ],
  youtube: [
    [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client Secret", type: "password" },
    ],
    [
      { key: "redirect_uri", label: "Redirect URI" },
    ],
    [
      { key: "scopes", label: "Scopes" },
    ],
    [
      { key: "refresh_token", label: "Refresh Token", type: "password" },
      { key: "user_id", label: "Channel ID", placeholder: "UC..." },
    ],
    [
      { key: "access_token", label: "Access Token (optional)", type: "password", requiredOnCreate: false },
    ],
  ],
};

function officialApiHint(platform: AccountPlatform): string | null {
  if (platform === "twitter") {
    return "New Twitter/X accounts connect through the official popup. Existing accounts can still rotate saved app and user tokens here if needed.";
  }
  if (platform === "threads") {
    return "Add access token and user ID directly, or leave them blank to connect through Threads OAuth.";
  }
  if (platform === "facebook") {
    return "Leave fields blank to connect Facebook through the official popup.";
  }
  if (platform === "linkedin") {
    return "Leave fields blank to connect through LinkedIn OAuth, or add official credentials manually.";
  }
  if (platform === "instagram") {
    return "Instagram publishing needs the professional account plus its connected Facebook Page context.";
  }
  if (platform === "youtube") {
    return "YouTube upload access is normally driven by the OAuth app plus a stored refresh token for the channel.";
  }
  return null;
}

function normalizeAccounts(
  social: SocialAccount[],
  reddit: RedditAccount[],
): ManagedAccount[] {
  const socialAccounts = social
    .filter((account) => !hiddenAccountPlatforms.has(account.platform as AccountPlatform))
    .map((account) => ({
      id: account.id,
      platform: account.platform as AccountPlatform,
      connection_mode: "official_api" as const,
      username: account.username,
      profile_username: resolveProfileUsername(account) || null,
      display_name: account.display_name?.trim() || null,
      avatar_url: account.avatar_url?.trim() || null,
      tags: normalizeAccountTags(account.tags),
      status: account.status,
      credentials_ready: account.credentials_ready,
      created_at: account.created_at,
      updated_at: account.updated_at || account.created_at,
    }));
  const redditAccounts = reddit.map((account) => ({
    id: account.id,
    platform: "reddit" as const,
    connection_mode: "official_api" as AccountConnectionMode,
    username: account.name,
    profile_username: cleanAccountValue(account.name) || null,
    display_name: null,
    avatar_url: null,
    tags: normalizeAccountTags(account.tags),
    status: account.status,
    created_at: account.created_at,
    updated_at: account.updated_at || account.created_at,
  }));
  return [...socialAccounts, ...redditAccounts].sort((left, right) => {
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
}

function putIfFilled(payload: SocialAccountInput & { status?: AccountStatus }, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) payload[key] = trimmed;
}

function deriveAccountStatus(form: AccountForm): AccountStatus {
  if (form.platform === "reddit") return form.id ? "active" : "inactive";
  if (form.id) return "active";
  if (form.platform === "twitter") {
    return form.api_key.trim() && form.api_secret.trim() && form.access_token.trim() && form.access_secret.trim() ? "active" : "inactive";
  }
  if (form.platform === "threads") {
    return form.access_token.trim() && form.user_id.trim() ? "active" : "inactive";
  }
  return form.access_token.trim() || form.refresh_token.trim() || form.user_id.trim() || form.page_id.trim() ? "active" : "inactive";
}

function usesHostedOAuth(form: AccountForm) {
  return !form.id
    && (form.platform === "twitter" || form.platform === "threads" || form.platform === "instagram" || form.platform === "facebook" || form.platform === "linkedin" || form.platform === "reddit");
}

async function startHostedOAuth(platform: AccountPlatform, username: string, tags: string[]) {
  if (platform === "threads") return api.startThreadsOAuth({ username, scopes: THREADS_FULL_SCOPES, tags });
  if (platform === "twitter") return api.startTwitterOAuth({ tags });
  if (platform === "facebook") return api.startFacebookOAuth({ tags });
  if (platform === "linkedin") return api.startLinkedInOAuth({ tags });
  if (platform === "reddit") return api.startRedditOAuth(username || "Reddit", tags);
  return api.startInstagramOAuth({ tags });
}

function hostedOAuthMessageType(platform: AccountPlatform) {
  if (platform === "threads") return "threads_connected";
  if (platform === "twitter") return "twitter_connected";
  if (platform === "facebook") return "facebook_connected";
  if (platform === "linkedin") return "linkedin_connected";
  if (platform === "reddit") return "reddit_connected";
  return "instagram_connected";
}

function accountTagKey(account: Pick<ManagedAccount, "id" | "platform">) {
  return `${account.platform}:${account.id}`;
}

function normalizeComparable(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function domainFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]?.toLowerCase() || null;
  }
}

function timestamp(value: string | null | undefined) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildAppSiteRows(apps: StudioApp[], sites: Site[]): AppSiteRow[] {
  const remainingSites = new Map<number, Site>(sites.map((site) => [site.id, site]));
  const rows: AppSiteRow[] = apps.map((app) => {
    const appNameKey = normalizeComparable(app.name);
    const appDomain = domainFromUrl(app.website_url);
    const matchedSite = sites.find((site) => {
      const siteNameKey = normalizeComparable(site.name);
      const siteSlugKey = normalizeComparable(site.slug);
      const siteDomain = site.domain?.trim().toLowerCase() || null;
      return Boolean(
        (appDomain && siteDomain && appDomain === siteDomain)
          || (appNameKey && (appNameKey === siteNameKey || appNameKey === siteSlugKey)),
      );
    });

    if (matchedSite) remainingSites.delete(matchedSite.id);

    return {
      key: `app-${app.id}`,
      app,
      site: matchedSite,
      name: app.name,
      subtitle: app.description || matchedSite?.slug || "App/Site",
      domain: matchedSite?.domain || appDomain,
      status: app.status,
      updatedAt:
        timestamp(matchedSite?.updated_at) > timestamp(app.updated_at || app.created_at)
          ? matchedSite?.updated_at || matchedSite?.created_at || app.updated_at || app.created_at
          : app.updated_at || app.created_at,
    };
  });

  const siteOnlyRows = Array.from(remainingSites.values()).map((site) => ({
    key: `site-${site.id}`,
    site,
    name: site.name,
    subtitle: site.slug || "Site",
    domain: site.domain,
    status: site.status,
    updatedAt: site.updated_at || site.created_at,
  }));

  return [...rows, ...siteOnlyRows].sort((left, right) => left.name.localeCompare(right.name));
}

export function ConfigPage({ surface, settings, syncMessage, onSaveSettings, onSyncAgent }: ConfigPageProps) {
  const [tab, setTab] = useState<ConfigTab>("accounts");
  const [apps, setApps] = useState<StudioApp[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [appForm, setAppForm] = useState<AppForm>(emptyAppForm);
  const [siteForm, setSiteForm] = useState<SiteForm>(emptySiteForm);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm);
  const [activeModal, setActiveModal] = useState<ConfigModal>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [openTagInputs, setOpenTagInputs] = useState<Record<string, boolean>>({});
  const [savingTags, setSavingTags] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const appSiteRows = buildAppSiteRows(apps, sites);
  const appsAndSitesCount = appSiteRows.length;

  async function load({ silent = false } = {}) {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const [studio, socialAccounts, reddit, managedSites] = await Promise.all([
        api.getStudio(),
        Promise.all([
          api.listTwitterAccounts().catch(() => []),
          api.listThreadsAccounts().catch(() => []),
          api.listSocialAccounts().catch(() => []),
        ]).then(([twitter, threads, extra]) => [...twitter, ...threads, ...extra]),
        api.listRedditAccounts().catch(() => []),
        api.listSites().catch(() => []),
      ]);
      setApps(Array.isArray(studio.apps) ? studio.apps : []);
      setAccounts(normalizeAccounts(
        Array.isArray(socialAccounts) ? socialAccounts : [],
        Array.isArray(reddit) ? reddit : [],
      ));
      setSites(Array.isArray(managedSites) ? managedSites : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openAddApp() {
    setTab("apps");
    setAppForm(emptyAppForm());
    setError(null);
    setFeedback(null);
    setActiveModal("app");
  }

  function openEditApp(app: StudioApp) {
    setTab("apps");
    setAppForm({
      id: app.id,
      name: app.name,
      website_url: app.website_url || "",
      app_store_url: app.app_store_url || "",
      articles_api_url: app.articles_api_url || "",
      description: app.description || "",
      ai_context: app.ai_context || "",
      status: app.status,
    });
    setError(null);
    setFeedback(null);
    setActiveModal("app");
  }

  function openEditSite(site: Site) {
    setTab("apps");
    setSiteForm({
      id: site.id,
      name: site.name,
      slug: site.slug,
      domain: site.domain,
      status: site.status,
    });
    setError(null);
    setFeedback(null);
    setActiveModal("site");
  }

  function openAddAccount(platform: AccountPlatform = "twitter") {
    setTab("accounts");
    setAccountForm(emptyAccountForm(platform));
    setError(null);
    setFeedback(null);
    setActiveModal("account");
  }

  async function saveApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = appForm.name.trim();
    if (!name) {
      setError("App name is required.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const payload = {
        name,
        website_url: appForm.website_url.trim() || null,
        app_store_url: appForm.app_store_url.trim() || null,
        articles_api_url: appForm.articles_api_url.trim() || null,
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
      setActiveModal(null);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save app");
    } finally {
      setSaving(false);
    }
  }

  async function deleteApp(app: StudioApp) {
    if (!window.confirm(`Delete ${app.name}?`)) return;
    try {
      setSaving(true);
      setError(null);
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

  async function saveSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = siteForm.name.trim();
    const slug = siteForm.slug.trim();
    const domain = siteForm.domain.trim();
    if (!name || !slug || !domain) {
      setError("Site name, slug, and domain are required.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const payload = {
        name,
        slug,
        domain,
        status: siteForm.status,
      };
      if (siteForm.id) {
        await api.updateSite(siteForm.id, payload);
        setFeedback("Site updated.");
      } else {
        setFeedback("Site added.");
      }
      setSiteForm(emptySiteForm());
      setActiveModal(null);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save site");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSite(site: Site) {
    if (!window.confirm(`Delete ${site.name}?`)) return;
    try {
      setSaving(true);
      setError(null);
      await api.deleteSite(site.id);
      if (siteForm.id === site.id) setSiteForm(emptySiteForm());
      setFeedback("Site deleted.");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete site");
    } finally {
      setSaving(false);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = accountForm.username.trim().replace(/^@+/, "");
    const accountTags = normalizeAccountTags(accountForm.tags);
    const hostedOAuth = usesHostedOAuth(accountForm);
    if (!hostedOAuth && !username) {
      setError(accountForm.platform === "reddit" ? "Reddit account name is required." : "Username is required.");
      return;
    }

    const derivedStatus = deriveAccountStatus(accountForm);

    try {
      setSaving(true);
      setError(null);

      if (hostedOAuth) {
        const popup = window.open("about:blank", `${accountForm.platform}-connect`, "width=540,height=760");
        try {
          const { auth_url } = await startHostedOAuth(accountForm.platform, username, accountTags);
          if (!popup) {
            window.location.href = auth_url;
            return;
          }

          await new Promise<void>((resolve, reject) => {
            const expectedType = hostedOAuthMessageType(accountForm.platform);
            const timeout = window.setTimeout(() => {
              window.removeEventListener("message", handleMessage);
              reject(new Error(`${platformLabel(accountForm.platform)} authorization timed out.`));
            }, 5 * 60 * 1000);
            const closeTimer = window.setInterval(() => {
              if (popup.closed) {
                window.clearInterval(closeTimer);
                window.clearTimeout(timeout);
                window.removeEventListener("message", handleMessage);
                reject(new Error(`${platformLabel(accountForm.platform)} authorization window was closed.`));
              }
            }, 800);
            function handleMessage(event: MessageEvent) {
              if (event.origin !== window.location.origin) return;
              if (event.data?.type !== expectedType || event.data?.ok !== true) return;
              window.clearInterval(closeTimer);
              window.clearTimeout(timeout);
              window.removeEventListener("message", handleMessage);
              resolve();
            }
            window.addEventListener("message", handleMessage);
            popup.location.href = auth_url;
          });
        } catch (hostedOAuthError) {
          if (popup && !popup.closed) popup.close();
          throw hostedOAuthError;
        }

        setFeedback("Connected");
        setAccountForm(emptyAccountForm(accountForm.platform));
        setActiveModal(null);
        await load({ silent: true });
        return;
      }

      if (accountForm.platform === "reddit") {
        if (accountForm.id) {
          await api.updateRedditAccount(accountForm.id, {
            name: username,
            status: derivedStatus,
            connection_mode: "official_api",
            tags: accountTags,
          });
          setFeedback("Reddit account updated.");
          setAccountForm(emptyAccountForm("reddit"));
          setActiveModal(null);
          await load({ silent: true });
          return;
        }
        const result = await api.startRedditOAuth(username, accountTags);
        window.location.href = result.auth_url;
        return;
      }

      if (isExtraPlatform(accountForm.platform)) {
        const extraPayload: SocialAccountInput & { platform: AccountPlatform; status: AccountStatus; connection_mode: AccountConnectionMode } = {
          platform: accountForm.platform,
          username,
          status: derivedStatus,
          connection_mode: "official_api",
          tags: accountTags,
        };
        putIfFilled(extraPayload, "client_id", accountForm.client_id);
        putIfFilled(extraPayload, "client_secret", accountForm.client_secret);
        putIfFilled(extraPayload, "redirect_uri", accountForm.redirect_uri);
        putIfFilled(extraPayload, "scopes", accountForm.scopes);
        putIfFilled(extraPayload, "access_token", accountForm.access_token);
        putIfFilled(extraPayload, "user_id", accountForm.user_id);
        putIfFilled(extraPayload, "page_id", accountForm.page_id);
        putIfFilled(extraPayload, "refresh_token", accountForm.refresh_token);

        if (accountForm.id) {
          await api.updateSocialAccount(accountForm.id, extraPayload);
          setFeedback(`${platformLabel(accountForm.platform)} account updated.`);
        } else {
          await api.addSocialAccount(extraPayload);
          setFeedback(`${platformLabel(accountForm.platform)} account added.`);
        }
        setAccountForm(emptyAccountForm(accountForm.platform));
        setActiveModal(null);
        await load({ silent: true });
        return;
      }

      if (accountForm.platform === "twitter") {
        if (accountForm.id) {
          const payload: SocialAccountInput & { status: AccountStatus } = {
            username,
            status: derivedStatus,
            connection_mode: "official_api",
            tags: accountTags,
          };
          putIfFilled(payload, "api_key", accountForm.api_key);
          putIfFilled(payload, "api_secret", accountForm.api_secret);
          putIfFilled(payload, "access_token", accountForm.access_token);
          putIfFilled(payload, "access_secret", accountForm.access_secret);
          await api.updateTwitterAccount(accountForm.id, payload);
          setFeedback("Twitter/X account updated.");
        } else {
          await api.addTwitterAccount({
            username,
            status: derivedStatus,
            connection_mode: "official_api",
            api_key: accountForm.api_key.trim(),
            api_secret: accountForm.api_secret.trim(),
            access_token: accountForm.access_token.trim(),
            access_secret: accountForm.access_secret.trim(),
            tags: accountTags,
          });
          setFeedback("Twitter/X account added.");
        }
        setAccountForm(emptyAccountForm("twitter"));
        setActiveModal(null);
        await load({ silent: true });
        return;
      }

      const threadsPayload: SocialAccountInput & { status: AccountStatus } = {
        username,
        status: derivedStatus,
        connection_mode: "official_api",
        tags: accountTags,
      };
      putIfFilled(threadsPayload, "client_id", accountForm.client_id);
      putIfFilled(threadsPayload, "client_secret", accountForm.client_secret);
      putIfFilled(threadsPayload, "redirect_uri", accountForm.redirect_uri);
      putIfFilled(threadsPayload, "scopes", accountForm.scopes);
      putIfFilled(threadsPayload, "access_token", accountForm.access_token);
      putIfFilled(threadsPayload, "user_id", accountForm.user_id);

      if (accountForm.id) {
        await api.updateThreadsAccount(accountForm.id, threadsPayload);
        setFeedback("Threads account updated.");
        setAccountForm(emptyAccountForm("threads"));
        setActiveModal(null);
        await load({ silent: true });
        return;
      }

      if (accountForm.access_token.trim() && accountForm.user_id.trim()) {
        await api.addThreadsAccount({
          username,
          status: derivedStatus,
          connection_mode: "official_api",
          client_id: accountForm.client_id.trim(),
          client_secret: accountForm.client_secret.trim(),
          redirect_uri: accountForm.redirect_uri.trim(),
          scopes: accountForm.scopes.trim(),
          access_token: accountForm.access_token.trim(),
          user_id: accountForm.user_id.trim(),
          tags: accountTags,
        });
        setFeedback("Threads account added.");
        setAccountForm(emptyAccountForm("threads"));
        setActiveModal(null);
        await load({ silent: true });
        return;
      }

      const result = await api.startThreadsOAuth({
        username,
        connection_mode: "official_api",
        client_id: accountForm.client_id.trim(),
        client_secret: accountForm.client_secret.trim(),
        redirect_uri: accountForm.redirect_uri.trim(),
        scopes: accountForm.scopes.trim(),
        tags: accountTags,
      });
      window.location.href = result.auth_url;
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : null;
      setError(message || (hostedOAuth ? "Failed to connect" : "Failed to save account"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(account: ManagedAccount) {
    if (!window.confirm(`Delete ${platformLabel(account.platform)} account ${account.username}?`)) return;
    try {
      setSaving(true);
      setError(null);
      if (account.platform === "reddit") {
        await api.deleteRedditAccount(account.id);
      } else if (isExtraPlatform(account.platform)) {
        await api.deleteSocialAccount(account.id);
      } else if (account.platform === "twitter") {
        await api.deleteTwitterAccount(account.id);
      } else {
        await api.deleteThreadsAccount(account.id);
      }
      if (accountForm.id === account.id && accountForm.platform === account.platform) {
        setAccountForm(emptyAccountForm(account.platform));
        setActiveModal(null);
      }
      setFeedback("Account deleted.");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setSaving(false);
    }
  }

  async function saveAccountTags(account: ManagedAccount, nextTags: string[], options: { closeInput?: boolean } = {}) {
    const key = accountTagKey(account);
    try {
      setSavingTags((current) => ({ ...current, [key]: true }));
      setError(null);
      const result = await api.updateSocialAccountTags(account.id, {
        platform: account.platform,
        tags: nextTags,
      });
      setAccounts((current) => current.map((item) => (
        item.id === account.id && item.platform === account.platform
          ? { ...item, tags: result.tags }
          : item
      )));
      setTagDrafts((current) => ({ ...current, [key]: "" }));
      if (options.closeInput) {
        setOpenTagInputs((current) => ({ ...current, [key]: false }));
      }
      setFeedback("Account tags updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account tags");
    } finally {
      setSavingTags((current) => ({ ...current, [key]: false }));
    }
  }

  function addAccountTags(account: ManagedAccount) {
    const key = accountTagKey(account);
    const draftedTags = normalizeAccountTags(tagDrafts[key] ?? "");
    if (draftedTags.length === 0) return;
    const nextTags = normalizeAccountTags([...(account.tags ?? []), ...draftedTags]);
    void saveAccountTags(account, nextTags, { closeInput: true });
  }

  function removeAccountTag(account: ManagedAccount, tag: string) {
    const nextTags = normalizeAccountTags((account.tags ?? []).filter((item) => item !== tag));
    void saveAccountTags(account, nextTags);
  }

  function openAccountTagInput(account: ManagedAccount) {
    const key = accountTagKey(account);
    setOpenTagInputs((current) => ({ ...current, [key]: true }));
  }

  function closeAccountTagInput(account: ManagedAccount) {
    const key = accountTagKey(account);
    setTagDrafts((current) => ({ ...current, [key]: "" }));
    setOpenTagInputs((current) => ({ ...current, [key]: false }));
  }

  function accountSubmitLabel() {
    if (saving) return "Saving...";
    if (accountForm.platform === "reddit") return "Connect Reddit account";
    if (accountForm.platform === "twitter") return "Connect Twitter/X account";
    if (accountForm.platform === "threads") return "Connect Threads account";
    if (accountForm.platform === "facebook") return "Connect Facebook account";
    if (accountForm.platform === "instagram") return "Connect Instagram account";
    if (accountForm.platform === "linkedin") return "Connect LinkedIn account";
    return "Add account";
  }

  const officialFieldGroups = accountForm.platform === "reddit"
    ? []
    : officialFieldsByPlatform[accountForm.platform];
  const hostedOAuthAccount = usesHostedOAuth(accountForm);
  const settingsTab = tab === "general" || tab === "ai" || tab === "rules" ? tab : null;
  const configTabs: Array<{ id: ConfigTab; label: string; badge?: string }> = [
    { id: "accounts", label: "Social Accounts", badge: String(accounts.length) },
    { id: "apps", label: "Apps/Sites", badge: String(appsAndSitesCount) },
    { id: "general", label: "General", badge: settings.workspace_timezone ? settings.workspace_timezone : "Setup" },
    { id: "ai", label: "AI API", badge: settings.ai_api_connected ? "Connected" : "Setup" },
    { id: "rules", label: "Rules", badge: settings.global_ai_rules || settings.social_agent_rules ? "Set" : "Empty" },
  ];

  if (loading) {
    return <section className="panel">Loading Config...</section>;
  }

  return (
    <div className="config-page stack">
      {error ? <p className="error panel">{error}</p> : null}
      {feedback ? <p className="panel config-feedback">{feedback}</p> : null}

      <section className="panel config-overview">
        <div className="ui-tabs config-tabs config-overview__tabs">
          <div className="ui-tabs__list config-tabs__list">
            {configTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ui-tab config-tab ${tab === item.id ? "ui-tab--active config-tab--active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {item.badge ? <span className="ui-tab__badge">{item.badge}</span> : null}
              </button>
            ))}
          </div>
          <div className="ui-tabs__actions config-tabs__actions">
            <button
              className="button-secondary dashboard-icon-button"
              type="button"
              disabled={refreshing}
              onClick={() => void load({ silent: true })}
              aria-label="Refresh config"
              title="Refresh"
            >
              <ArrowPathIcon aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

      {tab === "apps" ? (
        <div className="config-list config-overview__content config-overview__content--combined">
            <div className="config-section">
            <div className="panel__title-row">
              <h2>Apps/Sites</h2>
              <div className="config-title-actions">
                <span className="config-count">{appSiteRows.length}</span>
                <button type="button" onClick={openAddApp}>
                  Add app
                </button>
              </div>
            </div>
            {appSiteRows.length === 0 ? (
              <div className="config-empty">No apps or sites yet.</div>
            ) : (
              <div className="config-table config-table--apps-sites">
                <div className="config-table__row config-table__row--header">
                  <span>App/Site</span>
                  <span>Domain</span>
                  <span>Status</span>
                  <span>Updated</span>
                  <span>Actions</span>
                </div>
                {appSiteRows.map((row) => {
                  const app = row.app;
                  const site = row.site;
                  return (
                  <article className="config-table__row" key={row.key}>
                    <div className="config-main-cell">
                      <strong>{row.name}</strong>
                      <small>{row.subtitle}</small>
                    </div>
                    <span className="config-muted">{row.domain || "—"}</span>
                    <span className={`config-pill config-pill--${statusTone(row.status)}`}>{row.status}</span>
                    <span className="config-muted">{formatDisplayDate(row.updatedAt)}</span>
                    <div className="config-row-actions">
                      {app ? (
                        <>
                          <button
                            className="button-secondary dashboard-icon-button"
                            type="button"
                            onClick={() => openEditApp(app)}
                            aria-label={`Edit ${row.name}`}
                            title="Edit"
                          >
                            <PencilSquareIcon aria-hidden="true" />
                          </button>
                          <button
                            className="button-secondary config-danger-button dashboard-icon-button"
                            type="button"
                            disabled={saving}
                            onClick={() => void deleteApp(app)}
                            aria-label={`Delete ${row.name}`}
                            title="Delete"
                          >
                            <TrashIcon aria-hidden="true" />
                          </button>
                        </>
                      ) : site ? (
                        <>
                          <button
                            className="button-secondary dashboard-icon-button"
                            type="button"
                            onClick={() => openEditSite(site)}
                            aria-label={`Edit ${row.name}`}
                            title="Edit"
                          >
                            <PencilSquareIcon aria-hidden="true" />
                          </button>
                          <button
                            className="button-secondary config-danger-button dashboard-icon-button"
                            type="button"
                            disabled={saving}
                            onClick={() => void deleteSite(site)}
                            aria-label={`Delete ${row.name}`}
                            title="Delete"
                          >
                            <TrashIcon aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <span className="config-muted">—</span>
                      )}
                    </div>
                  </article>
                );
                })}
              </div>
            )}
            </div>
        </div>
      ) : null}

      {tab === "accounts" ? (
        <div className="config-list config-overview__content">
            <div className="panel__title-row">
              <h2>Social media accounts</h2>
              <div className="config-title-actions">
                <span className="config-count">{accounts.length}</span>
                <button type="button" onClick={() => openAddAccount()}>
                  Add account
                </button>
              </div>
            </div>
            {accounts.length === 0 ? (
              <div className="config-empty">No social media accounts yet.</div>
            ) : (
              <div className="config-table config-table--accounts">
                <div className="config-table__row config-table__row--header">
                  <span>Account</span>
                  <span>Status</span>
                  <span>Added</span>
                  <span>Actions</span>
                </div>
                {accounts.map((account) => {
                  const key = accountTagKey(account);
                  const draft = tagDrafts[key] ?? "";
                  const isSavingTags = Boolean(savingTags[key]);
                  const isTagInputOpen = Boolean(openTagInputs[key]);
                  return (
                    <article className="config-table__row" key={`${account.platform}-${account.id}`}>
                      <div className="config-main-cell">
                        <div className="config-account-cell">
                          <AccountPlatformLogo platform={account.platform} />
                          <AccountAvatar account={account} />
                          <div className="config-account-copy">
                            <strong className="config-account-copy__title">{accountHandleLabel(account)}</strong>
                            <small className="config-account-copy__subtitle">{accountSubtitle(account)}</small>
                            <div className="config-account-tags" aria-label={`${account.username} tags`}>
                              {(account.tags ?? []).map((tag) => (
                                <span className="config-account-tag" key={tag}>
                                  #{tag}
                                  <button
                                    type="button"
                                    disabled={isSavingTags}
                                    onClick={() => removeAccountTag(account, tag)}
                                    aria-label={`Remove ${tag} tag`}
                                  >
                                    x
                                  </button>
                                </span>
                              ))}
                              {isTagInputOpen ? (
                                <>
                                  <input
                                    className="config-account-tag-input"
                                    value={draft}
                                    placeholder="Type tag"
                                    autoFocus
                                    disabled={isSavingTags}
                                    onChange={(event) => setTagDrafts((current) => ({ ...current, [key]: event.target.value }))}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        addAccountTags(account);
                                      }
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        closeAccountTagInput(account);
                                      }
                                    }}
                                    aria-label={`Add tag for ${account.username}`}
                                  />
                                  <button
                                    className="config-account-tag-add"
                                    type="button"
                                    disabled={isSavingTags || normalizeAccountTags(draft).length === 0}
                                    onClick={() => addAccountTags(account)}
                                  >
                                    Add
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="config-account-tag-add config-account-tag-add--trigger"
                                  type="button"
                                  disabled={isSavingTags}
                                  onClick={() => openAccountTagInput(account)}
                                >
                                  Add tag
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <span className={`config-pill config-pill--${accountStatusTone(account.status)}`}>
                        {accountStatusLabel(account.status)}
                      </span>
                      <span className="config-muted">{formatDisplayDate(account.created_at)}</span>
                      <div className="config-row-actions">
                        <button
                          className="button-secondary config-danger-button dashboard-icon-button"
                          type="button"
                          disabled={saving}
                          onClick={() => void deleteAccount(account)}
                          aria-label={`Delete ${account.username}`}
                          title="Delete"
                        >
                          <TrashIcon aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
        </div>
      ) : null}

      {settingsTab ? (
        <div className="config-list config-overview__content">
          <APIConnectionPanel
            activeTab={settingsTab as SettingsTabId}
            surface={surface}
            aiApiConnected={settings.ai_api_connected}
            geminiApiConnected={settings.gemini_api_connected}
            geminiFlashModel={settings.gemini_flash_model}
            geminiProModel={settings.gemini_pro_model}
            globalAiRules={settings.global_ai_rules}
            socialAgentRules={settings.social_agent_rules}
            workspaceTimezone={settings.workspace_timezone}
            tradingAgentUrl={settings.trading_agent_url}
            tradingAgentConnected={settings.trading_agent_connected}
            tradingAgentTokenSaved={settings.trading_agent_token_saved}
            ctraderClientId={settings.ctrader_client_id}
            ctraderAccountId={settings.ctrader_account_id}
            ctraderDemoAccountId={settings.ctrader_demo_account_id}
            ctraderLiveAccountId={settings.ctrader_live_account_id}
            ctraderConnected={settings.ctrader_connected}
            ctraderClientSecretSaved={settings.ctrader_client_secret_saved}
            ctraderAccessTokenSaved={settings.ctrader_access_token_saved}
            syncMessage={syncMessage}
            onSave={onSaveSettings}
            onSyncAgent={onSyncAgent}
            title="Workspace configuration"
            description="General workspace, AI API, and rule settings for the dashboard."
          />
        </div>
      ) : null}

      </section>

      {activeModal === "app" ? (
        <div className="config-modal-backdrop">
          <form className="config-modal panel" onSubmit={saveApp}>
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">Apps</p>
                <h2>{appForm.id ? "Edit app" : "Add app"}</h2>
              </div>
              <ModalCloseButton onClick={() => setActiveModal(null)} label="Close app modal" />
            </div>
            {error ? <p className="error-panel__message">{error}</p> : null}
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
              App/Site API for articles
              <input
                value={appForm.articles_api_url}
                onChange={(event) => setAppForm((current) => ({ ...current, articles_api_url: event.target.value }))}
                placeholder="https://example.com/api/articles"
              />
            </label>
            <label>
              Status
              <select value={appForm.status} onChange={(event) => setAppForm((current) => ({ ...current, status: event.target.value as StudioApp["status"] }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>
              App info
              <textarea rows={4} value={appForm.description} onChange={(event) => setAppForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <label>
              AI context
              <textarea rows={5} value={appForm.ai_context} onChange={(event) => setAppForm((current) => ({ ...current, ai_context: event.target.value }))} />
            </label>
            <div className="config-modal__actions">
              <button className="button-secondary" type="button" onClick={() => setActiveModal(null)}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? "Saving..." : appForm.id ? "Save app" : "Add app"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {activeModal === "site" ? (
        <div className="config-modal-backdrop">
          <form className="config-modal panel" onSubmit={saveSite}>
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">Sites</p>
                <h2>{siteForm.id ? "Edit site" : "Add site"}</h2>
              </div>
              <ModalCloseButton onClick={() => setActiveModal(null)} label="Close site modal" />
            </div>
            {error ? <p className="error-panel__message">{error}</p> : null}
            <label>
              Site name
              <input value={siteForm.name} onChange={(event) => setSiteForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <div className="grid-two">
              <label>
                Slug
                <input value={siteForm.slug} onChange={(event) => setSiteForm((current) => ({ ...current, slug: event.target.value }))} required />
              </label>
              <label>
                Domain
                <input value={siteForm.domain} onChange={(event) => setSiteForm((current) => ({ ...current, domain: event.target.value }))} required />
              </label>
            </div>
            <label>
              Status
              <select value={siteForm.status} onChange={(event) => setSiteForm((current) => ({ ...current, status: event.target.value as Site["status"] }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <div className="config-modal__actions">
              <button className="button-secondary" type="button" onClick={() => setActiveModal(null)}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? "Saving..." : siteForm.id ? "Save site" : "Add site"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {activeModal === "account" ? (
        <div className="config-modal-backdrop">
          <form className="config-modal panel" onSubmit={saveAccount}>
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">Social media</p>
                <h2>Add account</h2>
              </div>
              <ModalCloseButton onClick={() => setActiveModal(null)} label="Close account modal" />
            </div>
            {error ? <p className="error-panel__message">{error}</p> : null}
            <label>
              Platform
              <select
                value={accountForm.platform}
                onChange={(event) => setAccountForm(emptyAccountForm(event.target.value as AccountPlatform))}
              >
                {platformOptions.map((platform) => (
                  <option key={platform.id} value={platform.id}>{platform.label}</option>
                ))}
              </select>
            </label>
            <label className="config-account-tag-field">
              Tags
              <input
                value={accountForm.tags}
                placeholder="work, personal"
                onChange={(event) => setAccountForm((current) => ({ ...current, tags: event.target.value }))}
              />
            </label>
            {hostedOAuthAccount ? (
              <div className="config-oauth-card">
                <div className="config-oauth-card__copy">
                  <p className="config-oauth-card__eyebrow">Official connection</p>
                  <p>Publishing uses official platform authorization and API credentials.</p>
                  <p>The connected account name and profile details are saved automatically after approval.</p>
                </div>
                <div className="config-modal__actions config-modal__actions--center">
                  <button className="config-modal__primary-action" type="submit" disabled={saving}>
                    {accountSubmitLabel()}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="config-hint">Publishing uses official platform auth and API credentials.</p>
                <label>
                  {accountForm.platform === "reddit"
                    ? "Account name"
                    : accountForm.platform === "youtube"
                    ? "Channel handle / label"
                    : "Username"}
                  <input value={accountForm.username} onChange={(event) => setAccountForm((current) => ({ ...current, username: event.target.value }))} required />
                </label>
              </>
            )}
            {accountForm.platform !== "reddit" && !hostedOAuthAccount ? (
              <>
                {officialFieldGroups.map((group, groupIndex) => (
                  group.length === 2 ? (
                    <div className="grid-two" key={`official-group-${groupIndex}`}>
                      {group.map((field) => (
                        <label key={field.key}>
                          {field.label}
                          <input
                            type={field.type ?? "text"}
                            value={accountForm[field.key]}
                            placeholder={field.placeholder}
                            required={!accountForm.id && field.requiredOnCreate !== false}
                            onChange={(event) => setAccountForm((current) => ({ ...current, [field.key]: event.target.value }))}
                          />
                        </label>
                      ))}
                    </div>
                  ) : group.map((field) => (
                    <label key={field.key}>
                      {field.label}
                      <input
                        type={field.type ?? "text"}
                        value={accountForm[field.key]}
                        placeholder={field.placeholder}
                        required={!accountForm.id && field.requiredOnCreate !== false}
                        onChange={(event) => setAccountForm((current) => ({ ...current, [field.key]: event.target.value }))}
                      />
                    </label>
                  ))
                ))}
                {officialApiHint(accountForm.platform) ? (
                  <p className="config-hint">{officialApiHint(accountForm.platform)}</p>
                ) : null}
              </>
            ) : null}

            {accountForm.platform === "reddit" && !accountForm.id ? (
              <p className="config-hint">Reddit will return the connected username automatically after approval.</p>
            ) : null}

            {!hostedOAuthAccount ? (
              <div className="config-modal__actions config-modal__actions--center">
                <button className="config-modal__primary-action" type="submit" disabled={saving}>
                  {accountSubmitLabel()}
                </button>
              </div>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
