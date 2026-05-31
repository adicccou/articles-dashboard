import { useEffect, useState, type FormEvent } from "react";
import { ArrowPathIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/solid";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { APIConnectionPanel, type SettingsTabId } from "../components/APIConnectionPanel";
import { StudioAppProfileEditor } from "../components/StudioAppProfileEditor";
import { SectionTabs } from "../components/SectionTabs";
import type { RedditAccount, Site, SocialAccountInput, StudioApp, AppSettings, AppSettingsInput } from "../lib/types";
import type { DashboardSurface } from "../lib/surface";
import { normalizeStudioAppProfile } from "../lib/studioAppProfile";
import { hasStudioAppConnection, STUDIO_APP_CONNECTION_REQUIREMENT } from "../lib/studioApps";
import { api } from "../lib/api";
import { formatDisplayDate } from "../lib/datetime";
import {
  AccountAvatar,
  AccountPlatformLogo,
  accountHandleLabel,
  accountStatusLabel,
  accountStatusTone,
  accountSubtitle,
  accountTagKey,
  buildAppSiteRows,
  cleanAccountValue,
  deriveAccountStatus,
  emptyAccountForm,
  emptyAppForm,
  emptySiteForm,
  hostedOAuthMessageType,
  isExtraPlatform,
  normalizeAccountTags,
  normalizeAccounts,
  officialApiHint,
  officialFieldsByPlatform,
  platformLabel,
  platformOptions,
  putIfFilled,
  startHostedOAuth,
  statusTone,
  type AccountConnectionMode,
  type AccountForm,
  type AccountPlatform,
  type AccountStatus,
  type AppForm,
  type AppSiteRow,
  type ConfigModal,
  type ConfigTab,
  type ManagedAccount,
  type SiteForm,
  usesHostedOAuth,
} from "../features/config/helpers";
import "../styles/config-page.css";

type ConfigPageProps = {
  surface: DashboardSurface;
  settings: AppSettings;
  syncMessage: string | null;
  onSaveSettings: (payload: AppSettingsInput) => Promise<unknown>;
  onSyncAgent: () => Promise<unknown>;
};

function readConfigIntent() {
  if (typeof window === "undefined") return { tab: null as ConfigTab | null, modal: null as ConfigModal };
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get("config_tab");
  const rawModal = params.get("config_modal");
  const tab: ConfigTab | null = rawTab === "apps" || rawTab === "accounts" || rawTab === "general" || rawTab === "ai" || rawTab === "rules"
    ? rawTab
    : null;
  const modal: ConfigModal = rawModal === "app" || rawModal === "account" || rawModal === "site"
    ? rawModal
    : null;
  return { tab, modal };
}

function clearConfigIntent() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("config_tab");
  url.searchParams.delete("config_modal");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function ConfigPage({ surface, settings, syncMessage, onSaveSettings, onSyncAgent }: ConfigPageProps) {
  const isArticlesSurface = surface === "articles";
  const [tab, setTab] = useState<ConfigTab>(() => isArticlesSurface ? "apps" : "accounts");
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
      const [studio, socialAccounts, reddit, managedSites] = isArticlesSurface
        ? [
          { apps: [] },
          [],
          [],
          await api.listSites().catch(() => []),
        ] as const
        : await Promise.all([
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

  useEffect(() => {
    const intent = readConfigIntent();
    if (!intent.tab && !intent.modal) return;

    setError(null);
    setFeedback(null);

    if (intent.modal === "app") {
      setTab("apps");
      setAppForm(emptyAppForm());
      setActiveModal("app");
    } else if (intent.modal === "site") {
      setTab("apps");
      setSiteForm(emptySiteForm());
      setActiveModal("site");
    } else if (intent.modal === "account") {
      setTab("accounts");
      setAccountForm(emptyAccountForm("twitter"));
      setActiveModal("account");
    } else if (intent.tab) {
      setTab(intent.tab);
      setActiveModal(null);
    }

    clearConfigIntent();
  }, []);

  function openAddApp() {
    setTab("apps");
    setAppForm(emptyAppForm());
    setError(null);
    setFeedback(null);
    setActiveModal("app");
  }

  function openAddSite() {
    setTab("apps");
    setSiteForm(emptySiteForm());
    setError(null);
    setFeedback(null);
    setActiveModal("site");
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
      app_profile: normalizeStudioAppProfile(app.app_profile),
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
    const websiteUrl = appForm.website_url.trim();
    const appStoreUrl = appForm.app_store_url.trim();
    const articlesApiUrl = appForm.articles_api_url.trim();
    if (!name) {
      setError("App name is required.");
      return;
    }
    if (!hasStudioAppConnection({
      website_url: websiteUrl,
      app_store_url: appStoreUrl,
      articles_api_url: articlesApiUrl,
    })) {
      setError(`Add at least one ${STUDIO_APP_CONNECTION_REQUIREMENT} before saving this app.`);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const payload = {
        name,
        website_url: websiteUrl || null,
        app_store_url: appStoreUrl || null,
        articles_api_url: articlesApiUrl || null,
        description: appForm.description.trim(),
        ai_context: appForm.ai_context.trim(),
        app_profile: normalizeStudioAppProfile(appForm.app_profile),
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
  const configTabs: Array<{ id: ConfigTab; label: string; badge?: string }> = isArticlesSurface ? [
    { id: "apps", label: "Sites", badge: String(sites.length) },
    { id: "general", label: "General", badge: settings.workspace_timezone ? settings.workspace_timezone : "Setup" },
    { id: "ai", label: "AI API", badge: settings.ai_api_connected ? settings.ai_api_provider_label ?? "Connected" : "Setup" },
  ] : [
    { id: "accounts", label: "Social Accounts", badge: String(accounts.length) },
    { id: "apps", label: "Apps/Sites", badge: String(appsAndSitesCount) },
    { id: "general", label: "General", badge: settings.workspace_timezone ? settings.workspace_timezone : "Setup" },
    { id: "ai", label: "AI API", badge: settings.ai_api_connected ? settings.ai_api_provider_label ?? "Connected" : "Setup" },
    { id: "rules", label: "Rules", badge: settings.global_ai_rules || settings.social_agent_rules ? "Set" : "Empty" },
  ];
  const settingsSectionMeta: Record<SettingsTabId, { title: string; badge: string }> = {
    general: { title: "General settings", badge: settings.workspace_timezone ? settings.workspace_timezone : "Setup" },
    ai: { title: "AI API connection", badge: settings.ai_api_connected ? settings.ai_api_provider_label ?? "Connected" : "Setup" },
    rules: { title: "AI operating rules", badge: settings.global_ai_rules || settings.social_agent_rules ? "Set" : "Empty" },
    trading: { title: "Trading platform connection", badge: settings.ctrader_connected ? "Connected" : "Setup" },
    agent: { title: "Trading agent sync", badge: settings.trading_agent_connected ? "Connected" : "Setup" },
  };
  const activeSettingsMeta = settingsTab ? settingsSectionMeta[settingsTab as SettingsTabId] : null;
  const refreshConfigButton = (
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
  );

  if (loading) {
    return <section className="panel">Loading Config...</section>;
  }

  return (
    <div className="config-page stack">
      {error ? <p className="error panel">{error}</p> : null}
      {feedback ? <p className="panel config-feedback">{feedback}</p> : null}

      <section className="panel config-overview">
        <div className="ui-tabs config-tabs config-overview__tabs">
          <SectionTabs
            activeId={tab}
            ariaLabel="Config sections"
            className="config-tabs__list"
            tabClassName="config-tab"
            activeTabClassName="config-tab--active"
            onChange={setTab}
            items={configTabs}
          />
        </div>

      {tab === "apps" ? (
        <div className="config-list config-overview__content config-overview__content--combined">
            <div className="config-section">
            <div className="panel__title-row config-section-header">
              <div className="config-section-heading">
                <h2>{isArticlesSurface ? "Sites" : "Apps/Sites"}</h2>
                <span className="config-count">{appSiteRows.length}</span>
              </div>
              <div className="config-title-actions">
                {refreshConfigButton}
                <button type="button" onClick={isArticlesSurface ? openAddSite : openAddApp}>
                  {isArticlesSurface ? "Add site" : "Add app"}
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

      {!isArticlesSurface && tab === "accounts" ? (
        <div className="config-list config-overview__content">
            <div className="panel__title-row config-section-header">
              <div className="config-section-heading">
                <h2>Social media accounts</h2>
                <span className="config-count">{accounts.length}</span>
              </div>
              <div className="config-title-actions">
                {refreshConfigButton}
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
          <div className="panel__title-row config-section-header">
            <div className="config-section-heading">
              <h2>{activeSettingsMeta?.title ?? "Workspace configuration"}</h2>
              <span className="config-count">{activeSettingsMeta?.badge ?? "Setup"}</span>
            </div>
            <div className="config-title-actions">
              {refreshConfigButton}
            </div>
          </div>
          <APIConnectionPanel
            activeTab={settingsTab as SettingsTabId}
            surface={surface}
            aiApiConnected={settings.ai_api_connected}
            aiApiMode={settings.ai_api_mode}
            aiApiProviderLabel={settings.ai_api_provider_label}
            aiModel={settings.ai_model}
            customAiApiKeySaved={settings.custom_ai_api_key_saved}
            defaultAiApiConnected={settings.default_ai_api_connected}
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
            showIntro={false}
          />
        </div>
      ) : null}

      </section>

      {activeModal === "app" ? (
        <div className="config-modal-backdrop">
          <form className="config-modal config-modal--app panel" onSubmit={saveApp}>
            <div className="panel__title-row">
              <div>
                <p className="eyebrow">Apps</p>
                <h2>{appForm.id ? "Edit app" : "Add app"}</h2>
                <p className="config-hint">Studio needs at least one {STUDIO_APP_CONNECTION_REQUIREMENT} on every app.</p>
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
              One-line description
              <textarea rows={4} value={appForm.description} onChange={(event) => setAppForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <StudioAppProfileEditor
              profile={appForm.app_profile}
              onChange={(app_profile) => setAppForm((current) => ({ ...current, app_profile }))}
            />
            <label>
              Additional AI context
              <textarea rows={5} value={appForm.ai_context} onChange={(event) => setAppForm((current) => ({ ...current, ai_context: event.target.value }))} />
            </label>
            <label>
              Status
              <select value={appForm.status} onChange={(event) => setAppForm((current) => ({ ...current, status: event.target.value as StudioApp["status"] }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
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
