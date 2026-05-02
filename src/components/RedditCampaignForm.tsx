import { useState } from "react";
import type { RedditAccount, RedditCampaign } from "../lib/types";

interface RedditCampaignFormProps {
  accounts: RedditAccount[];
  initialData?: Partial<RedditCampaign>;
  onSubmit: (data: Partial<RedditCampaign>) => Promise<void>;
  onCancel: () => void;
}

export const RedditCampaignForm: React.FC<RedditCampaignFormProps> = ({
  accounts,
  initialData,
  onSubmit,
  onCancel,
}) => {
  const [form, setForm] = useState({
    name: initialData?.name ?? "",
    description: initialData?.description ?? "",
    reddit_account_id: initialData?.reddit_account_id ?? (accounts[0]?.id || ""),
    subreddit: initialData?.subreddit ?? "",
    search_query: initialData?.search_query ?? "",
    agent_instructions:
      initialData?.agent_instructions ??
      "You are a helpful assistant. Reply to Reddit comments in a friendly and helpful manner. Keep replies concise (under 500 characters).",
    status: (initialData?.status ?? "active") as "active" | "inactive" | "paused",
    batch_size: initialData?.batch_size ?? 10,
    batch_window_hours: initialData?.batch_window_hours ?? 24,
    throttle_enabled: initialData?.throttle_enabled ?? true,
    throttle_interval_minutes: initialData?.throttle_interval_minutes ?? 60,
    telegram_chat_id: initialData?.telegram_chat_id ?? "",
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Campaign name is required");
      return;
    }
    if (!form.subreddit.trim()) {
      setError("Subreddit is required");
      return;
    }
    if (!form.search_query.trim()) {
      setError("Search query is required");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...form,
        reddit_account_id: Number(form.reddit_account_id),
        search_criteria: {
          min_score: 0,
          time_filter: "week",
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save campaign");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <section className="panel stack">
        <div className="panel__title-row">
          <h2>{initialData?.id ? "Edit Campaign" : "New Campaign"}</h2>
          <div className="actions">
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              {busy ? "Saving..." : "Save Campaign"}
            </button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="grid-two">
          <label>
            Campaign Name *
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Python Help Campaign"
              required
            />
          </label>
          <label>
            Reddit Account *
            <select
              value={form.reddit_account_id}
              onChange={(e) =>
                setForm({ ...form, reddit_account_id: Number(e.target.value) })
              }
              required
            >
              {accounts.length === 0 ? (
                <option value="">No accounts connected</option>
              ) : (
                accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>

        <label>
          Description
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Optional description of this campaign"
            rows={2}
          />
        </label>

        <div className="grid-two">
          <label>
            Subreddit *
            <input
              value={form.subreddit}
              onChange={(e) => setForm({ ...form, subreddit: e.target.value })}
              placeholder="python"
              required
            />
          </label>
          <label>
            Search Query *
            <input
              value={form.search_query}
              onChange={(e) =>
                setForm({ ...form, search_query: e.target.value })
              }
              placeholder="help needed, how to"
              required
            />
          </label>
        </div>

        <label>
          Agent Instructions (Claude System Prompt) *
          <textarea
            value={form.agent_instructions}
            onChange={(e) =>
              setForm({ ...form, agent_instructions: e.target.value })
            }
            placeholder="You are a helpful assistant..."
            rows={6}
            required
          />
        </label>
      </section>

      <section className="panel stack">
        <div className="panel__title-row">
          <h2>Approval & Posting Settings</h2>
        </div>

        <div className="grid-two">
          <label>
            Batch Size
            <input
              type="number"
              value={form.batch_size}
              onChange={(e) =>
                setForm({ ...form, batch_size: Number(e.target.value) })
              }
              min="1"
              max="50"
            />
          </label>
          <label>
            Batch Window (hours)
            <input
              type="number"
              value={form.batch_window_hours}
              onChange={(e) =>
                setForm({ ...form, batch_window_hours: Number(e.target.value) })
              }
              min="1"
              max="168"
            />
          </label>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            checked={form.throttle_enabled}
            onChange={(e) =>
              setForm({ ...form, throttle_enabled: e.target.checked })
            }
          />
          <span>Enable Throttling</span>
        </label>

        {form.throttle_enabled && (
          <label>
            Throttle Interval (minutes)
            <input
              type="number"
              value={form.throttle_interval_minutes}
              onChange={(e) =>
                setForm({
                  ...form,
                  throttle_interval_minutes: Number(e.target.value),
                })
              }
              min="1"
              max="1440"
            />
          </label>
        )}
      </section>

      <section className="panel stack">
        <div className="panel__title-row">
          <h2>Notifications (Optional)</h2>
        </div>

        <label>
          Telegram Chat ID
          <input
            value={form.telegram_chat_id}
            onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })}
            placeholder="Optional: Your Telegram chat ID for batch approvals"
          />
        </label>
      </section>
    </form>
  );
};
