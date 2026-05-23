import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ArticleRecord, AuthState, Site, ArticleCategory, AppSettings, AppSettingsInput } from "../lib/types";
import { AssistantConsole } from "../components/AssistantConsole";
import { LoginCard } from "../components/LoginCard";
import { SettingsModal } from "../components/SettingsModal";
import { TopNav, type NavView } from "../components/TopNav";
import { DashboardPage } from "../pages/DashboardPage";
import {
  getDashboardSurface,
  getDefaultView,
  isViewAllowedForSurface,
  normalizeStoredView,
  type DashboardSurface,
} from "../lib/surface";
import "../styles/app.css";

const DASHBOARD_VIEW_STORAGE_KEY_PREFIX = "dashboard:last-view";

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

export function App() {
  const [surface] = useState<DashboardSurface>(() => getDashboardSurface());
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  const [sites, setSites] = useState<Site[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [view, setView] = useState<NavView>(() => readStoredView(surface));
  const [selectedArticle, setSelectedArticle] = useState<ArticleRecord | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistantMinimized, setAssistantMinimized] = useState(true);
  const [assistantModalOpen, setAssistantModalOpen] = useState(false);
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
        const cats = await api.getCategories();
        setCategories(cats);
        const settings = await api.getSettings();
        setAppSettings(settings);
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
      setView(getDefaultView(surface));
      return;
    }
    window.localStorage.setItem(`${DASHBOARD_VIEW_STORAGE_KEY_PREFIX}:${surface}`, view);
  }, [surface, view]);

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
    return <div className="loading-screen">Loading dashboard...</div>;
  }

  if (!auth.authenticated) {
    return (
      <div className="login-screen">
        <LoginCard
          onSubmit={async (username, password, remember) => {
            const nextAuth = await api.login(username, password, remember);
            setAuth(nextAuth);
            await load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <TopNav
        currentView={view}
        surface={surface}
        onNavigate={setView}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={async () => {
          await api.logout();
          setAuth({ authenticated: false });
        }}
      />
      <main className="app-content">
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
          onCreateSite={async (payload) => {
            await api.createSite(payload);
            await load();
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
      </main>

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

      {assistantModalOpen ? (
        <div className="assistant-modal-backdrop" onClick={() => setAssistantModalOpen(false)}>
          <div className="assistant-modal" onClick={(event) => event.stopPropagation()}>
            <AssistantConsole
              variant="modal"
              onDock={() => {
                setAssistantModalOpen(false);
                setAssistantMinimized(false);
              }}
            />
          </div>
        </div>
      ) : assistantMinimized ? (
        <button
          type="button"
          className="assistant-launcher"
          onClick={() => setAssistantMinimized(false)}
        >
          Assistant
        </button>
      ) : (
        <div className="assistant-floating">
          <AssistantConsole
            variant="floating"
            onMinimize={() => setAssistantMinimized(true)}
            onOpenModal={() => setAssistantModalOpen(true)}
          />
        </div>
      )}
    </div>
  );
}
