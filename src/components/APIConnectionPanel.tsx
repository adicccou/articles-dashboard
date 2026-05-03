import { useState } from "react";
import "../styles/api-connection-panel.css";

interface APIConnectionPanelProps {
  aiApiConnected?: boolean;
  telegramChatId?: string;
  onAiApiConnect?: (apiKey: string) => void;
  onTelegramChange?: (chatId: string) => void;
  showTelegram?: boolean;
  title?: string;
  description?: string;
}

export function APIConnectionPanel({
  aiApiConnected,
  telegramChatId,
  onAiApiConnect,
  onTelegramChange,
  showTelegram = true,
  title = "AI API Connection",
  description = "Shared settings used across all tools. Keep one AI API connection here instead of repeating it in each section.",
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
          <button
            onClick={() => {
              if (claudeKey) {
                onAiApiConnect?.(claudeKey);
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

      {showTelegram ? (
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
      ) : null}
    </div>
  );
}
