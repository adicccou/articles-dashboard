import { useEffect, useState, type ComponentType } from "react";
import { FaFacebookF, FaLinkedinIn } from "react-icons/fa6";
import { SiInstagram, SiReddit, SiThreads, SiX, SiYoutube } from "react-icons/si";
import { api } from "../../lib/api";
import { emptyStudioAppProfile } from "../../lib/studioAppProfile";
import { hasStudioAppConnection, STUDIO_APP_CONNECTION_REQUIREMENT } from "../../lib/studioApps";
import type { RedditAccount, Site, SocialAccount, SocialAccountInput, StudioApp } from "../../lib/types";
import type { StudioAppProfile } from "../../lib/studioAppProfile";

export type ConfigTab = "apps" | "accounts" | "general" | "ai" | "rules";
export type AccountPlatform = "twitter" | "threads" | "reddit" | "facebook" | "linkedin" | "instagram" | "youtube";
export type AccountStatus = "active" | "inactive";
export type AccountConnectionMode = "official_api";
export type ConfigModal = "app" | "account" | "site" | null;

export type AppForm = {
  id?: number;
  name: string;
  website_url: string;
  app_store_url: string;
  articles_api_url: string;
  description: string;
  ai_context: string;
  app_profile: StudioAppProfile;
  status: StudioApp["status"];
};

export type SiteForm = {
  id?: number;
  name: string;
  slug: string;
  domain: string;
  status: Site["status"];
};

export type AccountForm = {
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

export type ManagedAccount = {
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

export type AppSiteRow = {
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

export const platformOptions: Array<{ id: AccountPlatform; label: string }> = [
  { id: "twitter", label: "Twitter/X" },
  { id: "threads", label: "Threads" },
  { id: "reddit", label: "Reddit" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
];

const platformIcons: Record<AccountPlatform, ComponentType> = {
  twitter: SiX,
  threads: SiThreads,
  reddit: SiReddit,
  facebook: FaFacebookF,
  linkedin: FaLinkedinIn,
  instagram: SiInstagram,
  youtube: SiYoutube,
};

const hiddenAccountPlatforms = new Set<AccountPlatform>(["youtube"]);

export function emptyAppForm(): AppForm {
  return {
    name: "",
    website_url: "",
    app_store_url: "",
    articles_api_url: "",
    description: "",
    ai_context: "",
    app_profile: emptyStudioAppProfile(),
    status: "active",
  };
}

export function emptySiteForm(): SiteForm {
  return {
    name: "",
    slug: "",
    domain: "",
    status: "active",
  };
}

export function emptyAccountForm(platform: AccountPlatform = "twitter"): AccountForm {
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

export function platformLabel(platform: AccountPlatform) {
  return platformOptions.find((item) => item.id === platform)?.label ?? platform;
}

export function cleanAccountValue(value: string | null | undefined) {
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

export function normalizeAccountTags(raw: unknown): string[] {
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

export function accountHandleLabel(account: Pick<ManagedAccount, "platform" | "username" | "profile_username">) {
  const handle = cleanAccountValue(account.profile_username || account.username);
  if (!handle) return platformLabel(account.platform);
  return prefersAtPrefix(account.platform) ? `@${handle}` : handle;
}

export function accountSubtitle(account: Pick<ManagedAccount, "platform" | "username" | "profile_username" | "display_name">) {
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

export function AccountAvatar({ account }: { account: ManagedAccount }) {
  const candidates = accountAvatarCandidates(account);
  const avatarSignature = candidates.join("|");
  const [avatarIndex, setAvatarIndex] = useState(() => (candidates.length ? 0 : -1));

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

export function AccountPlatformLogo({ platform }: { platform: AccountPlatform }) {
  const Icon = platformIcons[platform];
  return (
    <span className={`config-account-platform config-account-platform--${platform}`} aria-hidden="true">
      <Icon />
    </span>
  );
}

export function statusTone(status: string) {
  if (status === "active") return "success";
  if (status === "archived") return "danger";
  return "neutral";
}

export function accountStatusTone(status: string) {
  return status === "active" ? "success" : "danger";
}

export function accountStatusLabel(status: string) {
  return status === "active" ? "Connected" : "Failed to connect";
}

export function isExtraPlatform(platform: AccountPlatform): platform is "facebook" | "linkedin" | "instagram" | "youtube" {
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

export type OfficialFieldSpec = {
  key: OfficialFieldKey;
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  requiredOnCreate?: boolean;
};

export const officialFieldsByPlatform: Record<Exclude<AccountPlatform, "reddit">, OfficialFieldSpec[][]> = {
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

export function officialApiHint(platform: AccountPlatform): string | null {
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

export function normalizeAccounts(
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

export function putIfFilled(payload: SocialAccountInput & { status?: AccountStatus }, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) payload[key] = trimmed;
}

export function deriveAccountStatus(form: AccountForm): AccountStatus {
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

export function usesHostedOAuth(form: AccountForm) {
  return !form.id
    && (form.platform === "twitter" || form.platform === "threads" || form.platform === "instagram" || form.platform === "facebook" || form.platform === "linkedin" || form.platform === "reddit");
}

export async function startHostedOAuth(platform: AccountPlatform, username: string, tags: string[]) {
  if (platform === "threads") return api.startThreadsOAuth({ username, scopes: THREADS_FULL_SCOPES, tags });
  if (platform === "twitter") return api.startTwitterOAuth({ tags });
  if (platform === "facebook") return api.startFacebookOAuth({ tags });
  if (platform === "linkedin") return api.startLinkedInOAuth({ tags });
  if (platform === "reddit") return api.startRedditOAuth(username || "Reddit", tags);
  return api.startInstagramOAuth({ tags });
}

export function hostedOAuthMessageType(platform: AccountPlatform) {
  if (platform === "threads") return "threads_connected";
  if (platform === "twitter") return "twitter_connected";
  if (platform === "facebook") return "facebook_connected";
  if (platform === "linkedin") return "linkedin_connected";
  if (platform === "reddit") return "reddit_connected";
  return "instagram_connected";
}

export function accountTagKey(account: Pick<ManagedAccount, "id" | "platform">) {
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

export function buildAppSiteRows(apps: StudioApp[], sites: Site[]): AppSiteRow[] {
  const remainingSites = new Map<number, Site>(sites.map((site) => [site.id, site]));
  const rows: AppSiteRow[] = apps.map((app) => {
    const appNameKey = normalizeComparable(app.name);
    const appDomain = domainFromUrl(app.website_url);
    const setupReady = hasStudioAppConnection(app);
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
      subtitle: setupReady
        ? app.description || app.app_profile.category || matchedSite?.slug || "App/Site"
        : `Needs ${STUDIO_APP_CONNECTION_REQUIREMENT} for Studio`,
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
