import { useEffect, useState } from "react";
import { ArrowRightOnRectangleIcon, Bars3Icon, Cog6ToothIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { api } from "../lib/api";
import type { ArticleRecord, AuthState, Site, ArticleCategory, AppSettings, AppSettingsInput } from "../lib/types";
import { LoginCard } from "../components/LoginCard";
import { SettingsModal } from "../components/SettingsModal";
import { Shell } from "../components/Shell";
import { TopNav, getNavLabel, type NavView } from "../components/TopNav";
import { DashboardPage } from "../pages/DashboardPage";
import {
  getDashboardSurface,
  getDefaultView,
  isViewAllowedForSurface,
  normalizeStoredView,
  shouldPersistSurfaceInUrl,
  type DashboardSurface,
} from "../lib/surface";
import "../styles/app.css";

const DASHBOARD_VIEW_STORAGE_KEY_PREFIX = "dashboard:last-view";
const FALLBACK_SIGN_PATH = "/fallbacksign";

function readAuthNotice(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth_error") === "google_not_configured") {
    return "Google sign-in needs OAuth credentials before it can be used. Use the password fallback for now.";
  }
  return null;
}

function readReturnTo(): string {
  if (typeof window === "undefined") return "";
  const raw = new URLSearchParams(window.location.search).get("return_to") ?? "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "";
  try {
    const parsed = new URL(raw, window.location.origin);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function readStoredView(surface: DashboardSurface): NavView {
  if (typeof window === "undefined") return getDefaultView(surface);

  const params = new URLSearchParams(window.location.search);
  const queryView = normalizeStoredView(params.get("view"));
  if (queryView && isViewAllowedForSurface(queryView, surface)) {
    return queryView;
  }

  const storageKey = `${DASHBOARD_VIEW_STORAGE_KEY_PREFIX}:${surface}`;
  const stored = normalizeStoredView(window.localStorage.getItem(storageKey));
  return stored && isViewAllowedForSurface(stored, surface) ? stored : getDefaultView(surface);
}

function syncViewUrl(surface: DashboardSurface, view: NavView) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (shouldPersistSurfaceInUrl()) {
    url.searchParams.set("surface", surface);
  } else {
    url.searchParams.delete("surface");
  }
  url.searchParams.set("view", view);

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function App() {
  const [surface] = useState<DashboardSurface>(() => getDashboardSurface());
  const loginMode: "google" | "fallback" =
    typeof window !== "undefined" && window.location.pathname === FALLBACK_SIGN_PATH
      ? "fallback"
      : "google";
  const [returnTo] = useState<string>(() => readReturnTo());
  const [authNotice] = useState<string | null>(() => readAuthNotice());
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  const [sites, setSites] = useState<Site[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [view, setView] = useState<NavView>(() => readStoredView(surface));
  const [selectedArticle, setSelectedArticle] = useState<ArticleRecord | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    ai_api_connected: false,
    gemini_api_connected: false,
    gemini_flash_model: "",
    gemini_pro_model: "",
    global_ai_rules: "",
    social_agent_rules: "",
    workspace_timezone: "Asia/Kuala_Lumpur",
    trading_agent_url: "",
    trading_agent_connected: false,
    trading_agent_token_saved: false,
    ctrader_client_id: "",
    ctrader_account_id: "",
    ctrader_demo_account_id: "",
    ctrader_live_account_id: "",
    ctrader_connected: false,
    ctrader_client_secret_saved: false,
    ctrader_access_token_saved: false,
  });
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.bootstrap();
      setAuth(data.auth);
      setSites(data.sites);
      setArticles(data.articles);
      if (data.auth.authenticated) {
        void Promise.all([
          api.getCategories().then(setCategories),
          api.getSettings().then(setAppSettings),
        ]).catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load dashboard settings");
        });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isViewAllowedForSurface(view, surface)) {
      const defaultView = getDefaultView(surface);
      setView(defaultView);
      syncViewUrl(surface, defaultView);
      return;
    }
    window.localStorage.setItem(`${DASHBOARD_VIEW_STORAGE_KEY_PREFIX}:${surface}`, view);
    syncViewUrl(surface, view);
  }, [surface, view]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [view]);

  useEffect(() => {
    if (!sidebarOpen || typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  async function saveSettings(payload: AppSettingsInput) {
    const next = await api.updateSettings(payload);
    setAppSettings(next);
    setSettingsMessage(next.sync_result?.message ?? "Settings saved.");
    return next;
  }

  async function syncAgentSettings() {
    const result = await api.syncTradingAgentSettings();
    setSettingsMessage(result.message);
  }

  if (loading) {
    if (surface === "marketing") {
      return (
        <div className="app-bootstrap-shell" aria-busy="true" aria-label="Loading dashboard">
          <span>Loading dashboard...</span>
        </div>
      );
    }
    return <div className="loading-screen">Loading dashboard...</div>;
  }

  async function handlePasswordLogin(username: string, password: string, remember: boolean) {
    const nextAuth = await api.login(username, password, remember);
    if (returnTo && typeof window !== "undefined") {
      window.location.href = returnTo;
      return;
    }
    if (loginMode === "fallback" && typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", "/");
    }
    setAuth(nextAuth);
    await load();
  }

  if (loginMode === "fallback" || !auth.authenticated) {
    return (
      <div className="login-screen">
        <LoginCard
          surface={surface}
          mode={loginMode}
          googleAuthConfigured={auth.google_auth_configured !== false}
          notice={authNotice}
          onSubmit={handlePasswordLogin}
        />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Shell
        sidebarOpen={sidebarOpen}
        sidebarCollapsed={sidebarCollapsed}
        onBackdropClick={() => setSidebarOpen(false)}
        header={
          <div className="shell-header-shell">
            <button
              type="button"
              className="shell-header-shell__menu dashboard-icon-button"
              onClick={() => setSidebarOpen((current) => !current)}
              aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={sidebarOpen}
              title={sidebarOpen ? "Close navigation" : "Open navigation"}
            >
              {sidebarOpen ? <XMarkIcon aria-hidden="true" /> : <Bars3Icon aria-hidden="true" />}
            </button>
            <div className="shell-header-shell__copy">
              <p className="shell-header-shell__eyebrow">Dashboard</p>
              <h1>{getNavLabel(view)}</h1>
            </div>
            <div className="shell-header-shell__actions">
              <button
                type="button"
                className="dashboard-icon-button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open settings"
                title="Settings"
              >
                <Cog6ToothIcon aria-hidden="true" />
              </button>
              <button
                type="button"
                className="dashboard-icon-button"
                onClick={async () => {
                  const confirmed = window.confirm("Sign out now?");
                  if (!confirmed) return;
                  await api.logout();
                  setAuth({ authenticated: false });
                }}
                aria-label="Sign out"
                title="Sign out"
              >
                <ArrowRightOnRectangleIcon aria-hidden="true" />
              </button>
            </div>
          </div>
        }
        sidebar={
          <TopNav
            currentView={view}
            surface={surface}
            collapsed={sidebarCollapsed}
            onNavigate={(nextView) => setView(nextView)}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          />
        }
      >
        {error ? <p className="error panel">{error}</p> : null}
        <DashboardPage
          view={view}
          articles={articles}
          sites={sites}
          categories={categories}
          selectedArticle={selectedArticle}
          onSelectArticle={(article) => {
            setSelectedArticle(article);
          }}
          onSaveArticle={async (payload, id) => {
            await api.saveArticle(payload, id);
            await load();
            setSelectedArticle(undefined);
          }}
          onDeleteArticle={async (id) => {
            await api.deleteArticle(id);
            await load();
          }}
          onUpload={api.uploadMedia}
        />
      </Shell>

      {settingsOpen ? (
        <SettingsModal
          surface={surface}
          settings={appSettings}
          syncMessage={settingsMessage}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onSyncAgent={syncAgentSettings}
        />
      ) : null}
    </div>
  );
}
