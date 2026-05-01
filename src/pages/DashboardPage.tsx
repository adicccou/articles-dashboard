import type { ArticleRecord, Site } from "../lib/types";
import { ArticleEditor } from "../components/ArticleEditor";
import { SiteForm } from "../components/SiteForm";

type DashboardPageProps = {
  view: "articles" | "sites" | "editor";
  articles: ArticleRecord[];
  sites: Site[];
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
  selectedArticle,
  onSelectArticle,
  onCreateSite,
  onSaveArticle,
  onUpload,
}: DashboardPageProps) {
  if (view === "sites") {
    return (
      <div className="stack">
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

  if (view === "editor") {
    return (
      <ArticleEditor
        article={selectedArticle}
        sites={sites}
        onSave={onSaveArticle}
        onUpload={onUpload}
      />
    );
  }

  return (
    <section className="panel">
      <div className="panel__title-row">
        <h2>Articles</h2>
        <button onClick={() => onSelectArticle(undefined)}>New article</button>
      </div>
      <div className="table">
        <div className="table__row table__row--header">
          <span>Title</span>
          <span>Status</span>
          <span>Sites</span>
          <span>Updated</span>
        </div>
        {articles.map((article) => (
          <button className="table__row table__button-row" key={article.id} onClick={() => onSelectArticle(article)}>
            <span>{article.title}</span>
            <span>{article.status}</span>
            <span>{article.site_ids.length}</span>
            <span>{new Date(article.updated_at).toLocaleString()}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
