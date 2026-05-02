import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ArticleRecord, AuthState, Site, ArticleCategory } from "../lib/types";
import { LoginCard } from "../components/LoginCard";
import { TopNav, type NavView } from "../components/TopNav";
import { DashboardPage } from "../pages/DashboardPage";
import "../styles/app.css";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  const [sites, setSites] = useState<Site[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [view, setView] = useState<NavView>("articles");
  const [selectedArticle, setSelectedArticle] = useState<ArticleRecord | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return <div className="loading-screen">Loading dashboard...</div>;
  }

  if (!auth.authenticated) {
    return (
      <div className="login-screen">
        <LoginCard
          onSubmit={async (username, password) => {
            const nextAuth = await api.login(username, password);
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
        username={auth.username}
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
          onUpload={api.uploadMedia}
        />
      </main>
    </div>
  );
}
