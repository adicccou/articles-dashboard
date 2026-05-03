import { useState } from "react";
import type { TradingStrategy } from "../lib/types";
import "../styles/trading-strategy-form.css";

interface TradingStrategyFormProps {
  strategy?: TradingStrategy;
  onSubmit: (data: Partial<TradingStrategy>) => Promise<void>;
  onCancel: () => void;
}

export function TradingStrategyForm({
  strategy,
  onSubmit,
  onCancel,
}: TradingStrategyFormProps) {
  const [form, setForm] = useState<Partial<TradingStrategy>>(
    strategy || {
      name: "",
      description: "",
      symbol: "EURUSD",
      strategy_type: "daytrading",
      lot_size: 0.1,
      max_open_positions: 1,
    }
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    field: keyof TradingStrategy,
    value: unknown
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name || !form.symbol || !form.ctrader_login || !form.ctrader_password) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save strategy");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="trading-form">
      {error && <div className="trading-form__error">{error}</div>}

      <section className="trading-form__section">
        <h3>Strategy Basics</h3>

        <div className="trading-form__group">
          <label htmlFor="name">Strategy Name *</label>
          <input
            id="name"
            type="text"
            value={form.name || ""}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="e.g., EUR/USD Scalper"
            className="trading-form__input"
          />
        </div>

        <div className="trading-form__group">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={form.description || ""}
            onChange={(e) => handleChange("description", e.target.value)}
            placeholder="Describe your trading strategy..."
            className="trading-form__textarea"
            rows={3}
          />
        </div>

        <div className="trading-form__row">
          <div className="trading-form__group">
            <label htmlFor="symbol">Trading Symbol *</label>
            <input
              id="symbol"
              type="text"
              value={form.symbol || ""}
              onChange={(e) => handleChange("symbol", e.target.value)}
              placeholder="e.g., EURUSD"
              className="trading-form__input"
            />
          </div>

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
        </div>
      </section>

      <section className="trading-form__section">
        <h3>Trading Parameters</h3>

        <div className="trading-form__row">
          <div className="trading-form__group">
            <label htmlFor="lot_size">Lot Size</label>
            <input
              id="lot_size"
              type="number"
              step="0.01"
              value={form.lot_size || 0.1}
              onChange={(e) => handleChange("lot_size", parseFloat(e.target.value))}
              className="trading-form__input"
            />
          </div>

          <div className="trading-form__group">
            <label htmlFor="stop_loss_pips">Stop Loss (Pips)</label>
            <input
              id="stop_loss_pips"
              type="number"
              value={form.stop_loss_pips || ""}
              onChange={(e) => handleChange("stop_loss_pips", e.target.value ? parseInt(e.target.value) : null)}
              placeholder="e.g., 50"
              className="trading-form__input"
            />
          </div>

          <div className="trading-form__group">
            <label htmlFor="take_profit_pips">Take Profit (Pips)</label>
            <input
              id="take_profit_pips"
              type="number"
              value={form.take_profit_pips || ""}
              onChange={(e) => handleChange("take_profit_pips", e.target.value ? parseInt(e.target.value) : null)}
              placeholder="e.g., 100"
              className="trading-form__input"
            />
          </div>

          <div className="trading-form__group">
            <label htmlFor="max_open_positions">Max Open Positions</label>
            <input
              id="max_open_positions"
              type="number"
              value={form.max_open_positions || 1}
              onChange={(e) => handleChange("max_open_positions", parseInt(e.target.value))}
              className="trading-form__input"
            />
          </div>
        </div>
      </section>

      <section className="trading-form__section">
        <h3>cTrader Connection</h3>

        <div className="trading-form__group">
          <label htmlFor="ctrader_login">cTrader Login *</label>
          <input
            id="ctrader_login"
            type="text"
            value={form.ctrader_login || ""}
            onChange={(e) => handleChange("ctrader_login", e.target.value)}
            placeholder="Your cTrader username"
            className="trading-form__input"
          />
        </div>

        <div className="trading-form__group">
          <label htmlFor="ctrader_password">cTrader Password *</label>
          <input
            id="ctrader_password"
            type="password"
            value={form.ctrader_password || ""}
            onChange={(e) => handleChange("ctrader_password", e.target.value)}
            placeholder="Your cTrader password"
            className="trading-form__input"
          />
        </div>

        <div className="trading-form__row">
          <div className="trading-form__group">
            <label htmlFor="ctrader_account_id">cTrader Account ID *</label>
            <input
              id="ctrader_account_id"
              type="text"
              value={form.ctrader_account_id || ""}
              onChange={(e) => handleChange("ctrader_account_id", e.target.value)}
              placeholder="Your cTrader account ID"
              className="trading-form__input"
            />
          </div>

          <div className="trading-form__group">
            <label htmlFor="ctrader_server">Server</label>
            <select
              id="ctrader_server"
              value={form.ctrader_server || ""}
              onChange={(e) => handleChange("ctrader_server", e.target.value)}
              className="trading-form__input"
            >
              <option value="">Default</option>
              <option value="demo">Demo</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>
      </section>

      <section className="trading-form__section">
        <h3>AI Configuration</h3>

        <div className="trading-form__group">
          <label htmlFor="claude_instructions">Claude Instructions</label>
          <textarea
            id="claude_instructions"
            value={form.claude_instructions || ""}
            onChange={(e) => handleChange("claude_instructions", e.target.value)}
            placeholder="Provide instructions for Claude to optimize your trading strategy..."
            className="trading-form__textarea"
            rows={4}
          />
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
