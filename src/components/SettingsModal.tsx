import { APIConnectionPanel } from "./APIConnectionPanel";

type SettingsModalProps = {
  aiApiConnected: boolean;
  onClose: () => void;
  onSaveAiKey: (apiKey: string) => void;
};

export function SettingsModal({
  aiApiConnected,
  onClose,
  onSaveAiKey,
}: SettingsModalProps) {
  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div className="settings-modal panel" onClick={(event) => event.stopPropagation()}>
        <div className="panel__title-row">
          <div>
            <p className="assistant-kicker">Workspace Settings</p>
            <h2>Settings</h2>
          </div>
          <button type="button" className="button-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <APIConnectionPanel
          aiApiConnected={aiApiConnected}
          onAiApiConnect={onSaveAiKey}
          showTelegram={false}
          title="AI API Connection"
          description="One shared AI connection for the entire dashboard. Trading and other tools use this single setup."
        />
      </div>
    </div>
  );
}
