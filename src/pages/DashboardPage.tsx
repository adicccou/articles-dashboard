import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/solid";
import type { ArticleRecord, Site, ArticleCategory } from "../lib/types";
import type { NavView } from "../components/TopNav";
import { ArticleEditor } from "../components/ArticleEditor";
import { SocialAgentsPage } from "./SocialAgentsPage";
import { StudioPage } from "./StudioPage";
import { ConfigPage } from "./ConfigPage";
import { TradingHubPage } from "./TradingHubPage";
import { PlannerPage } from "./PlannerPage";
import { ViewErrorBoundary } from "../components/ViewErrorBoundary";
import { StatisticsPage } from "./StatisticsPage";
import { RepliesPage } from "./RepliesPage";
import { formatDisplayDate, formatDisplayTime } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import "../styles/articles-page.css";
import "../styles/trading-page.css";

type DashboardPageProps = {
  view: NavView;
  articles: ArticleRecord[];
  sites: Site[];
  categories: ArticleCategory[];
  selectedArticle?: ArticleRecord;
  onSelectArticle: (article?: ArticleRecord) => void;
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
  onDeleteArticle: (id: number) => Promise<void>;
  onUpload: (file: File) => Promise<{ key: string; url: string }>;
};

export function DashboardPage({
  view,
  articles,
  sites,
  categories,
  selectedArticle,
  onSelectArticle,
  onSaveArticle,
  onDeleteArticle,
  onUpload,
}: DashboardPageProps) {
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
      return <SocialAgentsPage />;
    }

    if (view === "replies") {
      return <RepliesPage />;
    }

    if (view === "studio") {
      return <StudioPage onUpload={onUpload} />;
    }

    if (view === "config") {
      return <ConfigPage />;
    }

    if (view === "trading") {
      return <TradingHubPage />;
    }

    if (view === "planner") {
      return <PlannerPage />;
    }

    if (view === "statistics") {
      return <StatisticsPage />;
    }

    return (
      <section className="panel articles-overview">
        <div className="articles-overview__content">
          <div className="panel__title-row">
            <h2>Articles</h2>
            <div className="actions">
              <button onClick={() => {
                onSelectArticle(undefined);
                setIsCreatingArticle(true);
              }}>New article</button>
            </div>
          </div>
          <div className="table articles-table">
            <div className="table__row table__row--header">
              <span>Title</span>
              <span>Category</span>
              <span>Status</span>
              <span>Sites</span>
              <span>Updated</span>
            </div>
            {articles.map((article) => (
              <div className="table__row article-row" key={article.id} onClick={() => onSelectArticle(article)}>
                <span className="article-row__title">
                  {article.cover_image ? (
                    <img
                      className="article-row__thumbnail"
                      src={normalizeDashboardMediaUrl(article.cover_image)}
                      alt=""
                      loading="lazy"
                    />
                  ) : null}
                  <span className="article-row__title-copy">
                    <span className="article-row__title-text">{article.title}</span>
                    <span className="article-row__title-meta">
                      <span className="article-row__slug">/{article.slug}</span>
                      {article.excerpt ? (
                        <span className="article-row__excerpt">{article.excerpt}</span>
                      ) : null}
                    </span>
                  </span>
                </span>
                <span className="article-row__category">{article.category?.name || "Uncategorized"}</span>
                <span>
                  <span className={`social-status-pill article-status-pill article-status-pill--${article.status}`}>
                    {article.status}
                  </span>
                </span>
                <span>
                  <span className="social-status-pill article-sites-pill">
                    {article.site_ids.length} {article.site_ids.length === 1 ? "site" : "sites"}
                  </span>
                </span>
                <span className="article-row__updated">
                  <strong>{formatDisplayDate(article.updated_at, false)}</strong>
                  <small>{formatDisplayTime(article.updated_at)}</small>
                </span>
                <button
                  className="article-row__delete dashboard-icon-button"
                  type="button"
                  aria-label={`Delete ${article.title}`}
                  title={`Delete ${article.title}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${article.title}"? This cannot be undone.`)) {
                      await onDeleteArticle(article.id);
                    }
                  }}
                >
                  <TrashIcon aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
  return <ViewErrorBoundary resetKey={`${view}-${selectedArticle?.id ?? "none"}-main`} >{renderView()}</ViewErrorBoundary>;
}
