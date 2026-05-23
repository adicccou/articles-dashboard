import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { RedditAccount, SocialAccount, SocialAccountInput, StudioApp } from "../lib/types";
import { api } from "../lib/api";
import { formatDisplayDate } from "../lib/datetime";
import "../styles/config-page.css";

type ConfigTab = "apps" | "accounts";
type AccountPlatform = "twitter" | "threads" | "reddit";
type AccountStatus = "active" | "inactive";

type AppForm = {
  id?: number;
  name: string;
  website_url: string;
  app_store_url: string;
  description: string;
  ai_context: string;
  status: StudioApp["status"];
};

type AccountForm = {
  id?: number;
  platform: AccountPlatform;
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
};

type ManagedAccount = {
  id: number;
  platform: AccountPlatform;
  username: string;
  status: AccountStatus;
  credentials_ready?: boolean | number;
  created_at: string;
  updated_at: string;
};

const THREADS_FULL_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_read_replies",
  "threads_manage_replies",
  "threads_keyword_search",
].join(",");

const platformOptions: Array<{ id: AccountPlatform; label: string }> = [
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

function emptyAccountForm(platform: AccountPlatform = "twitter"): AccountForm {
  return {
    platform,
    username: "",
    status: "active",
    api_key: "",
    api_secret: "",
    access_token: "",
    access_secret: "",
    client_id: "",
    client_secret: "",
    redirect_uri: "",
    scopes: platform === "threads" ? THREADS_FULL_SCOPES : "",
    user_id: "",
  };
}

function appId(id: number) {
  return `APP-${String(id).padStart(4, "0")}`;
}

function accountId(platform: AccountPlatform, id: number) {
  const prefix = platform === "twitter" ? "X" : platform.toUpperCase();
  return `${prefix}-${String(id).padStart(4, "0")}`;
}

function platformLabel(platform: AccountPlatform) {
  return platformOptions.find((item) => item.id === platform)?.label ?? platform;
}

function statusTone(status: string) {
  if (status === "active") return "success";
  if (status === "archived") return "danger";
  return "neutral";
}

function normalizeAccounts(
  twitter: SocialAccount[],
  threads: SocialAccount[],
  reddit: RedditAccount[],
): ManagedAccount[] {
  const twitterAccounts = twitter.map((account) => ({
    id: account.id,
    platform: "twitter" as const,
    username: account.username,
    status: account.status,
    credentials_ready: account.credentials_ready,
    created_at: account.created_at,
    updated_at: account.updated_at || account.created_at,
  }));
  const threadsAccounts = threads.map((account) => ({
    id: account.id,
    platform: "threads" as const,
    username: account.username,
    status: account.status,
    credentials_ready: account.credentials_ready,
    created_at: account.created_at,
    updated_at: account.updated_at || account.created_at,
  }));
  const redditAccounts = reddit.map((account) => ({
    id: account.id,
    platform: "reddit" as const,
    username: account.name,
    status: account.status,
    created_at: account.created_at,
    updated_at: account.updated_at || account.created_at,
  }));
  return [...twitterAccounts, ...threadsAccounts, ...redditAccounts].sort((left, right) => {
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
}

function putIfFilled(payload: SocialAccountInput & { status?: AccountStatus }, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) payload[key] = trimmed;
}

export function ConfigPage() {
  const [tab, setTab] = useState<ConfigTab>("apps");
  const [apps, setApps] = useState<StudioApp[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [appForm, setAppForm] = useState<AppForm>(emptyAppForm);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function load({ silent = false } = {}) {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const [studio, twitter, threads, reddit] = await Promise.all([
        api.getStudio(),
        api.listTwitterAccounts().catch(() => []),
        api.listThreadsAccounts().catch(() => []),
        api.listRedditAccounts().catch(() => []),
      ]);
      setApps(Array.isArray(studio.apps) ? studio.apps : []);
      setAccounts(normalizeAccounts(
        Array.isArray(twitter) ? twitter : [],
        Array.isArray(threads) ? threads : [],
        Array.isArray(reddit) ? reddit : [],
      ));
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

  const accountGroups = useMemo(
    () => platformOptions.map((platform) => ({
      ...platform,
      accounts: accounts.filter((account) => account.platform === platform.id),
    })),
    [accounts],
  );

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

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = accountForm.username.trim().replace(/^@+/, "");
    if (!username) {
      setError(accountForm.platform === "reddit" ? "Reddit account name is required." : "Username is required.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      if (accountForm.platform === "reddit") {
        if (accountForm.id) {
          await api.updateRedditAccount(accountForm.id, { name: username, status: accountForm.status });
          setFeedback("Reddit account updated.");
          setAccountForm(emptyAccountForm("reddit"));
          await load({ silent: true });
          return;
        }
        const result = await api.startRedditOAuth(username);
        window.location.href = result.auth_url;
        return;
      }

      if (accountForm.platform === "twitter") {
        if (accountForm.id) {
          const payload: SocialAccountInput & { status: AccountStatus } = { username, status: accountForm.status };
          putIfFilled(payload, "api_key", accountForm.api_key);
          putIfFilled(payload, "api_secret", accountForm.api_secret);
          putIfFilled(payload, "access_token", accountForm.access_token);
          putIfFilled(payload, "access_secret", accountForm.access_secret);
          await api.updateTwitterAccount(accountForm.id, payload);
          setFeedback("Twitter/X account updated.");
        } else {
          await api.addTwitterAccount({
            username,
            api_key: accountForm.api_key.trim(),
            api_secret: accountForm.api_secret.trim(),
            access_token: accountForm.access_token.trim(),
            access_secret: accountForm.access_secret.trim(),
          });
          setFeedback("Twitter/X account added.");
        }
        setAccountForm(emptyAccountForm("twitter"));
        await load({ silent: true });
        return;
      }

      const threadsPayload: SocialAccountInput & { status: AccountStatus } = { username, status: accountForm.status };
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
        await load({ silent: true });
        return;
      }

      if (accountForm.access_token.trim() && accountForm.user_id.trim()) {
        await api.addThreadsAccount({
          username,
          client_id: accountForm.client_id.trim(),
          client_secret: accountForm.client_secret.trim(),
          redirect_uri: accountForm.redirect_uri.trim(),
          scopes: accountForm.scopes.trim(),
          access_token: accountForm.access_token.trim(),
          user_id: accountForm.user_id.trim(),
        });
        setFeedback("Threads account added.");
        setAccountForm(emptyAccountForm("threads"));
        await load({ silent: true });
        return;
      }

      const result = await api.startThreadsOAuth({
        username,
        client_id: accountForm.client_id.trim(),
        client_secret: accountForm.client_secret.trim(),
        redirect_uri: accountForm.redirect_uri.trim(),
        scopes: accountForm.scopes.trim(),
      });
      window.location.href = result.auth_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save account");
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
      } else if (account.platform === "twitter") {
        await api.deleteTwitterAccount(account.id);
      } else {
        await api.deleteThreadsAccount(account.id);
      }
      if (accountForm.id === account.id && accountForm.platform === account.platform) {
        setAccountForm(emptyAccountForm(account.platform));
      }
      setFeedback("Account deleted.");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setSaving(false);
    }
  }

  function editAccount(account: ManagedAccount) {
    setTab("accounts");
    setError(null);
    setFeedback(null);
    setAccountForm({
      ...emptyAccountForm(account.platform),
      id: account.id,
      username: account.username,
      status: account.status,
    });
  }

  function accountSubmitLabel() {
    if (saving) return "Saving...";
    if (accountForm.id) return "Save account";
    if (accountForm.platform === "reddit") return "Connect Reddit account";
    if (accountForm.platform === "threads" && (!accountForm.access_token.trim() || !accountForm.user_id.trim())) {
      return "Connect Threads account";
    }
    return "Add account";
  }

  if (loading) {
    return <section className="panel">Loading Config...</section>;
  }

  return (
    <div className="config-page stack">
      <section className="panel config-topbar">
        <div>
          <p className="eyebrow">Config</p>
          <h1>Marketing Configuration</h1>
        </div>
        <button className="button-secondary" type="button" disabled={refreshing} onClick={() => void load({ silent: true })}>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {error ? <p className="error panel">{error}</p> : null}
      {feedback ? <p className="panel config-feedback">{feedback}</p> : null}

      <section className="panel config-tabs">
        <button
          type="button"
          className={`config-tab ${tab === "apps" ? "config-tab--active" : ""}`}
          onClick={() => setTab("apps")}
        >
          Apps ({apps.length})
        </button>
        <button
          type="button"
          className={`config-tab ${tab === "accounts" ? "config-tab--active" : ""}`}
          onClick={() => setTab("accounts")}
        >
          Social Media Accounts ({accounts.length})
        </button>
      </section>

      {tab === "apps" ? (
        <section className="config-layout">
          <form className="panel config-form" onSubmit={saveApp}>
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
            <button type="submit" disabled={saving}>
              {saving ? "Saving..." : appForm.id ? "Save app" : "Add app"}
            </button>
          </form>

          <section className="panel config-list">
            <div className="panel__title-row">
              <h2>Apps</h2>
              <span className="config-count">{apps.length}</span>
            </div>
            {apps.length === 0 ? (
              <div className="config-empty">No apps yet.</div>
            ) : (
              <div className="config-card-grid">
                {apps.map((app) => (
                  <article className="config-card" key={app.id}>
                    <div className="config-card__header">
                      <span className="config-id">{appId(app.id)}</span>
                      <span className={`config-pill config-pill--${statusTone(app.status)}`}>{app.status}</span>
                    </div>
                    <h2>{app.name}</h2>
                    <p>{app.description || "No app info yet."}</p>
                    {app.ai_context ? <small>{app.ai_context}</small> : null}
                    <div className="config-link-row">
                      {app.website_url ? <a href={app.website_url} target="_blank" rel="noreferrer">Website</a> : null}
                      {app.app_store_url ? <a href={app.app_store_url} target="_blank" rel="noreferrer">App store</a> : null}
                    </div>
                    <div className="config-card__actions">
                      <button
                        className="button-secondary"
                        type="button"
                        onClick={() => {
                          setAppForm({
                            id: app.id,
                            name: app.name,
                            website_url: app.website_url || "",
                            app_store_url: app.app_store_url || "",
                            description: app.description || "",
                            ai_context: app.ai_context || "",
                            status: app.status,
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button className="button-secondary config-danger-button" type="button" disabled={saving} onClick={() => void deleteApp(app)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      ) : null}

      {tab === "accounts" ? (
        <section className="config-layout">
          <form className="panel config-form" onSubmit={saveAccount}>
            <div className="panel__title-row">
              <h2>{accountForm.id ? "Edit account" : "Add account"}</h2>
              {accountForm.id ? (
                <button className="button-secondary" type="button" onClick={() => setAccountForm(emptyAccountForm(accountForm.platform))}>
                  Cancel edit
                </button>
              ) : null}
            </div>
            <label>
              Platform
              <select
                value={accountForm.platform}
                disabled={Boolean(accountForm.id)}
                onChange={(event) => setAccountForm(emptyAccountForm(event.target.value as AccountPlatform))}
              >
                {platformOptions.map((platform) => (
                  <option key={platform.id} value={platform.id}>{platform.label}</option>
                ))}
              </select>
            </label>
            <label>
              {accountForm.platform === "reddit" ? "Account name" : "Username"}
              <input value={accountForm.username} onChange={(event) => setAccountForm((current) => ({ ...current, username: event.target.value }))} required />
            </label>
            <label>
              Status
              <select value={accountForm.status} onChange={(event) => setAccountForm((current) => ({ ...current, status: event.target.value as AccountStatus }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            {accountForm.platform === "twitter" ? (
              <>
                <div className="grid-two">
                  <label>
                    API Key
                    <input type="password" value={accountForm.api_key} onChange={(event) => setAccountForm((current) => ({ ...current, api_key: event.target.value }))} />
                  </label>
                  <label>
                    API Secret
                    <input type="password" value={accountForm.api_secret} onChange={(event) => setAccountForm((current) => ({ ...current, api_secret: event.target.value }))} />
                  </label>
                </div>
                <div className="grid-two">
                  <label>
                    Access Token
                    <input type="password" value={accountForm.access_token} onChange={(event) => setAccountForm((current) => ({ ...current, access_token: event.target.value }))} />
                  </label>
                  <label>
                    Access Secret
                    <input type="password" value={accountForm.access_secret} onChange={(event) => setAccountForm((current) => ({ ...current, access_secret: event.target.value }))} />
                  </label>
                </div>
              </>
            ) : null}

            {accountForm.platform === "threads" ? (
              <>
                <div className="grid-two">
                  <label>
                    Client ID
                    <input value={accountForm.client_id} onChange={(event) => setAccountForm((current) => ({ ...current, client_id: event.target.value }))} />
                  </label>
                  <label>
                    Client Secret
                    <input type="password" value={accountForm.client_secret} onChange={(event) => setAccountForm((current) => ({ ...current, client_secret: event.target.value }))} />
                  </label>
                </div>
                <label>
                  Redirect URI
                  <input value={accountForm.redirect_uri} onChange={(event) => setAccountForm((current) => ({ ...current, redirect_uri: event.target.value }))} />
                </label>
                <label>
                  Scopes
                  <input value={accountForm.scopes} onChange={(event) => setAccountForm((current) => ({ ...current, scopes: event.target.value }))} />
                </label>
                <div className="grid-two">
                  <label>
                    Access Token
                    <input type="password" value={accountForm.access_token} onChange={(event) => setAccountForm((current) => ({ ...current, access_token: event.target.value }))} />
                  </label>
                  <label>
                    User ID
                    <input value={accountForm.user_id} onChange={(event) => setAccountForm((current) => ({ ...current, user_id: event.target.value }))} />
                  </label>
                </div>
              </>
            ) : null}

            {accountForm.id ? (
              <p className="config-hint">Leave credential fields blank to keep the saved values.</p>
            ) : null}

            <button type="submit" disabled={saving}>
              {accountSubmitLabel()}
            </button>
          </form>

          <section className="panel config-list">
            <div className="panel__title-row">
              <h2>Social media accounts</h2>
              <span className="config-count">{accounts.length}</span>
            </div>
            <div className="config-account-groups">
              {accountGroups.map((group) => (
                <section className="config-account-group" key={group.id}>
                  <div className="config-account-group__title">
                    <h3>{group.label}</h3>
                    <span className="config-count">{group.accounts.length}</span>
                  </div>
                  {group.accounts.length === 0 ? (
                    <div className="config-empty">No {group.label} accounts yet.</div>
                  ) : (
                    <div className="config-card-grid">
                      {group.accounts.map((account) => (
                        <article className="config-card" key={`${account.platform}-${account.id}`}>
                          <div className="config-card__header">
                            <span className="config-id">{accountId(account.platform, account.id)}</span>
                            <span className={`config-pill config-pill--${statusTone(account.status)}`}>{account.status}</span>
                          </div>
                          <h2>{account.platform === "reddit" ? account.username : `@${account.username}`}</h2>
                          <p>{platformLabel(account.platform)}</p>
                          <small>
                            {account.credentials_ready === undefined
                              ? "OAuth account"
                              : account.credentials_ready
                                ? "Credentials ready"
                                : "Credentials missing"}
                          </small>
                          <small>Added {formatDisplayDate(account.created_at)}</small>
                          <div className="config-card__actions">
                            <button className="button-secondary" type="button" onClick={() => editAccount(account)}>
                              Edit
                            </button>
                            <button className="button-secondary config-danger-button" type="button" disabled={saving} onClick={() => void deleteAccount(account)}>
                              Delete
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </div>
  );
}
