import { useEffect, useState } from "react";
import type { TradingStrategy, TradingHoursWindow } from "../lib/types";
import "../styles/trading-strategy-form.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface TradingStrategyFormProps {
  strategy?: TradingStrategy;
  onSubmit: (data: Partial<TradingStrategy>) => Promise<void>;
  onCancel: () => void;
}

function buildInitialForm(strategy?: TradingStrategy): Partial<TradingStrategy> {
  return (
    strategy || {
      name: "",
      assets: ["EURUSD"],
      strategy_type: "daytrading",
      risk_usd_min: 50,
      risk_usd_max: 50,
      rr_min: 1.5,
      rr_max: 2.5,
      breakeven_rr: 1.5,
      max_open_positions: 1,
      execution_mode: "demo",
      telegram_bot_token: "",
      telegram_chat_id: "",
      trading_hours: [],
    }
  );
}

function defaultWindow(): TradingHoursWindow {
  return { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "08:00", to: "17:00" };
}

export function TradingStrategyForm({
  strategy,
  onSubmit,
  onCancel,
}: TradingStrategyFormProps) {
  const [form, setForm] = useState<Partial<TradingStrategy>>(buildInitialForm(strategy));
  const [assetsText, setAssetsText] = useState((strategy?.assets || ["EURUSD"]).join(", "));
  const [tradingHours, setTradingHours] = useState<TradingHoursWindow[]>(strategy?.trading_hours ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = buildInitialForm(strategy);
    setForm(next);
    setAssetsText((next.assets || []).join(", "));
    setTradingHours(strategy?.trading_hours ?? []);
    setError(null);
  }, [strategy]);

  const handleChange = (
    field: keyof TradingStrategy,
    value: unknown,
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  function parseAssets(value: string): string[] {
    return value
      .split(/[,\n]/)
      .map((entry) => entry.trim().toUpperCase())
      .filter(Boolean);
  }

  function addWindow() {
    setTradingHours((prev) => [...prev, defaultWindow()]);
  }

  function removeWindow(idx: number) {
    setTradingHours((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateWindow(idx: number, patch: Partial<TradingHoursWindow>) {
    setTradingHours((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  }

  function toggleDay(idx: number, day: string) {
    setTradingHours((prev) =>
      prev.map((w, i) => {
        if (i !== idx) return w;
        const days = w.days.includes(day)
          ? w.days.filter((d) => d !== day)
          : [...w.days, day];
        return { ...w, days };
      }),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const assets = parseAssets(assetsText);
    const rrMin = Number(form.rr_min ?? 1.5);
    const rrMax = Number(form.rr_max ?? 2.5);
    const breakevenRr = Number(form.breakeven_rr ?? 1.5);
    const riskUsdMin = Number(form.risk_usd_min ?? 50);
    const riskUsdMax = Number(form.risk_usd_max ?? 50);

    if (!form.name || assets.length === 0) {
      setError("Please add a strategy name and at least one trading asset.");
      return;
    }

    if (rrMin < 1.5) {
      setError("Minimum RR must be at least 1.5R.");
      return;
    }

    if (rrMax > 2.5 || rrMax < rrMin) {
      setError("Maximum RR must stay between the minimum RR and 2.5R.");
      return;
    }

    if (breakevenRr < 0) {
      setError("Breakeven RR cannot be negative.");
      return;
    }

    if (riskUsdMax < riskUsdMin) {
      setError("Maximum risk cannot be less than minimum risk.");
      return;
    }

    for (const w of tradingHours) {
      if (w.days.length === 0) {
        setError("Each working hours window must have at least one day selected.");
        return;
      }
      if (!w.from || !w.to) {
        setError("Each working hours window must have a start and end time.");
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);
      await onSubmit({
        ...form,
        assets,
        rr_min: rrMin,
        rr_max: rrMax,
        breakeven_rr: breakevenRr,
        risk_usd_min: riskUsdMin,
        risk_usd_max: riskUsdMax,
        max_open_positions: Number(form.max_open_positions ?? 1),
        trading_hours: tradingHours,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save strategy");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="trading-form">
      {error ? <div className="trading-form__error">{error}</div> : null}

      <section className="trading-form__section">
        <h3>Strategy Basics</h3>

        <div className="trading-form__group">
          <label htmlFor="name">Strategy Name *</label>
          <input
            id="name"
            type="text"
            value={form.name || ""}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="e.g., London Session Reversal"
            className="trading-form__input"
          />
        </div>

        <div className="trading-form__group">
          <label htmlFor="assets">Trading Assets *</label>
          <textarea
            id="assets"
            value={assetsText}
            onChange={(e) => setAssetsText(e.target.value)}
            placeholder="EURUSD, GBPUSD, XAUUSD"
            className="trading-form__textarea"
            rows={3}
          />
          <p className="trading-form__helper">
            One strategy can track several assets. Separate them with commas or new lines.
          </p>
        </div>

        <div className="trading-form__row">
          <div className="trading-form__group">
            <label htmlFor="strategy_type">Strategy Type *</label>
            <select
              id="strategy_type"
              value={form.strategy_type || "daytrading"}
              onChange={(e) => handleChange("strategy_type", e.target.value as TradingStrategy["strategy_type"])}
              className="trading-form__input"
            >
              <option value="scalping">Scalping</option>
              <option value="daytrading">Day Trading</option>
              <option value="swing">Swing Trading</option>
              <option value="position">Position Trading</option>
            </select>
          </div>

          <div className="trading-form__group">
            <label htmlFor="execution_mode">Mode</label>
            <select
              id="execution_mode"
              value={form.execution_mode || "demo"}
              onChange={(e) => handleChange("execution_mode", e.target.value as TradingStrategy["execution_mode"])}
              className="trading-form__input"
            >
              <option value="demo">Demo</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>
      </section>

      <section className="trading-form__section">
        <h3>Risk Management</h3>

        <div className="trading-form__row">
          <div className="trading-form__group">
            <label htmlFor="risk_usd_min">Minimum Risk (USD)</label>
            <input
              id="risk_usd_min"
              type="number"
              min="1"
              step="1"
              value={form.risk_usd_min ?? 50}
              onChange={(e) => handleChange("risk_usd_min", Number(e.target.value))}
              className="trading-form__input"
            />
            <p className="trading-form__helper">Min allowed dollar risk.</p>
          </div>

          <div className="trading-form__group">
            <label htmlFor="risk_usd_max">Maximum Risk (USD)</label>
            <input
              id="risk_usd_max"
              type="number"
              min="1"
              step="1"
              value={form.risk_usd_max ?? 50}
              onChange={(e) => handleChange("risk_usd_max", Number(e.target.value))}
              className="trading-form__input"
            />
            <p className="trading-form__helper">Max allowed dollar risk.</p>
          </div>

          <div className="trading-form__group">
            <label htmlFor="rr_min">Minimum RR</label>
            <input
              id="rr_min"
              type="number"
              min="1.5"
              max="2.5"
              step="0.1"
              value={form.rr_min ?? 1.5}
              onChange={(e) => handleChange("rr_min", Number(e.target.value))}
              className="trading-form__input"
            />
          </div>

          <div className="trading-form__group">
            <label htmlFor="rr_max">Maximum RR</label>
            <input
              id="rr_max"
              type="number"
              min="1.5"
              max="2.5"
              step="0.1"
              value={form.rr_max ?? 2.5}
              onChange={(e) => handleChange("rr_max", Number(e.target.value))}
              className="trading-form__input"
            />
          </div>

          <div className="trading-form__group">
            <label htmlFor="max_open_positions">Max Open Positions</label>
            <input
              id="max_open_positions"
              type="number"
              min="1"
              value={form.max_open_positions ?? 1}
              onChange={(e) => handleChange("max_open_positions", Number(e.target.value))}
              className="trading-form__input"
            />
          </div>
        </div>

        <div className="trading-form__group">
          <label htmlFor="breakeven_rr">SL to Breakeven at</label>
          <input
            id="breakeven_rr"
            type="number"
            min="0"
            step="0.1"
            value={form.breakeven_rr ?? 1.5}
            onChange={(e) => handleChange("breakeven_rr", Number(e.target.value))}
            className="trading-form__input"
          />
          <p className="trading-form__helper">
            Example: `1.5` means when profit reaches 1.5R, stop loss moves to breakeven.
          </p>
        </div>
      </section>

      <section className="trading-form__section">
        <h3>Notifications</h3>

        <div className="trading-form__group">
          <label htmlFor="telegram_bot_token">Telegram Bot API Token</label>
          <input
            id="telegram_bot_token"
            type="password"
            value={form.telegram_bot_token || ""}
            onChange={(e) => handleChange("telegram_bot_token", e.target.value)}
            placeholder="Your Telegram bot token for this strategy"
            className="trading-form__input"
          />
        </div>

        <div className="trading-form__group">
          <label htmlFor="telegram_chat_id">Telegram Chat ID</label>
          <input
            id="telegram_chat_id"
            type="text"
            value={form.telegram_chat_id || ""}
            onChange={(e) => handleChange("telegram_chat_id", e.target.value)}
            placeholder="Your Telegram chat ID for notifications"
            className="trading-form__input"
          />
        </div>
      </section>

      <section className="trading-form__section">
        <div className="trading-form__section-header">
          <h3>Working Hours</h3>
          <button type="button" className="trading-form__add-window" onClick={addWindow}>
            + Add window
          </button>
        </div>
        <p className="trading-form__helper" style={{ marginBottom: 16 }}>
          Signals are only sent during the time windows below. Leave empty to send anytime (24/7).
        </p>

        {tradingHours.length === 0 && (
          <div className="trading-form__hours-empty">
            No restrictions — signals sent anytime.
          </div>
        )}

        {tradingHours.map((window, idx) => (
          <div key={idx} className="trading-form__hours-window">
            <div className="trading-form__hours-window-header">
              <span className="trading-form__hours-window-label">Window {idx + 1}</span>
              <button
                type="button"
                className="trading-form__remove-window"
                onClick={() => removeWindow(idx)}
              >
                Remove
              </button>
            </div>

            <div className="trading-form__days">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={`trading-form__day-btn${window.days.includes(day) ? " trading-form__day-btn--active" : ""}`}
                  onClick={() => toggleDay(idx, day)}
                >
                  {day}
                </button>
              ))}
            </div>

            <div className="trading-form__hours-times">
              <div className="trading-form__group">
                <label>From</label>
                <input
                  type="time"
                  value={window.from}
                  onChange={(e) => updateWindow(idx, { from: e.target.value })}
                  className="trading-form__input"
                />
              </div>
              <div className="trading-form__group">
                <label>To</label>
                <input
                  type="time"
                  value={window.to}
                  onChange={(e) => updateWindow(idx, { to: e.target.value })}
                  className="trading-form__input"
                />
              </div>
            </div>
          </div>
        ))}
      </section>

      <div className="trading-form__actions">
        <button
          type="submit"
          disabled={loading}
          className="trading-form__submit"
        >
          {loading ? "Saving..." : strategy ? "Update Strategy" : "Create Strategy"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="trading-form__cancel"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
