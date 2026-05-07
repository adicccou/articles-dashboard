import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ArticleRecord, AuthState, Site, ArticleCategory, AppSettings, AppSettingsInput } from "../lib/types";
import { AssistantConsole } from "../components/AssistantConsole";
import { LoginCard } from "../components/LoginCard";
import { SettingsModal } from "../components/SettingsModal";
import { TopNav, type NavView } from "../components/TopNav";
import { DashboardPage } from "../pages/DashboardPage";
import "../styles/app.css";

const DASHBOARD_VIEW_STORAGE_KEY = "dashboard:last-view";

function readStoredView(): NavView {
  if (typeof window === "undefined") return "articles";
  const stored = window.localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY);
  return stored === "articles" || stored === "reddit" || stored === "trading" || stored === "planner" || stored === "statistics"
    ? stored
    : "articles";
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  const [sites, setSites] = useState<Site[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [view, setView] = useState<NavView>(readStoredView);
  const [selectedArticle, setSelectedArticle] = useState<ArticleRecord | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistantMinimized, setAssistantMinimized] = useState(true);
  const [assistantModalOpen, setAssistantModalOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    ai_api_connected: false,
    claude_model: "claude-sonnet-4-20250514",
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
    window.localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, view);
  }, [view]);

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
