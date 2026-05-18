import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { MlTradingAsset, MlTradingSettings } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";

function formatUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function MlAssetRow({
  asset,
  saving,
  onToggle,
}: {
  asset: MlTradingAsset;
  saving: boolean;
  onToggle: (asset: MlTradingAsset) => void;
}) {
  return (
    <div className="custom-lean-worker">
      <div className="custom-lean-worker__main">
        <div>
          <strong>{asset.asset}</strong>
          <span>{asset.display_name}</span>
        </div>
        <p>{asset.notes}</p>
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
        <span>Asset</span>
        <div className="custom-lean-worker__actions">
          <button
            type="button"
            className={asset.enabled ? "custom-lean-worker__toggle custom-lean-worker__toggle--on" : "custom-lean-worker__toggle"}
            aria-pressed={asset.enabled}
            onClick={() => onToggle(asset)}
            disabled={saving}
          >
            <span className="custom-lean-worker__toggle-knob" />
          </button>
        </div>
        <small>{asset.enabled ? "On" : "Off"}</small>
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
  enabled_assets: ["XAUUSD", "US500", "SOLUSD"],
};

export function MlTradingPage() {
  const [mlAssets, setMlAssets] = useState<MlTradingAsset[]>([]);
  const [mlSettings, setMlSettings] = useState<MlTradingSettings>(DEFAULT_ML_SETTINGS);
  const [mlSettingsDraft, setMlSettingsDraft] = useState<MlTradingSettings>(DEFAULT_ML_SETTINGS);
  const [mlSettingsOpen, setMlSettingsOpen] = useState(false);
  const [savingMlSettings, setSavingMlSettings] = useState(false);
  const [savingMlAsset, setSavingMlAsset] = useState<string | null>(null);
  const [mlSettingsMessage, setMlSettingsMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [mlAssetData, mlGeneralSettings] = await Promise.all([
        api.getMlTradingAssets(),
        api.getMlTradingSettings(),
      ]);
      setMlAssets(asArray<MlTradingAsset>(mlAssetData));
      setMlSettings(mlGeneralSettings);
      setMlSettingsDraft(mlGeneralSettings);
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
        risk_usd_min: Number(nextSettings.risk_usd_min),
        risk_usd_max: Number(nextSettings.risk_usd_max),
        enabled_assets: nextSettings.enabled_assets,
      });
      setMlSettings(saved);
      setMlSettingsDraft(saved);
      setMlSettingsMessage(saved.sync_result?.message || "ML Trading settings saved.");
      setMlAssets(await api.getMlTradingAssets());
    } catch (err) {
      setMlSettingsMessage(err instanceof Error ? err.message : "Failed to save ML Trading settings.");
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

  const aggregateMlStats = mlAssets.reduce(
    (acc, asset) => ({
      totalPnlUsd: acc.totalPnlUsd + (Number.isFinite(asset.stats.total_pnl_usd) ? asset.stats.total_pnl_usd : 0),
      todayPnlUsd: acc.todayPnlUsd + (Number.isFinite(asset.stats.today_pnl_usd) ? asset.stats.today_pnl_usd : 0),
    }),
    { totalPnlUsd: 0, todayPnlUsd: 0 },
  );

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
      label: "Min risk",
      value: formatUsd(mlSettings.risk_usd_min),
      detail: null as string | null,
      tone: null as string | null,
    },
    {
      label: "Max risk",
      value: formatUsd(mlSettings.risk_usd_max),
      detail: null as string | null,
      tone: null as string | null,
    },
  ];

  function toggleMlActive() {
    const nextSettings = { ...mlSettingsDraft, active: !mlSettingsDraft.active };
    setMlSettingsDraft(nextSettings);
    void saveMlSettings(nextSettings);
  }

  async function toggleMlAsset(asset: MlTradingAsset) {
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
            <label>
              <span>Min risk USD</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={mlSettingsDraft.risk_usd_min}
                onChange={(event) => updateMlSettingsDraft({ risk_usd_min: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Max risk USD</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={mlSettingsDraft.risk_usd_max}
                onChange={(event) => updateMlSettingsDraft({ risk_usd_max: Number(event.target.value) })}
              />
            </label>

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

            <button className="button-secondary custom-lean-save" type="submit" disabled={savingMlSettings}>
              {savingMlSettings ? "Saving..." : "Save settings"}
            </button>
          </form>

          {mlSettingsMessage ? <p className="custom-lean-settings__message">{mlSettingsMessage}</p> : null}
        </section>
      ) : null}

      <section className="panel custom-lean-assets">
        <div className="custom-lean-summary">
          {summaryCards.map((card) => (
            <div key={card.label}>
              <span>{card.label}</span>
              <strong className={card.tone || undefined}>{card.value}</strong>
              {card.detail ? <small>{card.detail}</small> : null}
            </div>
          ))}
        </div>

        <div className="custom-lean-workers">
          <div className="custom-lean-workers__header">
            <span>Asset</span>
            <span>Total PnL</span>
            <span>Today PnL</span>
            <span>Loss trades</span>
            <span>Win trades</span>
            <span>Avg win RR</span>
            <span>Avg loss RR</span>
            <span>Actions</span>
          </div>
          {mlAssets.length ? (
            mlAssets.map((asset) => (
              <MlAssetRow
                key={asset.asset}
                asset={asset}
                saving={savingMlAsset === asset.asset}
                onToggle={toggleMlAsset}
              />
            ))
          ) : (
            <div className="custom-lean-workers__empty">No ML Trading assets configured yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
