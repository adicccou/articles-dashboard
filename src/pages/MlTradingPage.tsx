import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CustomLeanSettings, MlTradingAsset, MlTradingDiagnostics, MlTradingSettings } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { RuntimeDiagnosticsPanel } from "../components/trading/RuntimeDiagnosticsPanel";
import { RuntimeSummaryCards } from "../components/trading/RuntimeSummaryCards";
import { ExecutionControlsModal } from "../components/trading/ExecutionControlsModal";

function formatUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function MlAssetRow({
  asset,
  saving,
  onEdit,
}: {
  asset: MlTradingAsset;
  saving: boolean;
  onEdit: (asset: MlTradingAsset) => void;
}) {
  const todayTrades = Number.isFinite(asset.stats.today_trades) ? asset.stats.today_trades : 0;

  return (
    <div className="custom-lean-worker">
      <div className="custom-lean-worker__main">
        <div>
          <strong>{asset.asset}</strong>
          <span>{asset.display_name}</span>
        </div>
        <p>{asset.notes}</p>
        {asset.runtime ? (
          <small className={`custom-lean-worker__runtime custom-lean-worker__runtime--${asset.runtime.blockers?.[0]?.level || "ok"}`}>
            {asset.runtime.status}: {asset.runtime.reason || "waiting for next decision"}
          </small>
        ) : null}
      </div>
      <div className="custom-lean-worker__metric">
        <span>Total PnL</span>
        <strong className={asset.stats.total_pnl_usd >= 0 ? "custom-lean-good" : "custom-lean-risk"}>
          {formatUsd(asset.stats.total_pnl_usd)}
        </strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Today PnL</span>
        <strong className={asset.stats.today_pnl_usd >= 0 ? "custom-lean-good" : "custom-lean-risk"}>
          {formatUsd(asset.stats.today_pnl_usd)}
        </strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Trades today</span>
        <strong>{todayTrades}</strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Loss trades</span>
        <strong>{asset.stats.total_loss_trades}</strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Win trades</span>
        <strong>{asset.stats.total_win_trades}</strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Avg win RR</span>
        <strong>{asset.stats.avg_win_rr.toFixed(2)}R</strong>
      </div>
      <div className="custom-lean-worker__metric">
        <span>Avg loss RR</span>
        <strong>{asset.stats.avg_loss_rr.toFixed(2)}R</strong>
      </div>
      <div className="custom-lean-worker__metric custom-lean-worker__metric--toggle">
        <span>Actions</span>
        <div className="custom-lean-worker__actions">
          <button
            type="button"
            className="button-secondary custom-lean-worker__edit"
            onClick={() => onEdit(asset)}
            disabled={saving}
          >
            Edit
          </button>
        </div>
        <small>{asset.enabled ? "Enabled" : "Disabled"}</small>
      </div>
    </div>
  );
}

const DEFAULT_ML_SETTINGS: MlTradingSettings = {
  active: false,
  risk_usd_min: 8,
  risk_usd_max: 17,
  execution_mode: "demo",
  demo_account_id: "",
  selected_account_id: "",
  enabled_assets: ["XAUUSD", "US500"],
  asset_risk_overrides: {},
  asset_confidence_overrides: {},
};

const DEFAULT_CUSTOM_LEAN_SETTINGS: CustomLeanSettings = {
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

export function MlTradingPage() {
  const [mlAssets, setMlAssets] = useState<MlTradingAsset[]>([]);
  const [diagnostics, setDiagnostics] = useState<MlTradingDiagnostics | null>(null);
  const [mlSettings, setMlSettings] = useState<MlTradingSettings>(DEFAULT_ML_SETTINGS);
  const [mlSettingsDraft, setMlSettingsDraft] = useState<MlTradingSettings>(DEFAULT_ML_SETTINGS);
  const [customLeanSettings, setCustomLeanSettings] = useState<CustomLeanSettings>(DEFAULT_CUSTOM_LEAN_SETTINGS);
  const [customLeanSettingsDraft, setCustomLeanSettingsDraft] = useState<CustomLeanSettings>(DEFAULT_CUSTOM_LEAN_SETTINGS);
  const [mlSettingsOpen, setMlSettingsOpen] = useState(false);
  const [savingMlSettings, setSavingMlSettings] = useState(false);
  const [savingMlAsset, setSavingMlAsset] = useState<string | null>(null);
  const [editingMlAssetId, setEditingMlAssetId] = useState<string | null>(null);
  const [mlSettingsMessage, setMlSettingsMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [mlAssetData, mlGeneralSettings, workerGeneralSettings, diagnosticsData] = await Promise.all([
        api.getMlTradingAssets(),
        api.getMlTradingSettings(),
        api.getCustomLeanSettings(),
        api.getMlTradingDiagnostics().catch(() => null),
      ]);
      setMlAssets(asArray<MlTradingAsset>(mlAssetData.assets));
      setDiagnostics(diagnosticsData);
      setMlSettings(mlGeneralSettings);
      setMlSettingsDraft(mlGeneralSettings);
      setCustomLeanSettings(workerGeneralSettings);
      setCustomLeanSettingsDraft(workerGeneralSettings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ML trading dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveMlSettings(nextSettings = mlSettingsDraft) {
    try {
      setSavingMlSettings(true);
      setMlSettingsMessage(null);
      const saved = await api.updateMlTradingSettings({
        active: nextSettings.active,
        enabled_assets: nextSettings.enabled_assets,
        asset_risk_overrides: nextSettings.asset_risk_overrides,
        asset_confidence_overrides: nextSettings.asset_confidence_overrides,
      });
      setMlSettings(saved);
      setMlSettingsDraft(saved);
      setMlSettingsMessage(saved.sync_result?.message || "ML Trading settings saved.");
      const refreshedAssets = await api.getMlTradingAssets();
      setMlAssets(asArray<MlTradingAsset>(refreshedAssets.assets));
      const refreshedDiagnostics = await api.getMlTradingDiagnostics().catch(() => null);
      setDiagnostics(refreshedDiagnostics);
    } catch (err) {
      setMlSettingsMessage(err instanceof Error ? err.message : "Failed to save ML Trading settings.");
    } finally {
      setSavingMlSettings(false);
    }
  }

  async function saveCustomLeanSettings(nextSettings = customLeanSettingsDraft) {
    try {
      setSavingMlSettings(true);
      setMlSettingsMessage(null);
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
      setCustomLeanSettings(saved);
      setCustomLeanSettingsDraft(saved);
      setMlSettingsMessage(saved.sync_result?.message || "Worker-backed ML settings saved.");
      const [refreshedAssets, refreshedDiagnostics] = await Promise.all([
        api.getMlTradingAssets(),
        api.getMlTradingDiagnostics().catch(() => null),
      ]);
      setMlAssets(asArray<MlTradingAsset>(refreshedAssets.assets));
      setDiagnostics(refreshedDiagnostics);
    } catch (err) {
      setMlSettingsMessage(err instanceof Error ? err.message : "Failed to save worker-backed ML settings.");
    } finally {
      setSavingMlSettings(false);
    }
  }

  function submitMlSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveMlSettings();
  }

  function updateMlSettingsDraft(patch: Partial<MlTradingSettings>) {
    setMlSettingsDraft((current) => ({ ...current, ...patch }));
  }

  function isWorkerBackedAsset(asset: MlTradingAsset) {
    return asset.control_family === "worker" && Boolean(asset.control_key);
  }

  function assetRiskDraft(asset: MlTradingAsset) {
    if (isWorkerBackedAsset(asset) && asset.control_key) {
      return customLeanSettingsDraft.worker_risk_overrides[asset.control_key] || {
        risk_usd_min: Number(asset.risk_usd_min ?? customLeanSettings.risk_usd_min),
        risk_usd_max: Number(asset.risk_usd_max ?? customLeanSettings.risk_usd_max),
      };
    }
    return mlSettingsDraft.asset_risk_overrides[asset.asset] || {
      risk_usd_min: Number(asset.risk_usd_min ?? mlSettings.risk_usd_min),
      risk_usd_max: Number(asset.risk_usd_max ?? mlSettings.risk_usd_max),
    };
  }

  function assetConfidenceDraft(asset: MlTradingAsset) {
    if (isWorkerBackedAsset(asset) && asset.control_key) {
      return customLeanSettingsDraft.worker_confidence_overrides[asset.control_key] || {
        min_confidence: Number(asset.confidence_threshold ?? 60),
      };
    }
    return mlSettingsDraft.asset_confidence_overrides[asset.asset] || {
      min_confidence: Number(asset.confidence_threshold ?? 60),
    };
  }

  function updateAssetRiskDraft(asset: MlTradingAsset, patch: Partial<{ risk_usd_min: number; risk_usd_max: number }>) {
    const currentRisk = assetRiskDraft(asset);
    if (isWorkerBackedAsset(asset) && asset.control_key) {
      setCustomLeanSettingsDraft((current) => ({
        ...current,
        worker_risk_overrides: {
          ...current.worker_risk_overrides,
          [asset.control_key!]: {
            ...currentRisk,
            ...patch,
          },
        },
      }));
      return;
    }
    setMlSettingsDraft((current) => ({
      ...current,
      asset_risk_overrides: {
        ...current.asset_risk_overrides,
        [asset.asset]: {
          ...currentRisk,
          ...patch,
        },
      },
    }));
  }

  function updateAssetConfidenceDraft(asset: MlTradingAsset, patch: Partial<{ min_confidence: number }>) {
    const currentConfidence = assetConfidenceDraft(asset);
    if (isWorkerBackedAsset(asset) && asset.control_key) {
      setCustomLeanSettingsDraft((current) => ({
        ...current,
        worker_confidence_overrides: {
          ...current.worker_confidence_overrides,
          [asset.control_key!]: {
            ...currentConfidence,
            ...patch,
          },
        },
      }));
      return;
    }
    setMlSettingsDraft((current) => ({
      ...current,
      asset_confidence_overrides: {
        ...current.asset_confidence_overrides,
        [asset.asset]: {
          ...currentConfidence,
          ...patch,
        },
      },
    }));
  }

  async function saveAssetRisk(asset: MlTradingAsset) {
    if (isWorkerBackedAsset(asset) && asset.control_key) {
      const nextSettings = {
        ...customLeanSettingsDraft,
        worker_risk_overrides: {
          ...customLeanSettingsDraft.worker_risk_overrides,
          [asset.control_key]: assetRiskDraft(asset),
        },
        worker_confidence_overrides: {
          ...customLeanSettingsDraft.worker_confidence_overrides,
          [asset.control_key]: assetConfidenceDraft(asset),
        },
        disabled_worker_ids: customLeanSettingsDraft.disabled_worker_ids.filter((id) => id !== asset.control_key),
        deleted_worker_ids: customLeanSettingsDraft.deleted_worker_ids.filter((id) => id !== asset.control_key),
      };
      setCustomLeanSettingsDraft(nextSettings);
      setSavingMlAsset(asset.control_key);
      try {
        await saveCustomLeanSettings(nextSettings);
      } finally {
        setSavingMlAsset(null);
      }
      return;
    }
    const nextSettings = {
      ...mlSettingsDraft,
      asset_risk_overrides: {
        ...mlSettingsDraft.asset_risk_overrides,
        [asset.asset]: assetRiskDraft(asset),
      },
      asset_confidence_overrides: {
        ...mlSettingsDraft.asset_confidence_overrides,
        [asset.asset]: assetConfidenceDraft(asset),
      },
    };
    setMlSettingsDraft(nextSettings);
    setSavingMlAsset(asset.asset);
    try {
      await saveMlSettings(nextSettings);
    } finally {
      setSavingMlAsset(null);
    }
  }

  const aggregateMlStats = mlAssets.reduce(
    (acc, asset) => ({
      totalPnlUsd: acc.totalPnlUsd + (Number.isFinite(asset.stats.total_pnl_usd) ? asset.stats.total_pnl_usd : 0),
      todayPnlUsd: acc.todayPnlUsd + (Number.isFinite(asset.stats.today_pnl_usd) ? asset.stats.today_pnl_usd : 0),
      todayTrades: acc.todayTrades + (Number.isFinite(asset.stats.today_trades) ? asset.stats.today_trades : 0),
    }),
    { totalPnlUsd: 0, todayPnlUsd: 0, todayTrades: 0 },
  );

  const editingMlAsset = mlAssets.find((asset) => (asset.control_key || asset.asset) === editingMlAssetId) ?? null;

  const summaryCards = [
    {
      label: "Coordinator",
      value: mlSettings.active ? "DEMO ACTIVE" : "INACTIVE",
      detail: null as string | null,
      tone: null as string | null,
    },
    {
      label: "Execution",
      value: "DEMO",
      detail: mlSettings.demo_account_id || mlSettings.selected_account_id || "account not set",
      tone: null as string | null,
    },
    {
      label: "Total PnL",
      value: formatUsd(aggregateMlStats.totalPnlUsd),
      detail: "All ML assets",
      tone: aggregateMlStats.totalPnlUsd >= 0 ? "custom-lean-good" : "custom-lean-risk",
    },
    {
      label: "Today PnL",
      value: formatUsd(aggregateMlStats.todayPnlUsd),
      detail: "All ML assets",
      tone: aggregateMlStats.todayPnlUsd >= 0 ? "custom-lean-good" : "custom-lean-risk",
    },
    {
      label: "Trades Today",
      value: aggregateMlStats.todayTrades,
      detail: "All ML assets",
      tone: null as string | null,
    },
    {
      label: "Diagnostics",
      value: diagnostics?.blockers?.length ? "ATTENTION" : "LIVE",
      detail: diagnostics?.updated_at ? diagnostics.updated_at : "unknown",
      tone: diagnostics?.blockers?.length ? "custom-lean-warn" : "custom-lean-good",
    },
    {
      label: "Assets",
      value: mlAssets.length,
      detail: `${mlAssets.filter((asset) => asset.enabled).length} enabled`,
      tone: null as string | null,
    },
  ];

  function toggleMlActive() {
    const nextSettings = { ...mlSettingsDraft, active: !mlSettingsDraft.active };
    setMlSettingsDraft(nextSettings);
    void saveMlSettings(nextSettings);
  }

  async function toggleMlAsset(asset: MlTradingAsset) {
    if (isWorkerBackedAsset(asset) && asset.control_key) {
      const disabledWorkerIds = new Set(customLeanSettingsDraft.disabled_worker_ids);
      const deletedWorkerIds = new Set(customLeanSettingsDraft.deleted_worker_ids);
      if (disabledWorkerIds.has(asset.control_key)) {
        disabledWorkerIds.delete(asset.control_key);
        deletedWorkerIds.delete(asset.control_key);
      } else {
        disabledWorkerIds.add(asset.control_key);
      }
      const nextSettings = {
        ...customLeanSettingsDraft,
        disabled_worker_ids: Array.from(disabledWorkerIds),
        deleted_worker_ids: Array.from(deletedWorkerIds),
      };
      setCustomLeanSettingsDraft(nextSettings);
      setSavingMlAsset(asset.control_key);
      try {
        await saveCustomLeanSettings(nextSettings);
      } finally {
        setSavingMlAsset(null);
      }
      return;
    }
    const enabledAssets = new Set(mlSettingsDraft.enabled_assets);
    if (enabledAssets.has(asset.asset)) {
      enabledAssets.delete(asset.asset);
    } else {
      enabledAssets.add(asset.asset);
    }
    const nextSettings = {
      ...mlSettingsDraft,
      enabled_assets: Array.from(enabledAssets),
    };
    setMlSettingsDraft(nextSettings);
    setSavingMlAsset(asset.asset);
    try {
      await saveMlSettings(nextSettings);
    } finally {
      setSavingMlAsset(null);
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <div className="stack">
      {error && <p className="error panel">{error}</p>}

      <section className="panel custom-lean-hero">
        <div>
          <span className="custom-lean-eyebrow">Separate ML runtime</span>
          <h2>ML Trading</h2>
          <p>
            Dedicated ML execution stack with its own controls, asset enablement, and demo-account routing,
            while still reusing Nautilus execution, Telegram, and the DO runtime.
          </p>
        </div>
        <button className="button-secondary" onClick={() => setMlSettingsOpen((value) => !value)}>
          ML settings
        </button>
      </section>

      {mlSettingsOpen ? (
        <section className="panel custom-lean-settings">
          <div className="custom-lean-settings__title">
            <div>
              <span className={mlSettings.active ? "custom-lean-settings__status custom-lean-settings__status--active" : "custom-lean-settings__status"}>
                {mlSettings.active ? "Active" : "Inactive"}
              </span>
              <h3>ML Trading Settings</h3>
            </div>
            <button
              className={mlSettingsDraft.active ? "button-secondary custom-lean-deactivate" : "button-secondary custom-lean-activate"}
              type="button"
              onClick={toggleMlActive}
              disabled={savingMlSettings}
            >
              {mlSettingsDraft.active ? "Deactivate" : "Activate"}
            </button>
          </div>

          <form className="custom-lean-settings__form" onSubmit={submitMlSettings}>
            <div className="custom-lean-account">
              <span>Account</span>
              <div className="custom-lean-account__toggle">
                <button
                  type="button"
                  className="custom-lean-account__button custom-lean-account__button--active"
                  disabled
                >
                  Demo only
                </button>
                <button
                  type="button"
                  className="custom-lean-account__button"
                  disabled
                >
                  Live disabled
                </button>
              </div>
              <small>
                Selected account: {mlSettingsDraft.demo_account_id || mlSettingsDraft.selected_account_id || "not set"}
              </small>
            </div>

            <p className="custom-lean-settings__message">
              ML risk and confidence are now managed per asset row below. The old shared values remain only as a fallback.
            </p>

            <button className="button-secondary custom-lean-save" type="submit" disabled={savingMlSettings}>
              {savingMlSettings ? "Saving..." : "Save settings"}
            </button>
          </form>

          {mlSettingsMessage ? <p className="custom-lean-settings__message">{mlSettingsMessage}</p> : null}
        </section>
      ) : null}

      <RuntimeDiagnosticsPanel
        title="ML Runtime"
        summary={diagnostics}
        extra={diagnostics ? (
          <div>
            <span>Tracked assets</span>
            <strong>{diagnostics.asset_count}</strong>
          </div>
        ) : null}
      />

      <section className="panel custom-lean-assets">
        <RuntimeSummaryCards cards={summaryCards} />

        <div className="custom-lean-workers custom-lean-workers--ml-assets">
          <div className="custom-lean-workers__header">
            <span>Asset</span>
            <span>Total PnL</span>
            <span>Today PnL</span>
            <span>Trades today</span>
            <span>Loss trades</span>
            <span>Win trades</span>
            <span>Avg win RR</span>
            <span>Avg loss RR</span>
            <span>Actions</span>
          </div>
          {mlAssets.length ? (
            mlAssets.map((asset) => (
              <MlAssetRow
                key={asset.control_key || asset.asset}
                asset={asset}
                saving={savingMlAsset === (asset.control_key || asset.asset)}
                onEdit={(selectedAsset) => setEditingMlAssetId(selectedAsset.control_key || selectedAsset.asset)}
              />
            ))
          ) : (
            <div className="custom-lean-workers__empty">No ML Trading assets configured yet.</div>
          )}
        </div>
      </section>

      <ExecutionControlsModal
        open={Boolean(editingMlAsset)}
        title={editingMlAsset?.asset || "ML Asset"}
        subtitle={editingMlAsset?.display_name || ""}
        enabledLabel="Asset"
        enabled={editingMlAsset?.enabled ?? false}
        riskDraft={editingMlAsset ? assetRiskDraft(editingMlAsset) : { risk_usd_min: mlSettings.risk_usd_min, risk_usd_max: mlSettings.risk_usd_max }}
        confidenceDraft={editingMlAsset ? assetConfidenceDraft(editingMlAsset) : { min_confidence: 60 }}
        saving={editingMlAsset ? savingMlAsset === editingMlAsset.asset : false}
        onClose={() => setEditingMlAssetId(null)}
        onToggleEnabled={() => {
          if (editingMlAsset) {
            void toggleMlAsset(editingMlAsset);
          }
        }}
        onRiskChange={(patch) => {
          if (editingMlAsset) {
            updateAssetRiskDraft(editingMlAsset, patch);
          }
        }}
        onConfidenceChange={(patch) => {
          if (editingMlAsset) {
            updateAssetConfidenceDraft(editingMlAsset, patch);
          }
        }}
        onSave={() => {
          if (editingMlAsset) {
            saveAssetRisk(editingMlAsset).then(() => setEditingMlAssetId(null));
          }
        }}
      />
    </div>
  );
}
