import { useMemo, useState } from "react";
import { ModalCloseButton } from "./ModalCloseButton";
import type { PlannerItem, PlannerItemInput, RedditCampaign } from "../lib/types";

type AccountOption = {
  id: number;
  label: string;
};

type SharedCampaignValues = {
  name: string;
  account_id: number | null;
  search_query: string;
  instruction: string;
  interval_minutes: number;
  duration_start: string | null;
  duration_end: string | null;
};

type RedditCampaignValues = SharedCampaignValues & {
  subreddit: string;
  search_query: string;
};

type PlannerCampaignValues = SharedCampaignValues;

type SocialCampaignModalProps =
  | {
      mode?: "create" | "edit";
      platform: "threads" | "twitter";
      platformLabel: string;
      accounts: AccountOption[];
      initialData?: PlannerItem | null;
      onClose: () => void;
      onSubmit: (payload: PlannerItemInput) => Promise<void>;
    }
  | {
      mode?: "create" | "edit";
      platform: "reddit";
      platformLabel: string;
      accounts: AccountOption[];
      initialData?: Partial<RedditCampaign> | null;
      onClose: () => void;
      onSubmit: (payload: Partial<RedditCampaign>) => Promise<void>;
    };

function toLocalDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function normalizePlatformLabel(platformLabel: string) {
  return platformLabel.replace(/\s+Agent$/i, "").trim();
}

function extractSearchQuery(value?: string | null) {
  const text = String(value || "").trim();
  for (const line of text.split("\n")) {
    const match = line.match(/^search query:\s*(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function stripSearchQueryHeader(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  const lines = text.split("\n");
  if (lines[0]?.match(/^search query:\s*(.+)$/i)) {
    return lines.slice(1).join("\n").trim();
  }
  return text;
}

function buildCampaignInstruction(searchQuery: string, instruction: string) {
  const query = searchQuery.trim();
  const body = stripSearchQueryHeader(instruction);
  if (!query) return body;
  return body ? `Search query: ${query}\n\n${body}` : `Search query: ${query}`;
}

export function SocialCampaignModal(props: SocialCampaignModalProps) {
  const {
    mode = "create",
    platform,
    platformLabel,
    accounts,
    initialData,
    onClose,
  } = props;
  const isEdit = mode === "edit";
  const cleanPlatformLabel = normalizePlatformLabel(platformLabel);
  const actionLabel = isEdit ? "Save Campaign" : "Create Campaign";
  const titleLabel = isEdit ? `Edit ${cleanPlatformLabel} Campaign` : `New ${cleanPlatformLabel} Campaign`;
  const hasAccounts = accounts.length > 0;

  const initialAccountId =
    platform === "reddit"
      ? Number((initialData as Partial<RedditCampaign> | null | undefined)?.reddit_account_id ?? accounts[0]?.id ?? 0) || null
      : Number((initialData as PlannerItem | null | undefined)?.account_id ?? accounts[0]?.id ?? 0) || null;

  const [form, setForm] = useState<SharedCampaignValues>(() => ({
    name: platform === "reddit"
      ? (initialData as Partial<RedditCampaign> | null | undefined)?.name ?? ""
      : (initialData as PlannerItem | null | undefined)?.title ?? "",
    account_id: initialAccountId,
    search_query: platform === "reddit"
      ? ""
      : extractSearchQuery((initialData as PlannerItem | null | undefined)?.instruction),
    instruction: platform === "reddit"
      ? (initialData as Partial<RedditCampaign> | null | undefined)?.agent_instructions ?? ""
      : stripSearchQueryHeader((initialData as PlannerItem | null | undefined)?.instruction),
    interval_minutes: platform === "reddit"
      ? Number((initialData as Partial<RedditCampaign> | null | undefined)?.throttle_interval_minutes ?? 60)
      : Number((initialData as PlannerItem | null | undefined)?.interval_minutes ?? 60),
    duration_start: platform === "reddit"
      ? (initialData as Partial<RedditCampaign> | null | undefined)?.start_at ?? null
      : (initialData as PlannerItem | null | undefined)?.duration_start ?? null,
    duration_end: platform === "reddit"
      ? (initialData as Partial<RedditCampaign> | null | undefined)?.end_at ?? null
      : (initialData as PlannerItem | null | undefined)?.duration_end ?? null,
  }));
  const [redditFields, setRedditFields] = useState(() => ({
    subreddit: platform === "reddit" ? (initialData as Partial<RedditCampaign> | null | undefined)?.subreddit ?? "" : "",
    search_query: platform === "reddit" ? (initialData as Partial<RedditCampaign> | null | undefined)?.search_query ?? "" : "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localStart = useMemo(() => toLocalDateTime(form.duration_start), [form.duration_start]);
  const localEnd = useMemo(() => toLocalDateTime(form.duration_end), [form.duration_end]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Campaign name is required.");
      return;
    }
    if (!form.account_id) {
      setError("Select an account first.");
      return;
    }
    if (!form.instruction.trim()) {
      setError("Campaign instruction is required.");
      return;
    }
    if (platform !== "reddit" && !form.search_query.trim()) {
      setError("Search query is required.");
      return;
    }
    if (form.interval_minutes <= 0) {
      setError("Interval must be greater than 0.");
      return;
    }
    if (platform === "reddit" && !redditFields.subreddit.trim()) {
      setError("Subreddit is required for Reddit campaigns.");
      return;
    }
    if (platform === "reddit" && !redditFields.search_query.trim()) {
      setError("Search query is required for Reddit campaigns.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const effectiveDurationStart = form.duration_start ?? null;
      if (platform === "reddit") {
        const payload: Partial<RedditCampaign> = {
          name: form.name.trim(),
          reddit_account_id: form.account_id,
          agent_instructions: form.instruction.trim(),
          throttle_enabled: true,
          throttle_interval_minutes: form.interval_minutes,
          start_at: effectiveDurationStart,
          end_at: form.duration_end,
          subreddit: redditFields.subreddit.trim(),
          search_query: redditFields.search_query.trim(),
          description: `Campaign instructions: ${form.instruction.trim()}`,
        };
        await props.onSubmit(payload);
      } else {
        const payload: PlannerItemInput = {
          title: form.name.trim(),
          item_type: "campaign",
          platform,
          status: "planned",
          account_id: form.account_id,
          instruction: buildCampaignInstruction(form.search_query, form.instruction),
          interval_minutes: form.interval_minutes,
          duration_start: effectiveDurationStart,
          duration_end: form.duration_end,
          description: form.instruction.trim(),
          scheduled_for: effectiveDurationStart,
        };
        await props.onSubmit(payload);
      }
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="social-connections-modal-backdrop">
      <div className="social-connections-modal panel social-editor-modal social-campaign-modal">
        <div className="panel__title-row">
          <div>
            <p className="social-kicker">Campaign</p>
            <h2>{titleLabel}</h2>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>

        {error ? <p className="error">{error}</p> : null}

        <form className="social-editor-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid-two">
            <label>
              Campaign name
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={`${cleanPlatformLabel} campaign`}
                required
              />
            </label>

            <label>
              Select account
              <select
                value={form.account_id ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, account_id: Number(event.target.value) || null }))}
                disabled={!hasAccounts}
                required
              >
                {!hasAccounts ? <option value="">No accounts connected</option> : null}
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {platform === "reddit" ? (
            <div className="grid-two">
              <label>
                Subreddit
                <input
                  value={redditFields.subreddit}
                  onChange={(event) => setRedditFields((current) => ({ ...current, subreddit: event.target.value }))}
                  placeholder="design"
                  required
                />
              </label>

              <label>
                Search query
                <input
                  value={redditFields.search_query}
                  onChange={(event) => setRedditFields((current) => ({ ...current, search_query: event.target.value }))}
                  placeholder="product design, ux, design systems"
                  required
                />
              </label>
            </div>
          ) : (
            <label>
              Search query
              <input
                value={form.search_query}
                onChange={(event) => setForm((current) => ({ ...current, search_query: event.target.value }))}
                placeholder="XAU trading"
                required
              />
              <small className="social-muted">Used for live campaign search and approval suggestions.</small>
            </label>
          )}

          <label>
            Campaign instruction
            <textarea
              rows={6}
              value={form.instruction}
              onChange={(event) => setForm((current) => ({ ...current, instruction: event.target.value }))}
              placeholder="How this campaign should behave, what it should focus on, and how it should write."
              required
            />
          </label>

          <div className="grid-three social-campaign-modal__timing">
            <label>
              Interval
              <input
                type="number"
                min="1"
                step="1"
                value={form.interval_minutes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, interval_minutes: Number(event.target.value) || 0 }))
                }
                placeholder="60"
                required
              />
              <small className="social-muted">Minutes between campaign actions.</small>
            </label>

            <label>
              Start date & time
              <input
                type="datetime-local"
                value={localStart}
                onChange={(event) =>
                  setForm((current) => ({ ...current, duration_start: toIsoOrNull(event.target.value) }))
                }
              />
              <small className="social-muted">Leave blank to start immediately.</small>
            </label>

            <label>
              End date & time
              <input
                type="datetime-local"
                value={localEnd}
                onChange={(event) =>
                  setForm((current) => ({ ...current, duration_end: toIsoOrNull(event.target.value) }))
                }
              />
              <small className="social-muted">Leave blank to keep searching until enough matches are found.</small>
            </label>
          </div>

          <div className="social-editor-form__actions">
            <button className="button-secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !hasAccounts}>
              {saving ? "Saving..." : actionLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
