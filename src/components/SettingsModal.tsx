import { APIConnectionPanel } from "./APIConnectionPanel";
import type { AppSettingsInput } from "../lib/types";

type SettingsModalProps = {
  settings: {
    ai_api_connected: boolean;
    claude_model: string;
    trading_agent_url: string;
    trading_agent_connected: boolean;
    trading_agent_token_saved?: boolean;
  };
  syncMessage: string | null;
  onClose: () => void;
  onSave: (payload: AppSettingsInput) => Promise<unknown>;
  onSyncAgent: () => Promise<unknown>;
};

export function SettingsModal({
  settings,
  syncMessage,
  onClose,
  onSave,
  onSyncAgent,
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
          aiApiConnected={settings.ai_api_connected}
          claudeModel={settings.claude_model}
          tradingAgentUrl={settings.trading_agent_url}
          tradingAgentConnected={settings.trading_agent_connected}
          tradingAgentTokenSaved={settings.trading_agent_token_saved}
          syncMessage={syncMessage}
          onSave={onSave}
          onSyncAgent={onSyncAgent}
          title="AI API Connection"
          description="One shared AI connection for the dashboard and the Python trading agent. Save it here once, then sync it to the agent."
        />
      </div>
    </div>
  );
}
