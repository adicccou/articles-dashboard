import { useEffect, useState } from "react";
import type { TradingStrategy, TradingStats } from "../lib/types";
import { api } from "../lib/api";
import { TradingStrategyForm } from "../components/TradingStrategyForm";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";
import { asArray } from "../lib/collections";

type TabView = "strategies" | "form";

export function TradingPage() {
  const [strategies, setStrategies] = useState<TradingStrategy[]>([]);
  const [tab, setTab] = useState<TabView>("strategies");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<TradingStrategy | null>(null);
  const [stats, setStats] = useState<TradingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const data = await api.listTradingStrategies();
      setStrategies(asArray<TradingStrategy>(data));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load strategies");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function upsertStrategy(next: TradingStrategy) {
    setStrategies((prev) => {
      const remaining = prev.filter((strategy) => strategy.id !== next.id);
      return [next, ...remaining];
    });
  }

  async function handleSelectStrategy(strategy: TradingStrategy) {
    setSelectedStrategy(strategy);
    try {
      const statsData = await api.getTradingStats(strategy.id);
      setStats(statsData);
    } catch {
      setStats(null);
    }
  }

  async function handleActivateStrategy(strategy: TradingStrategy) {
    try {
      const activated = await api.activateTradingStrategy(strategy.id);
      setStrategies((prev) =>
        prev.map((item) =>
          item.id === activated.id
            ? activated
            : { ...item, status: "inactive" as TradingStrategy["status"] },
        ),
      );
      if (selectedStrategy) {
        setSelectedStrategy((prev) => (prev ? (prev.id === activated.id ? activated : { ...prev, status: "inactive" }) : prev));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate strategy");
    }
  }

  async function handleDeactivateStrategy(strategy: TradingStrategy) {
    try {
      const deactivated = await api.deactivateTradingStrategy(strategy.id);
      setStrategies((prev) =>
        prev.map((item) =>
          item.id === deactivated.id ? deactivated : item,
        ),
      );
      setSelectedStrategy((prev) => (prev && prev.id === deactivated.id ? deactivated : prev));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate strategy");
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (tab === "form") {
    return (
      <div className="stack">
        <button onClick={() => setTab("strategies")} className="button-secondary">
          ← Back to Strategies
        </button>
        <div className="panel">
          <h2>{editingId ? "Edit Strategy" : "Create New Strategy"}</h2>
          <TradingStrategyForm
            strategy={asArray<TradingStrategy>(strategies).find((s) => s.id === editingId)}
            onSubmit={async (data) => {
              if (editingId) {
                const existing = asArray<TradingStrategy>(strategies).find((strategy) => strategy.id === editingId);
                await api.updateTradingStrategy(editingId, data);
                if (existing) {
                  const updated = { ...existing, ...data, id: editingId } as TradingStrategy;
                  upsertStrategy(updated);
                  if (selectedStrategy?.id === editingId) {
                    setSelectedStrategy(updated);
                  }
                  if (existing.status === "active") {
                    await api.syncTradingAgentSettings();
                  }
                }
              } else {
                const created = await api.createTradingStrategy(
                  data as Omit<TradingStrategy, "id" | "status" | "created_at" | "updated_at">
                );
                upsertStrategy(created);
              }
              setTab("strategies");
              setEditingId(null);
            }}
            onCancel={() => {
              setTab("strategies");
              setEditingId(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {error && <p className="error panel">{error}</p>}
      <section className="panel">
        <div className="panel__title-row">
          <h2>📈 Trading Strategies</h2>
          <div className="actions">
            <button onClick={() => { setEditingId(null); setTab("form"); }}>
              New Strategy
            </button>
          </div>
        </div>

        {strategies.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#6b7280" }}>
            <p>No trading strategies created yet.</p>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>
              Create your first trading strategy to start automated trading.
            </p>
          </div>
        ) : (
          <div className="table trading-table">
            <div className="table__row table__row--header trading-table__row">
              <span>Name</span>
              <span>Assets</span>
              <span>Mode</span>
              <span>Status</span>
              <span>Daily Signals</span>
              <span>Risk</span>
              <span>Actions</span>
            </div>
            {asArray<TradingStrategy>(strategies).map((strategy) => (
              <div className="table__row trading-table__row" key={strategy.id}>
                <span className="truncate">{strategy.name}</span>
                <span>{strategy.assets.join(", ")}</span>
                <span>{strategy.execution_mode}</span>
                <span>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      backgroundColor: strategy.status === "active" ? "#dcfce7" : "#f3f4f6",
                      color: strategy.status === "active" ? "#166534" : "#6b7280",
                    }}
                >
                  {strategy.status}
                </span>
                </span>
                <span>{strategy.daily_max_trade_signals}/day</span>
                <span>${strategy.risk_usd_min}-${strategy.risk_usd_max} • {strategy.rr_min}R-{strategy.rr_max}R</span>
                <span className="trading-table__actions">
                  <button
                    onClick={() => handleSelectStrategy(strategy)}
                    className="button-secondary trading-table__button"
                  >
                    View
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(strategy.id);
                      setTab("form");
                    }}
                    className="button-secondary trading-table__button"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      void (strategy.status === "active"
                        ? handleDeactivateStrategy(strategy)
                        : handleActivateStrategy(strategy));
                    }}
                    className="button-secondary trading-table__button"
                  >
                    {strategy.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={async () => {
                      const wasActive = strategy.status === "active";
                      await api.deleteTradingStrategy(strategy.id);
                      if (selectedStrategy?.id === strategy.id) {
                        setSelectedStrategy(null);
                        setStats(null);
                      }
                      if (wasActive) {
                        await api.syncTradingAgentSettings();
                      }
                      await load();
                    }}
                    className="trading-table__delete"
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedStrategy && (
        <section className="panel">
          <div className="panel__title-row">
            <h2>{selectedStrategy.name} — Statistics</h2>
            <div className="actions">
              <button
                onClick={() => {
                  setEditingId(selectedStrategy.id);
                  setTab("form");
                }}
                className="button-secondary"
              >
                Edit Strategy
              </button>
              <button
                onClick={() => {
                  void (selectedStrategy.status === "active"
                    ? handleDeactivateStrategy(selectedStrategy)
                    : handleActivateStrategy(selectedStrategy));
                }}
                className="button-secondary"
              >
                {selectedStrategy.status === "active" ? "Deactivate Strategy" : "Activate Strategy"}
              </button>
              <button
                onClick={() => { setSelectedStrategy(null); setStats(null); }}
                className="button-secondary"
              >
                Close
              </button>
            </div>
          </div>

          {stats ? (
            <div className="trading-stats">
              <div className="stat-card">
                <div className="stat-card__label">Total Trades</div>
                <div className="stat-card__value">{stats.total_trades}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Win Rate</div>
                <div className="stat-card__value">{(stats.win_rate * 100).toFixed(1)}%</div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Total Pips</div>
                <div
                  className="stat-card__value"
                  style={{ color: stats.total_pips >= 0 ? "#166534" : "#dc2626" }}
                >
                  {stats.total_pips >= 0 ? "+" : ""}{stats.total_pips.toFixed(1)}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Avg Pips/Trade</div>
                <div className="stat-card__value">{stats.avg_pips_per_trade.toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Wins</div>
                <div className="stat-card__value">{stats.winning_trades}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Losses</div>
                <div className="stat-card__value">{stats.losing_trades}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Max Consec. Wins</div>
                <div className="stat-card__value">{stats.max_consecutive_wins}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">Largest Win</div>
                <div className="stat-card__value" style={{ color: "#166534" }}>
                  +{stats.largest_win_pips.toFixed(1)}
                </div>
              </div>
            </div>
          ) : (
            <p style={{ color: "#6b7280", padding: "16px" }}>No stats available yet.</p>
          )}

          <h3 style={{ marginTop: "24px", marginBottom: "16px" }}>Knowledge Base</h3>
          <KnowledgeBaseEditor type="trading_strategy" entityId={selectedStrategy.id} />
        </section>
      )}
    </div>
  );
}
