import { useEffect, useMemo, useState } from "react";
import type { CustomLeanAssetWorkers, CustomLeanWorker } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";

function formatR(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function formatUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function WorkerRow({ worker }: { worker: CustomLeanWorker }) {
  const pnlPositive = worker.stats.pnl_r >= 0;
  const todayPositive = worker.stats.today_pnl_usd >= 0;

  return (
    <div className="custom-lean-worker">
      <div className="custom-lean-worker__main">
        <div>
          <strong>{worker.name}</strong>
          <span>{worker.role}</span>
        </div>
        <p>{worker.description}</p>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Total trades</span>
        <strong>{worker.stats.total_trades}</strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Trades today</span>
        <strong>{worker.stats.today_trades}</strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>PnL</span>
        <strong className={pnlPositive ? "custom-lean-good" : "custom-lean-risk"}>
          {formatR(worker.stats.pnl_r)}
        </strong>
        <small>{formatUsd(worker.stats.pnl_usd_at_20_risk)} realized</small>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Today PnL</span>
        <strong className={todayPositive ? "custom-lean-good" : "custom-lean-risk"}>
          {formatUsd(worker.stats.today_pnl_usd)}
        </strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Avg win RR</span>
        <strong>{worker.stats.avg_win_rr.toFixed(2)}R</strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Avg loss RR</span>
        <strong>{worker.stats.avg_loss_rr.toFixed(2)}R</strong>
      </div>
    </div>
  );
}

export function TradingPage() {
  const [assets, setAssets] = useState<CustomLeanAssetWorkers[]>([]);
  const [selectedAsset, setSelectedAsset] = useState("US500");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const data = await api.getCustomLeanWorkers();
      const normalized = asArray<CustomLeanAssetWorkers>(data);
      setAssets(normalized);
      if (normalized[0]?.asset) {
        setSelectedAsset((current) => current || normalized[0].asset);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Custom-Lean workers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const activeAsset = useMemo(
    () => assets.find((asset) => asset.asset === selectedAsset) ?? assets[0],
    [assets, selectedAsset],
  );

  const totals = useMemo(() => {
    const workers = activeAsset?.workers ?? [];
    return workers.reduce(
      (acc, worker) => ({
        totalTrades: acc.totalTrades + worker.stats.total_trades,
        todayTrades: acc.todayTrades + worker.stats.today_trades,
        pnlR: acc.pnlR + worker.stats.pnl_r,
        pnlUsd: acc.pnlUsd + worker.stats.pnl_usd_at_20_risk,
        todayPnl: acc.todayPnl + worker.stats.today_pnl_usd,
      }),
      { totalTrades: 0, todayTrades: 0, pnlR: 0, pnlUsd: 0, todayPnl: 0 },
    );
  }, [activeAsset]);

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <div className="stack">
      {error && <p className="error panel">{error}</p>}

      <section className="panel custom-lean-hero">
        <div>
          <span className="custom-lean-eyebrow">Custom-Lean coordinator</span>
          <h2>Asset Workers</h2>
          <p>
            Trading Strategies is hidden for now. This screen shows the worker model that will run
            independently per asset, with each worker keeping its own stats.
          </p>
        </div>
        <button className="button-secondary" onClick={() => void load()}>
          Refresh
        </button>
      </section>

      <section className="panel custom-lean-assets">
        <div className="custom-lean-assets__tabs">
          {assets.map((asset) => (
            <button
              key={asset.asset}
              className={asset.asset === activeAsset?.asset ? "custom-lean-assets__tab custom-lean-assets__tab--active" : "custom-lean-assets__tab"}
              onClick={() => setSelectedAsset(asset.asset)}
            >
              {asset.display_name}
            </button>
          ))}
        </div>

        {activeAsset ? (
          <>
            <div className="custom-lean-summary">
              <div>
                <span>Coordinator</span>
                <strong>{activeAsset.coordinator.mode.toUpperCase()}</strong>
              </div>
              <div>
                <span>Total trades</span>
                <strong>{totals.totalTrades}</strong>
              </div>
              <div>
                <span>Trades today</span>
                <strong>{totals.todayTrades}</strong>
              </div>
              <div>
                <span>Total PnL</span>
                <strong className={totals.pnlUsd >= 0 ? "custom-lean-good" : "custom-lean-risk"}>
                  {formatUsd(totals.pnlUsd)}
                </strong>
                <small>{formatR(totals.pnlR)}</small>
              </div>
              <div>
                <span>Today PnL</span>
                <strong className={totals.todayPnl >= 0 ? "custom-lean-good" : "custom-lean-risk"}>
                  {formatUsd(totals.todayPnl)}
                </strong>
              </div>
            </div>

            <div className="custom-lean-workers">
              <div className="custom-lean-workers__header">
                <span>Worker</span>
                <span>Total trades</span>
                <span>Today</span>
                <span>PnL</span>
                <span>Today PnL</span>
                <span>Avg win RR</span>
                <span>Avg loss RR</span>
              </div>
              {activeAsset.workers.map((worker) => (
                <WorkerRow key={worker.id} worker={worker} />
              ))}
            </div>

            <div className="custom-lean-playbooks">
              {activeAsset.workers.map((worker) => (
                <article key={worker.id}>
                  <span>{formatPercent(worker.stats.win_rate)} win rate</span>
                  <h3>{worker.name}</h3>
                  <p>{worker.playbook}</p>
                  <small>{worker.stats.period} / {worker.stats.trades_per_day.toFixed(2)} trades per day</small>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="custom-lean-empty">No Custom-Lean assets configured yet.</p>
        )}
      </section>
    </div>
  );
}
