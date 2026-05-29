import { TrashIcon } from "@heroicons/react/24/solid";
import type { ArticleRecord } from "../lib/types";
import { formatDisplayDate, formatDisplayTime } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";

type ArticlesOverviewProps = {
  articles: ArticleRecord[];
  onNewArticle: () => void;
  onSelectArticle: (article: ArticleRecord) => void;
  onDeleteArticle: (article: ArticleRecord) => Promise<void>;
};

export function ArticlesOverview({
  articles,
  onNewArticle,
  onSelectArticle,
  onDeleteArticle,
}: ArticlesOverviewProps) {
  return (
    <section className="panel articles-overview">
      <div className="articles-overview__content">
        <div className="panel__title-row">
          <div className="actions">
            <button onClick={onNewArticle}>New article</button>
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
                onClick={async (event) => {
                  event.stopPropagation();
                  if (confirm(`Delete "${article.title}"? This cannot be undone.`)) {
                    await onDeleteArticle(article);
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
