import { useState } from "react";
import type { PlannerItem, PlannerItemInput } from "../lib/types";

type SocialPlannerItemModalProps = {
  itemType: PlannerItem["item_type"];
  platform: string;
  platformLabel: string;
  onClose: () => void;
  onSubmit: (payload: PlannerItemInput) => Promise<void>;
};

function defaultTitle(itemType: PlannerItem["item_type"], platformLabel: string) {
  return itemType === "campaign" ? `${platformLabel} campaign` : `${platformLabel} post`;
}

export function SocialPlannerItemModal({
  itemType,
  platform,
  platformLabel,
  onClose,
  onSubmit,
}: SocialPlannerItemModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<PlannerItem["status"]>("planned");
  const [scheduledFor, setScheduledFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actionLabel = itemType === "campaign" ? "Campaign" : "Post";

  return (
    <div className="social-connections-modal-backdrop" onClick={onClose}>
      <div className="social-connections-modal panel social-editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel__title-row">
          <div>
            <p className="social-kicker">Planner</p>
            <h2>New {platformLabel} {actionLabel}</h2>
          </div>
          <button className="button-secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <form
          className="social-editor-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!title.trim()) {
              setError(`${actionLabel} title is required.`);
              return;
            }

            setSaving(true);
            setError(null);
            try {
              await onSubmit({
                title: title.trim(),
                description: description.trim() || null,
                item_type: itemType,
                platform,
                status,
                scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
              });
              onClose();
            } catch (submitError) {
              setError(submitError instanceof Error ? submitError.message : `Failed to create ${actionLabel.toLowerCase()}`);
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            Title
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (error) setError(null);
              }}
              placeholder={defaultTitle(itemType, platformLabel)}
              required
            />
          </label>

          <label>
            Brief
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={
                itemType === "campaign"
                  ? "Audience, offer, angle, CTA, or sequencing notes."
                  : "Draft angle, hook, timing, or handoff notes."
              }
            />
          </label>

          <div className="grid-two">
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value as PlannerItem["status"])}>
                <option value="planned">Planned</option>
                <option value="drafting">Drafting</option>
                <option value="approved">Approved</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </label>

            <label>
              Scheduled for
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
            </label>
          </div>

          <div className="social-editor-form__actions">
            <button className="button-secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Saving..." : `Create ${actionLabel}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
