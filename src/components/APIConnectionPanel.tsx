import { useState } from "react";
import "../styles/api-connection-panel.css";

interface APIConnectionPanelProps {
  claudeApiKey?: boolean;
  telegramChatId?: string;
  onClaudeChange?: (apiKey: string) => void;
  onTelegramChange?: (chatId: string) => void;
}

export function APIConnectionPanel({
  claudeApiKey,
  telegramChatId,
  onClaudeChange,
  onTelegramChange,
}: APIConnectionPanelProps) {
  const [claudeKey, setClaudeKey] = useState("");
  const [telegramChat, setTelegramChat] = useState(telegramChatId || "");
  const [testingConnection, setTestingConnection] = useState<string | null>(null);

  const handleTestConnection = async (service: string) => {
    setTestingConnection(service);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setTestingConnection(null);
  };

  return (
    <div className="api-panel">
      <h3 className="api-panel__title">🔌 Global API Connections</h3>
      <p className="api-panel__description">
        Shared settings used across all trading strategies. cTrader credentials are configured per strategy.
      </p>

      {/* Claude API Connection */}
      <div className="api-panel__section">
        <div className="api-panel__header">
          <h4>Claude API</h4>
          <span className={`api-panel__status ${claudeApiKey ? "connected" : "disconnected"}`}>
            {claudeApiKey ? "✓ Connected" : "○ Not Connected"}
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
          <button
            onClick={() => {
              if (claudeKey) {
                onClaudeChange?.(claudeKey);
              }
              handleTestConnection("claude");
            }}
            disabled={testingConnection === "claude"}
            className="api-panel__button"
          >
            {testingConnection === "claude" ? "Testing..." : "Connect"}
          </button>
        </div>
      </div>

      {/* Telegram Connection */}
      <div className="api-panel__section">
        <div className="api-panel__header">
          <h4>Telegram Bot</h4>
          <span className={`api-panel__status ${telegramChat ? "connected" : "disconnected"}`}>
            {telegramChat ? "✓ Connected" : "○ Not Connected"}
          </span>
        </div>
        <div className="api-panel__inputs">
          <input
            type="text"
            placeholder="Telegram Chat ID"
            value={telegramChat}
            onChange={(e) => setTelegramChat(e.target.value)}
            className="api-panel__input"
          />
          <button
            onClick={() => {
              if (telegramChat) {
                onTelegramChange?.(telegramChat);
              }
              handleTestConnection("telegram");
            }}
            disabled={testingConnection === "telegram"}
            className="api-panel__button"
          >
            {testingConnection === "telegram" ? "Testing..." : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
