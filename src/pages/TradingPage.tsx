import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PencilSquareIcon, TrashIcon } from "@heroicons/react/24/solid";
import type { CustomLeanAssetWorkers, CustomLeanDiagnostics, CustomLeanSettings, CustomLeanWorker } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { RuntimeDiagnosticsPanel } from "../components/trading/RuntimeDiagnosticsPanel";
import { RuntimeSummaryCards } from "../components/trading/RuntimeSummaryCards";
import { ExecutionControlsModal } from "../components/trading/ExecutionControlsModal";

function formatR(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function formatUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function WorkerRow({
  worker,
  assetLabel,
  saving,
  onEdit,
  onDelete,
}: {
  worker: CustomLeanWorker;
  assetLabel: string;
  saving: boolean;
  onEdit: (worker: CustomLeanWorker) => void;
  onDelete: (worker: CustomLeanWorker) => void;
}) {
  const pnlPositive = worker.stats.pnl_r >= 0;
  const todayPositive = worker.stats.today_pnl_usd >= 0;
  const enabled = worker.enabled !== false;

  return (
    <div className="custom-lean-worker">
      <div className="custom-lean-worker__main">
        <div>
          <strong>{worker.name}</strong>
          <span>{assetLabel} · {worker.role}</span>
        </div>
        <p>{worker.description}</p>
        {worker.runtime ? (
          <small className={`custom-lean-worker__runtime custom-lean-worker__runtime--${worker.runtime.blockers?.[0]?.level || "ok"}`}>
            {worker.runtime.status}: {worker.runtime.reason || "waiting for next decision"}
          </small>
        ) : null}
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
        <span>Total PnL</span>
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
      <div className="custom-lean-worker__metric custom-lean-worker__metric--toggle">
        <span>Actions</span>
        <div className="custom-lean-worker__actions">
          <button
            type="button"
            className="button-secondary custom-lean-worker__edit dashboard-icon-button"
            onClick={() => onEdit(worker)}
            disabled={saving}
            aria-label={`Edit ${worker.name}`}
            title={`Edit ${worker.name}`}
          >
            <PencilSquareIcon aria-hidden="true" />
          </button>
          <button
            type="button"
            className="custom-lean-worker__delete"
            onClick={() => onDelete(worker)}
            disabled={saving}
            aria-label={`Delete ${worker.name}`}
            title={`Delete ${worker.name}`}
          >
            <TrashIcon aria-hidden="true" />
          </button>
        </div>
        <small>{enabled ? "Enabled" : "Disabled"}</small>
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
  disabled_worker_ids: [],
  deleted_worker_ids: [],
  worker_risk_overrides: {},
  worker_confidence_overrides: {},
  execution_mode: "demo",
  demo_account_id: "",
  live_account_id: "",
  selected_account_id: "",
};

export function TradingPage() {
  const [assets, setAssets] = useState<CustomLeanAssetWorkers[]>([]);
  const [diagnostics, setDiagnostics] = useState<CustomLeanDiagnostics | null>(null);
  const [settings, setSettings] = useState<CustomLeanSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<CustomLeanSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingWorkerId, setSavingWorkerId] = useState<string | null>(null);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
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
      const normalized = asArray<CustomLeanAssetWorkers>(data.assets);
      setAssets(normalized);
      setDiagnostics(diagnosticsData);
      setSettings(generalSettings);
      setSettingsDraft(generalSettings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trading dashboards");
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
        disabled_worker_ids: nextSettings.disabled_worker_ids,
        deleted_worker_ids: nextSettings.deleted_worker_ids,
        worker_risk_overrides: nextSettings.worker_risk_overrides,
        worker_confidence_overrides: nextSettings.worker_confidence_overrides,
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

  function workerRiskDraft(worker: CustomLeanWorker) {
    return settingsDraft.worker_risk_overrides[worker.id] || {
      risk_usd_min: Number(worker.risk_usd_min ?? settings.risk_usd_min),
      risk_usd_max: Number(worker.risk_usd_max ?? settings.risk_usd_max),
    };
  }

  function workerConfidenceDraft(worker: CustomLeanWorker) {
    return settingsDraft.worker_confidence_overrides[worker.id] || {
      min_confidence: Number(worker.confidence_threshold ?? 85),
    };
  }

  function updateWorkerRiskDraft(worker: CustomLeanWorker, patch: Partial<{ risk_usd_min: number; risk_usd_max: number }>) {
    const currentRisk = workerRiskDraft(worker);
    setSettingsDraft((current) => ({
      ...current,
      worker_risk_overrides: {
        ...current.worker_risk_overrides,
        [worker.id]: {
          ...currentRisk,
          ...patch,
        },
      },
    }));
  }

  function updateWorkerConfidenceDraft(worker: CustomLeanWorker, patch: Partial<{ min_confidence: number }>) {
    const currentConfidence = workerConfidenceDraft(worker);
    setSettingsDraft((current) => ({
      ...current,
      worker_confidence_overrides: {
        ...current.worker_confidence_overrides,
        [worker.id]: {
          ...currentConfidence,
          ...patch,
        },
      },
    }));
  }

  async function saveWorkerRisk(worker: CustomLeanWorker) {
    const nextSettings = {
      ...settingsDraft,
      worker_risk_overrides: {
        ...settingsDraft.worker_risk_overrides,
        [worker.id]: workerRiskDraft(worker),
      },
      worker_confidence_overrides: {
        ...settingsDraft.worker_confidence_overrides,
        [worker.id]: workerConfidenceDraft(worker),
      },
    };
    setSettingsDraft(nextSettings);
    setSavingWorkerId(worker.id);
    try {
      await saveSettings(nextSettings);
      await load();
    } finally {
      setSavingWorkerId(null);
    }
  }

  async function toggleWorker(worker: CustomLeanWorker) {
    const disabled = new Set(settingsDraft.disabled_worker_ids);
    if (disabled.has(worker.id)) {
      disabled.delete(worker.id);
    } else {
      disabled.add(worker.id);
    }
    const nextSettings = {
      ...settingsDraft,
      disabled_worker_ids: Array.from(disabled),
    };
    setSettingsDraft(nextSettings);
    setSavingWorkerId(worker.id);
    try {
      await saveSettings(nextSettings);
      await load();
    } finally {
      setSavingWorkerId(null);
    }
  }

  async function deleteWorker(worker: CustomLeanWorker) {
    const confirmed = window.confirm(`Delete ${worker.name}?\n\nThis will hide the worker from the dashboard and disable it from trading.`);
    if (!confirmed) {
      return;
    }
    const disabled = new Set(settingsDraft.disabled_worker_ids);
    const deleted = new Set(settingsDraft.deleted_worker_ids);
    disabled.add(worker.id);
    deleted.add(worker.id);
    const nextSettings = {
      ...settingsDraft,
      disabled_worker_ids: Array.from(disabled),
      deleted_worker_ids: Array.from(deleted),
    };
    setSettingsDraft(nextSettings);
    setSavingWorkerId(worker.id);
    try {
      await saveSettings(nextSettings);
      await load();
    } finally {
      setSavingWorkerId(null);
    }
  }

  const visibleWorkers = useMemo(() => {
    const deleted = new Set(settingsDraft.deleted_worker_ids);
    return assets.flatMap((asset) =>
      asset.workers
        .filter((worker) => !deleted.has(worker.id))
        .map((worker) => ({
          ...worker,
          displayAsset: asset.display_name,
        })),
    );
  }, [assets, settingsDraft.deleted_worker_ids]);

  const editingWorker = useMemo(
    () => visibleWorkers.find((worker) => worker.id === editingWorkerId) ?? null,
    [editingWorkerId, visibleWorkers],
  );

  const totals = useMemo(() => {
    const workers = visibleWorkers;
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
  }, [visibleWorkers]);

  const coordinatorMode = useMemo(() => {
    if (!assets.length) {
      return "N/A";
    }
    const uniqueModes = new Set(assets.map((asset) => asset.coordinator.mode.toUpperCase()));
    return uniqueModes.size === 1 ? Array.from(uniqueModes)[0] : "MIXED";
  }, [assets]);

  const summaryCards = [
    {
      label: "Coordinator",
      value: coordinatorMode,
      detail: diagnostics?.mode || "emit",
      tone: null as string | null,
    },
    {
      label: "Diagnostics",
      value: diagnostics?.diagnostics_stale ? "STALE" : "LIVE",
      detail: diagnostics ? `${diagnostics.diagnostics_age_seconds ?? 0}s ago` : "unknown",
      tone: diagnostics?.diagnostics_stale ? "custom-lean-risk" : "custom-lean-good",
    },
    {
      label: "Total trades",
      value: totals.totalTrades,
      detail: `${visibleWorkers.length} visible workers`,
      tone: null as string | null,
    },
    {
      label: "Trades today",
      value: totals.todayTrades,
      detail: "All regular workers",
      tone: null as string | null,
    },
    {
      label: "Total PnL",
      value: formatUsd(totals.pnlUsd),
      detail: formatR(totals.pnlR),
      tone: totals.pnlUsd >= 0 ? "custom-lean-good" : "custom-lean-risk",
    },
    {
      label: "Today PnL",
      value: formatUsd(totals.todayPnl),
      detail: "All regular workers",
      tone: totals.todayPnl >= 0 ? "custom-lean-good" : "custom-lean-risk",
    },
  ];

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <div className="stack">
      {error && <p className="error panel">{error}</p>}

      <section className="panel custom-lean-hero">
        <div>
          <span className="custom-lean-eyebrow">Nautilus coordinator</span>
          <h2>All Workers</h2>
          <p>
            Trading Strategies is hidden for now. This screen shows all regular workers in one list,
            with each worker keeping its own stats and controls.
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

            <p className="custom-lean-settings__message">
              Worker risk and confidence are now managed per worker row below. The old shared values remain only as a fallback.
            </p>

            <button className="button-secondary custom-lean-save" type="submit" disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save settings"}
            </button>
          </form>

          {settingsMessage ? <p className="custom-lean-settings__message">{settingsMessage}</p> : null}
        </section>
      ) : null}

      <RuntimeDiagnosticsPanel
        title="Worker Runtime"
        summary={diagnostics}
        extra={diagnostics ? (
          <div>
            <span>Missing runtimes</span>
            <strong>{diagnostics.missing_runnable_worker_ids.length}</strong>
          </div>
        ) : null}
      />

      <section className="panel custom-lean-assets">
        {assets.length ? (
          <>
            <RuntimeSummaryCards cards={summaryCards} />

            <div className="custom-lean-workers">
              <div className="custom-lean-workers__header">
                <span>Worker</span>
                <span>Total trades</span>
                <span>Today</span>
                <span>Total PnL</span>
                <span>Today PnL</span>
                <span>Avg win RR</span>
                <span>Avg loss RR</span>
                <span>Actions</span>
              </div>
              {visibleWorkers.length ? (
                visibleWorkers.map((worker) => (
                  <WorkerRow
                    key={worker.id}
                    worker={worker}
                    assetLabel={worker.displayAsset}
                    saving={savingWorkerId === worker.id}
                    onEdit={(selectedWorker) => setEditingWorkerId(selectedWorker.id)}
                    onDelete={deleteWorker}
                  />
                ))
              ) : (
                <div className="custom-lean-workers__empty">No visible workers for this asset.</div>
              )}
            </div>

            <div className="custom-lean-playbooks">
              {visibleWorkers.map((worker) => (
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
          <p className="custom-lean-empty">No Nautilus assets configured yet.</p>
        )}
      </section>

      <ExecutionControlsModal
        open={Boolean(editingWorker)}
        title={editingWorker?.name || "Worker"}
        subtitle={editingWorker ? `${editingWorker.displayAsset} · ${editingWorker.role}` : ""}
        enabledLabel="Worker"
        enabled={editingWorker?.enabled !== false}
        riskDraft={editingWorker ? workerRiskDraft(editingWorker) : { risk_usd_min: settings.risk_usd_min, risk_usd_max: settings.risk_usd_max }}
        confidenceDraft={editingWorker ? workerConfidenceDraft(editingWorker) : { min_confidence: 85 }}
        saving={editingWorker ? savingWorkerId === editingWorker.id : false}
        onClose={() => setEditingWorkerId(null)}
        onToggleEnabled={() => {
          if (editingWorker) {
            void toggleWorker(editingWorker);
          }
        }}
        onRiskChange={(patch) => {
          if (editingWorker) {
            updateWorkerRiskDraft(editingWorker, patch);
          }
        }}
        onConfidenceChange={(patch) => {
          if (editingWorker) {
            updateWorkerConfidenceDraft(editingWorker, patch);
          }
        }}
        onSave={() => {
          if (editingWorker) {
            saveWorkerRisk(editingWorker).then(() => setEditingWorkerId(null));
          }
        }}
        onDelete={() => {
          if (editingWorker) {
            deleteWorker(editingWorker).then(() => setEditingWorkerId(null));
          }
        }}
      />
    </div>
  );
}
