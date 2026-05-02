import { useState } from "react";
import type { ArticleRecord, Site, ArticleCategory } from "../lib/types";
import type { NavView } from "../components/TopNav";
import { ArticleEditor } from "../components/ArticleEditor";
import { SiteForm } from "../components/SiteForm";
import { RedditAgentPage } from "./RedditAgentPage";
import { TradingPage } from "./TradingPage";
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

  if (view === "articles" && selectedArticle) {
    return (
      <ArticleEditor
        article={selectedArticle}
        sites={sites}
        categories={categories}
        onSave={onSaveArticle}
        onUpload={onUpload}
        onCancel={() => onSelectArticle(undefined)}
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
    return (
      <section className="panel">
        <div className="panel__title-row">
          <h2>📅 Post Planner</h2>
        </div>
        <p style={{ color: "#6b7280", padding: "16px" }}>
          Schedule articles and posts across your sites and social media accounts.
        </p>
      </section>
    );
  }

  if (view === "analytics") {
    return (
      <section className="panel">
        <div className="panel__title-row">
          <h2>📊 Analytics</h2>
        </div>
        <p style={{ color: "#6b7280", padding: "16px" }}>
          Track engagement and performance of your content across all platforms.
        </p>
      </section>
    );
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
          <button onClick={() => onSelectArticle(undefined)}>New article</button>
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
