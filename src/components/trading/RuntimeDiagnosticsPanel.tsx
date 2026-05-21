import type { ReactNode } from "react";
import type { TradingRuntimeSummary } from "../../lib/types";
import { formatAgo, runtimeHeadline, runtimeTone, summarizeCounts, topRuntimeBlockers } from "../../lib/tradingDiagnostics";

export function RuntimeDiagnosticsPanel({
  title,
  summary,
  extra,
}: {
  title: string;
  summary: TradingRuntimeSummary | null | undefined;
  extra?: ReactNode;
}) {
  const blockers = topRuntimeBlockers(summary);

  return (
    <section className="panel runtime-diagnostics">
      <div className="runtime-diagnostics__header">
        <div>
          <span className="custom-lean-eyebrow">Runtime Diagnostics</span>
          <h3>{title}</h3>
        </div>
        <strong className={runtimeTone(summary)}>{runtimeHeadline(summary)}</strong>
      </div>
      <div className="runtime-diagnostics__meta">
        <div>
          <span>Last update</span>
          <strong>{formatAgo(summary?.diagnostics_age_seconds)}</strong>
        </div>
        <div>
          <span>Status counts</span>
          <strong>{summarizeCounts(summary?.status_counts)}</strong>
        </div>
        {summary?.event_counts ? (
          <div>
            <span>Event counts</span>
            <strong>{summarizeCounts(summary.event_counts)}</strong>
          </div>
        ) : null}
        {extra}
      </div>
      {blockers.length ? (
        <div className="runtime-diagnostics__blockers">
          {blockers.map((blocker) => (
            <article key={`${blocker.code}-${blocker.target || "global"}`} className={`runtime-diagnostics__blocker runtime-diagnostics__blocker--${blocker.level}`}>
              <span>{blocker.level}</span>
              <p>{blocker.message}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="runtime-diagnostics__empty">No current blockers detected.</p>
      )}
    </section>
  );
}
