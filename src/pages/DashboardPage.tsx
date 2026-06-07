import { useState } from "react";
import type { ArticleRecord, Site, ArticleCategory, AppSettings, AppSettingsInput } from "../lib/types";
import type { NavView } from "../components/TopNav";
import type { DashboardSurface } from "../lib/surface";
import { ArticlesOverview } from "../components/ArticlesOverview";
import { ArticleEditor } from "../components/ArticleEditor";
import { SocialAgentsPage } from "./SocialAgentsPage";
import { StudioPage } from "./StudioPage";
import { ConfigPage } from "./ConfigPage";
import { TradingHubPage } from "./TradingHubPage";
import { PlannerPage } from "./PlannerPage";
import { ViewErrorBoundary } from "../components/ViewErrorBoundary";
import { StatisticsPage } from "./StatisticsPage";
import { RepliesPage } from "./RepliesPage";
import "../styles/articles-page.css";
import "../styles/trading-page.css";

type DashboardPageProps = {
  view: NavView;
  onNavigate: (view: NavView) => void;
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
  surface: DashboardSurface;
  settings: AppSettings;
  settingsMessage: string | null;
  onSaveSettings: (payload: AppSettingsInput) => Promise<unknown>;
  onSyncAgentSettings: () => Promise<unknown>;
};

export function DashboardPage({
  view,
  onNavigate,
  articles,
  sites,
  categories,
  selectedArticle,
  onSelectArticle,
  onSaveArticle,
  onDeleteArticle,
  onUpload,
  surface,
  settings,
  settingsMessage,
  onSaveSettings,
  onSyncAgentSettings,
}: DashboardPageProps) {
  const [isCreatingArticle, setIsCreatingArticle] = useState(false);
  const [prefilledPublishAt, setPrefilledPublishAt] = useState<string | null>(null);

  function renderView() {
    if (view === "articles" && (selectedArticle || isCreatingArticle)) {
      return (
        <ArticleEditor
          article={selectedArticle}
          defaultScheduledAt={prefilledPublishAt}
          sites={sites}
          categories={categories}
          onSave={async (payload, id) => {
            await onSaveArticle(payload, id);
            setIsCreatingArticle(false);
            setPrefilledPublishAt(null);
          }}
          onUpload={onUpload}
          onDelete={async (id) => {
            await onDeleteArticle(id);
            onSelectArticle(undefined);
            setIsCreatingArticle(false);
            setPrefilledPublishAt(null);
          }}
          onCancel={() => {
            onSelectArticle(undefined);
            setIsCreatingArticle(false);
            setPrefilledPublishAt(null);
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
      return <StudioPage onUpload={onUpload} onNavigate={onNavigate} />;
    }

    if (view === "config") {
      return (
        <ConfigPage
          surface={surface}
          settings={settings}
          syncMessage={settingsMessage}
          onSaveSettings={onSaveSettings}
          onSyncAgent={onSyncAgentSettings}
        />
      );
    }

    if (view === "trading") {
      return <TradingHubPage />;
    }

    if (view === "planner") {
      return <PlannerPage />;
    }

    if (view === "statistics") {
      return <StatisticsPage surface={surface} articles={articles} sites={sites} />;
    }

      return (
      <ArticlesOverview
        articles={articles}
        sites={sites}
        onNewArticle={(scheduledAt) => {
          onSelectArticle(undefined);
          setPrefilledPublishAt(scheduledAt ? scheduledAt.toISOString() : null);
          setIsCreatingArticle(true);
        }}
        onSelectArticle={(article) => {
          setPrefilledPublishAt(null);
          onSelectArticle(article);
        }}
        onDeleteArticle={async (article) => {
          await onDeleteArticle(article.id);
        }}
      />
    );
  }
  return <ViewErrorBoundary resetKey={`${view}-${selectedArticle?.id ?? "none"}-main`} >{renderView()}</ViewErrorBoundary>;
}
