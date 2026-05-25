import { TrashIcon } from "@heroicons/react/24/solid";
import { ModalCloseButton } from "../ModalCloseButton";

type RiskDraft = {
  risk_usd_min: number;
  risk_usd_max: number;
};

type ConfidenceDraft = {
  min_confidence: number;
};

export function ExecutionControlsModal({
  open,
  title,
  subtitle,
  enabledLabel,
  enabled,
  riskDraft,
  confidenceDraft,
  saving,
  onClose,
  onToggleEnabled,
  onRiskChange,
  onConfidenceChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  enabledLabel: string;
  enabled: boolean;
  riskDraft: RiskDraft;
  confidenceDraft: ConfidenceDraft;
  saving: boolean;
  onClose: () => void;
  onToggleEnabled: () => void;
  onRiskChange: (patch: Partial<RiskDraft>) => void;
  onConfidenceChange: (patch: Partial<ConfidenceDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="execution-controls-modal" role="dialog" aria-modal="true" aria-label={`${title} controls`}>
      <button type="button" className="execution-controls-modal__backdrop" aria-label="Close modal" onClick={onClose} />
      <div className="execution-controls-modal__card">
        <div className="execution-controls-modal__header">
          <div>
            <span className="custom-lean-eyebrow">Execution Controls</span>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <ModalCloseButton onClick={onClose} disabled={saving} label="Close execution controls" />
        </div>

        <div className="execution-controls-modal__body">
          <section className="execution-controls-modal__section">
            <span>{enabledLabel}</span>
            <div className="execution-controls-modal__toggle-row">
              <button
                type="button"
                className={enabled ? "custom-lean-worker__toggle custom-lean-worker__toggle--on" : "custom-lean-worker__toggle"}
                aria-pressed={enabled}
                onClick={onToggleEnabled}
                disabled={saving}
              >
                <span className="custom-lean-worker__toggle-knob" />
              </button>
              <strong>{enabled ? "On" : "Off"}</strong>
            </div>
          </section>

          <section className="execution-controls-modal__section">
            <span>Risk USD</span>
            <div className="execution-controls-modal__inputs">
              <label>
                <small>Minimum</small>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={riskDraft.risk_usd_min}
                  onChange={(event) => onRiskChange({ risk_usd_min: Number(event.target.value) })}
                  disabled={saving}
                />
              </label>
              <label>
                <small>Maximum</small>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={riskDraft.risk_usd_max}
                  onChange={(event) => onRiskChange({ risk_usd_max: Number(event.target.value) })}
                  disabled={saving}
                />
              </label>
            </div>
          </section>

          <section className="execution-controls-modal__section">
            <span>Confidence</span>
            <div className="execution-controls-modal__inputs execution-controls-modal__inputs--single">
              <label>
                <small>Minimum confidence</small>
                <input
                  type="number"
                  min="1"
                  max="99"
                  step="1"
                  value={confidenceDraft.min_confidence}
                  onChange={(event) => onConfidenceChange({ min_confidence: Number(event.target.value) })}
                  disabled={saving}
                />
              </label>
            </div>
          </section>
        </div>

        <div className="execution-controls-modal__footer">
          {onDelete ? (
            <button
              type="button"
              className="custom-lean-worker__delete execution-controls-modal__delete dashboard-icon-button"
              onClick={onDelete}
              disabled={saving}
              aria-label="Delete"
              title="Delete"
            >
              <TrashIcon aria-hidden="true" />
            </button>
          ) : <span />}
          <button type="button" className="button-secondary custom-lean-save" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
