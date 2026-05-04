import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { JournlStats } from "../lib/types";
import "../styles/statistics-page.css";

type ProjectId = "journl" | "sooda" | "myspaces";

const PROJECTS: { id: ProjectId; label: string; available: boolean }[] = [
  { id: "journl", label: "journl", available: true },
  { id: "sooda",   label: "sooda",   available: false },
  { id: "myspaces", label: "myspaces", available: false },
];

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "blue" | "amber" | "purple";
}) {
  return (
    <div className={`stat-card ${accent ? `stat-card--${accent}` : ""}`}>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {sub && <span className="stat-card__sub">{sub}</span>}
    </div>
  );
}

function JournlStatsView() {
  const [stats, setStats] = useState<JournlStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getJournlStats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="stats-loading">Loading stats…</div>;
  if (error) return <div className="stats-error">{error}</div>;
  if (!stats) return null;

  const returnRate7d = stats.total_accounts > 0
    ? Math.round((stats.active_7d / stats.total_accounts) * 100)
    : 0;
  const returnRate30d = stats.total_accounts > 0
    ? Math.round((stats.active_30d / stats.total_accounts) * 100)
    : 0;
  const conversionRate = stats.total_accounts > 0
    ? Math.round((stats.subscriptions / stats.total_accounts) * 100)
    : 0;

  return (
    <div className="stats-grid">
      {/* Row 1 – Accounts */}
      <StatCard
        label="Total Accounts"
        value={stats.total_accounts.toLocaleString()}
        sub={`+${stats.new_7d} this week · +${stats.new_30d} this month`}
        accent="blue"
      />
      <StatCard
        label="Subscriptions"
        value={stats.subscriptions.toLocaleString()}
        sub={`${conversionRate}% conversion`}
        accent="green"
      />
      <StatCard
        label="Pro"
        value={stats.pro.toLocaleString()}
        sub="recurring"
        accent="purple"
      />
      <StatCard
        label="Lifetime"
        value={stats.lifetime.toLocaleString()}
        sub="one-time"
        accent="amber"
      />

      {/* Row 2 – Engagement */}
      <StatCard
        label="Active (7 days)"
        value={stats.active_7d.toLocaleString()}
        sub={`${returnRate7d}% return rate`}
      />
      <StatCard
        label="Active (30 days)"
        value={stats.active_30d.toLocaleString()}
        sub={`${returnRate30d}% return rate`}
      />
      <StatCard
        label="Free Users"
        value={stats.free.toLocaleString()}
        sub="not yet subscribed"
      />
      <StatCard
        label="Total Visits"
        value="—"
        sub="analytics not connected"
      />
    </div>
  );
}

export function StatisticsPage() {
  const [project, setProject] = useState<ProjectId>("journl");

  return (
    <section className="panel statistics-panel">
      <div className="panel__title-row">
        <h2>Statistics</h2>
      </div>

      {/* Project selector */}
      <div className="project-selector">
        {PROJECTS.map((p) => (
          <button
            key={p.id}
            className={`project-tab ${project === p.id ? "project-tab--active" : ""} ${!p.available ? "project-tab--disabled" : ""}`}
            onClick={() => p.available && setProject(p.id)}
            disabled={!p.available}
            title={!p.available ? "Coming soon" : undefined}
          >
            {p.label}
            {!p.available && <span className="project-tab__badge">soon</span>}
          </button>
        ))}
      </div>

      {project === "journl" && <JournlStatsView />}
    </section>
  );
}
