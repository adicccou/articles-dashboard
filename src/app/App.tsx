import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ArticleRecord, AuthState, Site } from "../lib/types";
import { LoginCard } from "../components/LoginCard";
import { Shell } from "../components/Shell";
import { DashboardPage } from "../pages/DashboardPage";

type View = "articles" | "sites" | "editor";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false });
  const [sites, setSites] = useState<Site[]>([]);
  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [view, setView] = useState<View>("articles");
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
    <Shell
      header={
        <div className="topbar">
          <div>
            <p className="eyebrow">Multi-site CMS</p>
            <h1>Article Dashboard</h1>
          </div>
          <div className="actions">
            <button
              className="button-secondary"
              onClick={async () => {
                await api.logout();
                setAuth({ authenticated: false });
              }}
            >
              Logout
            </button>
          </div>
        </div>
      }
      sidebar={
        <nav className="sidebar-nav">
          <button className={view === "articles" ? "is-active" : ""} onClick={() => setView("articles")}>
            Articles
          </button>
          <button className={view === "editor" && !selectedArticle ? "is-active" : ""} onClick={() => {
            setSelectedArticle(undefined);
            setView("editor");
          }}>
            New Article
          </button>
          <button className={view === "sites" ? "is-active" : ""} onClick={() => setView("sites")}>
            Sites
          </button>
        </nav>
      }
    >
      {error ? <p className="error panel">{error}</p> : null}
      <DashboardPage
        view={view}
        articles={articles}
        sites={sites}
        selectedArticle={selectedArticle}
        onSelectArticle={(article) => {
          setSelectedArticle(article);
          setView("editor");
        }}
        onCreateSite={async (payload) => {
          await api.createSite(payload);
          await load();
          setView("sites");
        }}
        onSaveArticle={async (payload, id) => {
          await api.saveArticle(payload, id);
          await load();
          setView("articles");
          setSelectedArticle(undefined);
        }}
        onUpload={api.uploadMedia}
      />
    </Shell>
  );
}
