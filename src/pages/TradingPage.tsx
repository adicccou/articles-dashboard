import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { CustomLeanAssetWorkers, CustomLeanDiagnostics, CustomLeanSettings, CustomLeanWorker } from "../lib/types";
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

function backtestSummary(worker: CustomLeanWorker) {
  if (!worker.stats.backtest_period) {
    return null;
  }
  return `${worker.stats.backtest_period}: ${formatPercent(worker.stats.backtest_win_rate ?? 0)} win rate / ${worker.stats.backtest_total_trades ?? 0} trades`;
}

const DEFAULT_SETTINGS: CustomLeanSettings = {
  active: true,
  risk_usd_min: 8,
  risk_usd_max: 17,
  max_open_trades_per_worker: 1,
  execution_mode: "demo",
  demo_account_id: "",
  live_account_id: "",
  selected_account_id: "",
};

export function TradingPage() {
  const [assets, setAssets] = useState<CustomLeanAssetWorkers[]>([]);
  const [diagnostics, setDiagnostics] = useState<CustomLeanDiagnostics | null>(null);
  const [selectedAsset, setSelectedAsset] = useState("US500");
  const [settings, setSettings] = useState<CustomLeanSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<CustomLeanSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [data, generalSettings, diagnosticsData] = await Promise.all([
        api.getCustomLeanWorkers(),
        api.getCustomLeanSettings(),
        api.getCustomLeanDiagnostics().catch(() => null),
      ]);
      const normalized = asArray<CustomLeanAssetWorkers>(data);
      setAssets(normalized);
      setDiagnostics(diagnosticsData);
      setSettings(generalSettings);
      setSettingsDraft(generalSettings);
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

  async function saveSettings(nextSettings = settingsDraft) {
    try {
      setSavingSettings(true);
      setSettingsMessage(null);
      const saved = await api.updateCustomLeanSettings({
        active: nextSettings.active,
        risk_usd_min: Number(nextSettings.risk_usd_min),
        risk_usd_max: Number(nextSettings.risk_usd_max),
        max_open_trades_per_worker: Number(nextSettings.max_open_trades_per_worker),
        execution_mode: nextSettings.execution_mode,
      });
      setSettings(saved);
      setSettingsDraft(saved);
      setSettingsMessage(saved.sync_result?.message || "General settings saved.");
    } catch (err) {
      setSettingsMessage(err instanceof Error ? err.message : "Failed to save general settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveSettings();
  }

  function updateSettingsDraft(patch: Partial<CustomLeanSettings>) {
    setSettingsDraft((current) => ({ ...current, ...patch }));
  }

  function toggleActive() {
    const nextSettings = { ...settingsDraft, active: !settingsDraft.active };
    setSettingsDraft(nextSettings);
    void saveSettings(nextSettings);
  }

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
        <button className="button-secondary" onClick={() => setSettingsOpen((value) => !value)}>
          General settings
        </button>
      </section>

      {settingsOpen ? (
        <section className="panel custom-lean-settings">
          <div className="custom-lean-settings__title">
            <div>
              <span className={settings.active ? "custom-lean-settings__status custom-lean-settings__status--active" : "custom-lean-settings__status"}>
                {settings.active ? "Active" : "Inactive"}
              </span>
              <h3>General Settings</h3>
            </div>
            <button
              className={settingsDraft.active ? "button-secondary custom-lean-deactivate" : "button-secondary custom-lean-activate"}
              type="button"
              onClick={toggleActive}
              disabled={savingSettings}
            >
              {settingsDraft.active ? "Deactivate" : "Activate"}
            </button>
          </div>

          <form className="custom-lean-settings__form" onSubmit={submitSettings}>
            <label>
              <span>Min risk USD</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={settingsDraft.risk_usd_min}
                onChange={(event) => updateSettingsDraft({ risk_usd_min: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Max risk USD</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={settingsDraft.risk_usd_max}
                onChange={(event) => updateSettingsDraft({ risk_usd_max: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Each worker max open trades</span>
              <input
                type="number"
                min="1"
                step="1"
                value={settingsDraft.max_open_trades_per_worker}
                onChange={(event) => updateSettingsDraft({ max_open_trades_per_worker: Number(event.target.value) })}
              />
            </label>

            <div className="custom-lean-account">
              <span>Account</span>
              <div className="custom-lean-account__toggle">
                <button
                  type="button"
                  className={settingsDraft.execution_mode === "demo" ? "custom-lean-account__button custom-lean-account__button--active" : "custom-lean-account__button"}
                  onClick={() => updateSettingsDraft({ execution_mode: "demo" })}
                >
                  Demo
                </button>
                <button
                  type="button"
                  className={settingsDraft.execution_mode === "live" ? "custom-lean-account__button custom-lean-account__button--active" : "custom-lean-account__button"}
                  onClick={() => updateSettingsDraft({ execution_mode: "live" })}
                >
                  Live
                </button>
              </div>
              <small>
                Selected account: {settingsDraft.execution_mode === "live"
                  ? settingsDraft.live_account_id || settingsDraft.selected_account_id || "not set"
                  : settingsDraft.demo_account_id || settingsDraft.selected_account_id || "not set"}
              </small>
            </div>

            <button className="button-secondary custom-lean-save" type="submit" disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save settings"}
            </button>
          </form>

          {settingsMessage ? <p className="custom-lean-settings__message">{settingsMessage}</p> : null}
        </section>
      ) : null}

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
                <span>Diagnostics</span>
                <strong className={diagnostics?.diagnostics_stale ? "custom-lean-risk" : "custom-lean-good"}>
                  {diagnostics?.diagnostics_stale ? "STALE" : "LIVE"}
                </strong>
                <small>{diagnostics?.diagnostics_age_seconds ?? 0}s ago</small>
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
                  <span>Live {formatPercent(worker.stats.win_rate)} win rate</span>
                  <h3>{worker.name}</h3>
                  <p>{worker.playbook}</p>
                  <small>{worker.stats.period} / {worker.stats.trades_per_day.toFixed(2)} trades per day</small>
                  {backtestSummary(worker) && <small>{backtestSummary(worker)}</small>}
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
