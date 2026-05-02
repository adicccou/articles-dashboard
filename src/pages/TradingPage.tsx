import { useEffect, useState } from "react";
import type { TradingStrategy, TradingStats } from "../lib/types";
import { api } from "../lib/api";
import { TradingStrategyForm } from "../components/TradingStrategyForm";
import { APIConnectionPanel } from "../components/APIConnectionPanel";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";

type TabView = "strategies" | "form" | "connections";

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
      setStrategies(data);
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

  async function handleSelectStrategy(strategy: TradingStrategy) {
    setSelectedStrategy(strategy);
    try {
      const statsData = await api.getTradingStats(strategy.id);
      setStats(statsData);
    } catch {
      setStats(null);
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
            strategy={strategies.find((s) => s.id === editingId)}
            onSubmit={async (data) => {
              if (editingId) {
                await api.updateTradingStrategy(editingId, data);
              } else {
                await api.createTradingStrategy(
                  data as Omit<TradingStrategy, "id" | "status" | "created_at" | "updated_at">
                );
              }
              await load();
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

  if (tab === "connections") {
    return (
      <div className="stack">
        <button onClick={() => setTab("strategies")} className="button-secondary">
          ← Back to Strategies
        </button>
        <div className="panel">
          <h2>Global API Connections</h2>
          <APIConnectionPanel />
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
            <button onClick={() => setTab("connections")} className="button-secondary">
              ⚙️ Connections
            </button>
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
          <div className="table">
            <div className="table__row table__row--header">
              <span>Name</span>
              <span>Symbol</span>
              <span>Type</span>
              <span>Status</span>
              <span>Lot Size</span>
              <span>Actions</span>
            </div>
            {strategies.map((strategy) => (
              <div className="table__row" key={strategy.id}>
                <span className="truncate">{strategy.name}</span>
                <span>{strategy.symbol}</span>
                <span>{strategy.strategy_type}</span>
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
                <span>{strategy.lot_size}</span>
                <span>
                  <button
                    onClick={() => handleSelectStrategy(strategy)}
                    style={{
                      fontSize: "12px",
                      padding: "4px 8px",
                      marginRight: "4px",
                      background: "none",
                      border: "1px solid #e5e7eb",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(strategy.id);
                      setTab("form");
                    }}
                    style={{
                      fontSize: "12px",
                      padding: "4px 8px",
                      marginRight: "4px",
                      background: "none",
                      border: "1px solid #e5e7eb",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      await api.deleteTradingStrategy(strategy.id);
                      if (selectedStrategy?.id === strategy.id) {
                        setSelectedStrategy(null);
                        setStats(null);
                      }
                      await load();
                    }}
                    style={{
                      fontSize: "12px",
                      padding: "4px 8px",
                      background: "none",
                      border: "1px solid #fecaca",
                      color: "#dc2626",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
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
            <button
              onClick={() => { setSelectedStrategy(null); setStats(null); }}
              className="button-secondary"
            >
              Close
            </button>
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
