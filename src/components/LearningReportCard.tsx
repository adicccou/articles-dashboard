import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { LearningReport, LearningSuggestion, MlLearningExperiment } from "../lib/types";

function pct(value?: number): string {
  if (value === undefined || value === null) return "0%";
  return `${(value * 100).toFixed(0)}%`;
}

function impactClass(suggestion: LearningSuggestion): string {
  return `learning-report-card__impact learning-report-card__impact--${String(suggestion.impact || "LOW").toLowerCase()}`;
}

export function LearningReportCard() {
  const [report, setReport] = useState<LearningReport | null>(null);
  const [experiments, setExperiments] = useState<MlLearningExperiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [nextReport, nextExperiments] = await Promise.all([
        api.getLearningReport(),
        api.listMlLearningExperiments(),
      ]);
      setReport(nextReport);
      setExperiments(nextExperiments);
    } catch (error) {
      setReport({
        connected: false,
        error: error instanceof Error ? error.message : "Could not load learning report",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function trackSuggestion(suggestion: LearningSuggestion) {
    const key = `${suggestion.factor}:${suggestion.current}:${suggestion.recommended}`;
    try {
      setSavingKey(key);
      const experiment = await api.createMlLearningExperiment(suggestion, report?.stats);
      setExperiments((current) => [experiment, ...current.filter((item) => item.id !== experiment.id)]);
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <section className="panel learning-report-card learning-report-card--loading">
        <span className="learning-report-card__eyebrow">Self-learning</span>
        <span className="learning-report-card__muted">Loading latest report...</span>
      </section>
    );
  }

  if (!report?.connected) {
    return (
      <section className="panel learning-report-card">
        <div className="learning-report-card__header">
          <div>
            <span className="learning-report-card__eyebrow">Self-learning</span>
            <h3>Learning engine offline</h3>
        </div>
        <button className="lean-status-card__refresh" onClick={() => void load()} aria-label="Refresh learning report">
            Refresh
        </button>
        </div>
        <p className="learning-report-card__muted">{report?.error || "Trading agent is not configured yet."}</p>
      </section>
    );
  }

  const stats = report.stats || {};
  const suggestions = stats.suggestions || [];
  const sourceCounts = stats.source_counts || {};
  const symbols = Object.entries(stats.by_symbol || {});

  return (
    <section className="panel learning-report-card">
      <div className="learning-report-card__header">
        <div>
          <span className="learning-report-card__eyebrow">Backtesting & Self-learning</span>
          <h3>Latest Strategy Report</h3>
        </div>
        <button className="lean-status-card__refresh" onClick={() => void load()} aria-label="Refresh learning report">
          Refresh
        </button>
      </div>

      <div className="learning-report-card__stats">
        <div>
          <span className="learning-report-card__label">Trades analysed</span>
          <strong>{stats.total ?? 0}</strong>
          <small>{sourceCounts.backtest ?? 0} backtest + {sourceCounts.live ?? 0} live</small>
        </div>
        <div>
          <span className="learning-report-card__label">Win rate</span>
          <strong className={(stats.win_rate ?? 0) >= 0.6 ? "learning-report-card__good" : "learning-report-card__risk"}>
            {pct(stats.win_rate)}
          </strong>
          <small>Target 60%</small>
        </div>
        <div>
          <span className="learning-report-card__label">Avg RR</span>
          <strong>{Number(stats.avg_rr || 0).toFixed(2)}R</strong>
          <small>PF {Number(stats.profit_factor || 0).toFixed(2)}</small>
        </div>
        <div>
          <span className="learning-report-card__label">Best window</span>
          <strong>{stats.best_hours_utc || "N/A"}</strong>
          <small>UTC</small>
        </div>
      </div>

      {symbols.length > 0 ? (
        <div className="learning-report-card__symbols">
          {symbols.map(([symbol, rate]) => (
            <span key={symbol}>{symbol}: {pct(rate)}</span>
          ))}
        </div>
      ) : null}

      <div className="learning-report-card__factors">
        <span>RSI divergence {pct(stats.with_rsi_div)} vs {pct(stats.without_rsi_div)}</span>
        <span>VWAP cross {pct(stats.with_vwap)} vs {pct(stats.without_vwap)}</span>
      </div>

      <div className="learning-report-card__suggestions">
        <div className="learning-report-card__subhead">Suggestions</div>
        {suggestions.length === 0 ? (
          <p className="learning-report-card__muted">No major self-learning adjustments suggested right now.</p>
        ) : (
          suggestions.map((suggestion) => (
            <div className="learning-report-card__suggestion" key={`${suggestion.factor}-${suggestion.recommended}`}>
              <span className={impactClass(suggestion)}>{suggestion.impact}</span>
              <div>
                <div className="learning-report-card__suggestion-head">
                  <strong>{suggestion.factor.replace(/_/g, " ")}: {suggestion.current} {"->"} {suggestion.recommended}</strong>
                  <button
                    type="button"
                    className="button-secondary learning-report-card__track"
                    onClick={() => void trackSuggestion(suggestion)}
                    disabled={savingKey === `${suggestion.factor}:${suggestion.current}:${suggestion.recommended}`}
                  >
                    {savingKey === `${suggestion.factor}:${suggestion.current}:${suggestion.recommended}` ? "Tracking..." : "Track"}
                  </button>
                </div>
                <p>{suggestion.evidence}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="learning-report-card__experiments">
        <div className="learning-report-card__subhead">Learning Experiments</div>
        {experiments.length === 0 ? (
          <p className="learning-report-card__muted">Track a suggestion to measure it in shadow mode before applying changes.</p>
        ) : (
          experiments.slice(0, 5).map((experiment) => (
            <div className="learning-report-card__experiment" key={experiment.id}>
              <div>
                <strong>{experiment.factor.replace(/_/g, " ")}: {experiment.current_value} {"->"} {experiment.recommended_value}</strong>
                <p>{experiment.evidence || "Collecting candidate results."}</p>
              </div>
              <div className="learning-report-card__experiment-metrics">
                <span>{experiment.status}</span>
                <small>Base {pct(experiment.baseline_win_rate ?? undefined)} / Candidate {pct(experiment.candidate_win_rate ?? undefined)}</small>
                <small>Avoided losers {experiment.avoided_losers} · Skipped winners {experiment.skipped_winners}</small>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
