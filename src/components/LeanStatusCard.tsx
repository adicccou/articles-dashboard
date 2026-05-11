import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

type LeanStatus = Awaited<ReturnType<typeof api.getLeanStatus>>;

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function LeanStatusCard() {
  const [status, setStatus] = useState<LeanStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getLeanStatus();
      setStatus(data);
    } catch {
      setStatus({ connected: false, error: "Could not reach agent" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading) {
    return (
      <section className="panel lean-status-card lean-status-card--loading">
        <span className="lean-status-card__dot lean-status-card__dot--idle" />
        <span className="lean-status-card__label">LEAN Scanner</span>
        <span className="lean-status-card__value" style={{ color: "#9ca3af" }}>Checking…</span>
      </section>
    );
  }

  if (!status?.connected) {
    return (
      <section className="panel lean-status-card">
        <div className="lean-status-card__header">
          <span className="lean-status-card__dot lean-status-card__dot--offline" />
          <span className="lean-status-card__label">LEAN Scanner</span>
          <span className="lean-status-card__badge lean-status-card__badge--offline">Agent offline</span>
        </div>
        {status?.error && (
          <p className="lean-status-card__error">{status.error}</p>
        )}
      </section>
    );
  }

  const running = status.scanner_running;
  const backtesting = status.backtest_running;
  const lastSignal = status.last_signal;
  const signalsToday = status.signals_today ?? 0;
  const signalsCap = status.signals_cap ?? 0;
  const strategyActive = status.strategy_active;
  const demoMode = status.demo_mode;

  return (
    <section className="panel lean-status-card">
      <div className="lean-status-card__header">
        <span
          className={`lean-status-card__dot ${
            backtesting
              ? "lean-status-card__dot--backtest"
              : running
              ? "lean-status-card__dot--live"
              : "lean-status-card__dot--idle"
          }`}
        />
        <span className="lean-status-card__label">LEAN Scanner</span>

        <div className="lean-status-card__badges">
          {backtesting && (
            <span className="lean-status-card__badge lean-status-card__badge--backtest">⏳ Backtesting</span>
          )}
          {!backtesting && running && (
            <span className="lean-status-card__badge lean-status-card__badge--live">● Live</span>
          )}
          {!backtesting && !running && (
            <span className="lean-status-card__badge lean-status-card__badge--offline">Stopped</span>
          )}
          {demoMode && (
            <span className="lean-status-card__badge lean-status-card__badge--demo">Demo</span>
          )}
          {!strategyActive && (
            <span className="lean-status-card__badge lean-status-card__badge--offline">Strategy inactive</span>
          )}
        </div>

        <button
          className="lean-status-card__refresh"
          onClick={() => void refresh()}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div className="lean-status-card__metrics">
        <div className="lean-status-card__metric">
          <span className="lean-status-card__metric-label">Signals today</span>
          <span className="lean-status-card__metric-value">
            {signalsToday}
            {signalsCap > 0 && (
              <span className="lean-status-card__metric-cap"> / {signalsCap}</span>
            )}
          </span>
        </div>

        {lastSignal ? (
          <>
            <div className="lean-status-card__metric">
              <span className="lean-status-card__metric-label">Last signal</span>
              <span className="lean-status-card__metric-value">
                <span
                  className={`lean-status-card__direction lean-status-card__direction--${lastSignal.direction}`}
                >
                  {lastSignal.direction === "long" ? "▲" : "▼"} {lastSignal.symbol}
                </span>
                <span className="lean-status-card__timeframe">{lastSignal.timeframe}</span>
              </span>
            </div>

            {lastSignal.confidence !== null && lastSignal.confidence !== undefined && (
              <div className="lean-status-card__metric">
                <span className="lean-status-card__metric-label">Confidence</span>
                <span
                  className="lean-status-card__metric-value"
                  style={{
                    color:
                      lastSignal.confidence >= 90
                        ? "#166534"
                        : lastSignal.confidence >= 85
                        ? "#92400e"
                        : "#dc2626",
                    fontWeight: 600,
                  }}
                >
                  {lastSignal.confidence}%
                </span>
              </div>
            )}

            <div className="lean-status-card__metric">
              <span className="lean-status-card__metric-label">Detected</span>
              <span className="lean-status-card__metric-value lean-status-card__metric-value--muted">
                {timeAgo(lastSignal.detected_at)}
              </span>
            </div>
          </>
        ) : (
          <div className="lean-status-card__metric">
            <span className="lean-status-card__metric-label">Last signal</span>
            <span className="lean-status-card__metric-value lean-status-card__metric-value--muted">None yet</span>
          </div>
        )}
      </div>
    </section>
  );
}
