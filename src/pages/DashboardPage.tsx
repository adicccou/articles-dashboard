import { useState } from "react";
import type { ArticleRecord, Site, ArticleCategory } from "../lib/types";
import type { NavView } from "../components/TopNav";
import { ArticleEditor } from "../components/ArticleEditor";
import { SiteForm } from "../components/SiteForm";
import { RedditAgentPage } from "./RedditAgentPage";
import { TradingPage } from "./TradingPage";
import { PlannerPage } from "./PlannerPage";
import { ViewErrorBoundary } from "../components/ViewErrorBoundary";
import { StatisticsPage } from "./StatisticsPage";
import "../styles/trading-page.css";

type DashboardPageProps = {
  view: NavView;
  articles: ArticleRecord[];
  sites: Site[];
  categories: ArticleCategory[];
  selectedArticle?: ArticleRecord;
  onSelectArticle: (article?: ArticleRecord) => void;
  onCreateSite: (payload: {
    name: string;
    slug: string;
    domain: string;
    status: "active" | "inactive";
  }) => Promise<void>;
  onSaveArticle: (
    payload: {
      title: string;
      slug: string;
      excerpt: string;
      content: string;
      cover_image: string | null;
      status: "draft" | "published";
      published_at: string | null;
      category_id?: number | null;
      site_ids: number[];
      seo: {
        meta_title: string;
        meta_description: string;
        og_image: string;
        canonical_url: string;
      };
    },
    id?: number,
  ) => Promise<void>;
  onUpload: (file: File) => Promise<{ key: string; url: string }>;
};

export function DashboardPage({
  view,
  articles,
  sites,
  categories,
  selectedArticle,
  onSelectArticle,
  onCreateSite,
  onSaveArticle,
  onUpload,
}: DashboardPageProps) {
  const [showSiteSettings, setShowSiteSettings] = useState(false);
  const [isCreatingArticle, setIsCreatingArticle] = useState(false);

  function renderView() {
    if (view === "articles" && (selectedArticle || isCreatingArticle)) {
      return (
        <ArticleEditor
          article={selectedArticle}
          sites={sites}
          categories={categories}
          onSave={async (payload, id) => {
            await onSaveArticle(payload, id);
            setIsCreatingArticle(false);
          }}
          onUpload={onUpload}
          onCancel={() => {
            onSelectArticle(undefined);
            setIsCreatingArticle(false);
          }}
        />
      );
    }

    if (view === "reddit") {
      return <RedditAgentPage />;
    }

    if (view === "trading") {
      return <TradingPage />;
    }

    if (view === "planner") {
      return <PlannerPage />;
    }

    if (view === "statistics") {
      return <StatisticsPage />;
    }

    if (showSiteSettings) {
      return (
        <div className="stack">
          <button onClick={() => setShowSiteSettings(false)} className="button-secondary">
            ← Back to Articles
          </button>
          <SiteForm onCreate={onCreateSite} />
          <section className="panel">
            <div className="panel__title-row">
              <h2>Connected Sites</h2>
            </div>
            <div className="table">
              <div className="table__row table__row--header">
                <span>Name</span>
                <span>Slug</span>
                <span>Domain</span>
                <span>Status</span>
              </div>
              {sites.map((site) => (
                <div className="table__row" key={site.id}>
                  <span>{site.name}</span>
                  <span>{site.slug}</span>
                  <span>{site.domain}</span>
                  <span>{site.status}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      );
    }

    return (
      <section className="panel">
        <div className="panel__title-row">
          <h2>Articles</h2>
          <div className="actions">
            <button onClick={() => setShowSiteSettings(true)} className="button-secondary">
              Sites Settings
            </button>
            <button onClick={() => {
              onSelectArticle(undefined);
              setIsCreatingArticle(true);
            }}>New article</button>
          </div>
        </div>
        <div className="table">
          <div className="table__row table__row--header">
            <span>Title</span>
            <span>Category</span>
            <span>Status</span>
            <span>Sites</span>
            <span>Updated</span>
          </div>
          {articles.map((article) => (
            <button className="table__row table__button-row" key={article.id} onClick={() => onSelectArticle(article)}>
              <span>{article.title}</span>
              <span>{article.category?.name || "—"}</span>
              <span>{article.status}</span>
              <span>{article.site_ids.length}</span>
              <span>{new Date(article.updated_at).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }
  return <ViewErrorBoundary resetKey={`${view}-${selectedArticle?.id ?? "none"}-${showSiteSettings ? "sites" : "main"}`} >{renderView()}</ViewErrorBoundary>;
}
