import { useEffect, useState } from "react";
import "../styles/api-connection-panel.css";

interface APIConnectionPanelProps {
  aiApiConnected?: boolean;
  claudeModel?: string;
  tradingAgentUrl?: string;
  tradingAgentConnected?: boolean;
  tradingAgentTokenSaved?: boolean;
  syncMessage?: string | null;
  onSave?: (payload: {
    anthropic_api_key?: string;
    claude_model?: string;
    trading_agent_url?: string;
    trading_agent_token?: string;
  }) => Promise<unknown>;
  onSyncAgent?: () => Promise<unknown>;
  title?: string;
  description?: string;
}

export function APIConnectionPanel({
  aiApiConnected,
  claudeModel = "claude-sonnet-4-20250514",
  tradingAgentUrl = "",
  tradingAgentConnected,
  tradingAgentTokenSaved,
  syncMessage,
  onSave,
  onSyncAgent,
  title = "AI API Connection",
  description = "Shared settings used across all tools. Keep one AI API connection here instead of repeating it in each section.",
}: APIConnectionPanelProps) {
  const [claudeKey, setClaudeKey] = useState("");
  const [model, setModel] = useState(claudeModel);
  const [agentUrl, setAgentUrl] = useState(tradingAgentUrl);
  const [agentToken, setAgentToken] = useState("");
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);

  useEffect(() => {
    setModel(claudeModel);
  }, [claudeModel]);

  useEffect(() => {
    setAgentUrl(tradingAgentUrl);
  }, [tradingAgentUrl]);

  const handleTestConnection = async (service: string) => {
    setTestingConnection(service);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setTestingConnection(null);
  };

  const buildPayload = () => ({
    anthropic_api_key: claudeKey || undefined,
    claude_model: model,
    trading_agent_url: agentUrl,
    trading_agent_token: agentToken || undefined,
  });

  const hasUnsavedAgentChanges =
    agentUrl !== tradingAgentUrl || agentToken.trim().length > 0 || model !== claudeModel || claudeKey.trim().length > 0;

  return (
    <div className="api-panel">
      <h3 className="api-panel__title">{title}</h3>
      <p className="api-panel__description">{description}</p>

      <div className="api-panel__section">
        <div className="api-panel__header">
          <h4>Anthropic / Claude API</h4>
          <span className={`api-panel__status ${aiApiConnected ? "connected" : "disconnected"}`}>
            {aiApiConnected ? "✓ Connected" : "○ Not Connected"}
          </span>
        </div>
        <div className="api-panel__inputs">
          <input
            type="password"
            placeholder="Claude API Key"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="text"
            placeholder="Claude model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="api-panel__input"
          />
          <button
            onClick={async () => {
              await onSave?.(buildPayload());
              setClaudeKey("");
              setAgentToken("");
              handleTestConnection("claude");
            }}
            disabled={testingConnection === "claude"}
            className="api-panel__button"
          >
            {testingConnection === "claude" ? "Testing..." : "Connect"}
          </button>
        </div>
      </div>

      <div className="api-panel__section">
        <div className="api-panel__header">
          <h4>Trading Agent Sync</h4>
          <span className={`api-panel__status ${tradingAgentConnected ? "connected" : "disconnected"}`}>
            {tradingAgentConnected ? "✓ Connected" : "○ Not Connected"}
          </span>
        </div>
        <div className="api-panel__inputs">
          <input
            type="url"
            placeholder="Trading agent base URL, e.g. http://YOUR_SERVER_IP:8787"
            value={agentUrl}
            onChange={(e) => setAgentUrl(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="password"
            placeholder={tradingAgentTokenSaved ? "Saved token on file. Enter a new token only to replace it." : "Trading agent sync token"}
            value={agentToken}
            onChange={(e) => setAgentToken(e.target.value)}
            className="api-panel__input"
          />
          {tradingAgentTokenSaved ? (
            <p className="api-panel__helper">A trading agent token is already saved for this workspace.</p>
          ) : null}
          <div className="api-panel__button-row">
            <button
              onClick={async () => {
                setSavingAgent(true);
                try {
                  await onSave?.(buildPayload());
                  setClaudeKey("");
                  setAgentToken("");
                } finally {
                  setSavingAgent(false);
                }
              }}
              disabled={savingAgent}
              className="api-panel__button"
            >
              {savingAgent ? "Saving..." : "Save Settings"}
            </button>
            <button
              onClick={async () => {
                setSavingAgent(true);
                try {
                  if (hasUnsavedAgentChanges) {
                    await onSave?.(buildPayload());
                    setClaudeKey("");
                    setAgentToken("");
                  } else {
                    await onSyncAgent?.();
                  }
                } finally {
                  setSavingAgent(false);
                }
              }}
              disabled={savingAgent}
              className="api-panel__button api-panel__button--secondary"
            >
              {savingAgent ? "Syncing..." : "Sync Agent Now"}
            </button>
          </div>
          {syncMessage ? <p className="api-panel__helper">{syncMessage}</p> : null}
        </div>
      </div>
    </div>
  );
}
