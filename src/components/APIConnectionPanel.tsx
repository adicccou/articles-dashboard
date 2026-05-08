import { useEffect, useState } from "react";
import "../styles/api-connection-panel.css";

export type SettingsTabId = "ai" | "rules" | "trading" | "agent";

interface APIConnectionPanelProps {
  activeTab?: SettingsTabId;
  aiApiConnected?: boolean;
  geminiApiConnected?: boolean;
  geminiFlashModel?: string;
  geminiProModel?: string;
  globalAiRules?: string;
  socialAgentRules?: string;
  workspaceTimezone?: string;
  tradingAgentUrl?: string;
  tradingAgentConnected?: boolean;
  tradingAgentTokenSaved?: boolean;
  ctraderClientId?: string;
  ctraderAccountId?: string;
  ctraderDemoAccountId?: string;
  ctraderLiveAccountId?: string;
  ctraderConnected?: boolean;
  ctraderClientSecretSaved?: boolean;
  ctraderAccessTokenSaved?: boolean;
  syncMessage?: string | null;
  onSave?: (payload: {
    gemini_api_key?: string;
    gemini_flash_model?: string;
    gemini_pro_model?: string;
    global_ai_rules?: string;
    social_agent_rules?: string;
    workspace_timezone?: string;
    trading_agent_url?: string;
    trading_agent_token?: string;
    ctrader_client_id?: string;
    ctrader_client_secret?: string;
    ctrader_access_token?: string;
    ctrader_account_id?: string;
    ctrader_demo_account_id?: string;
    ctrader_live_account_id?: string;
  }) => Promise<unknown>;
  onSyncAgent?: () => Promise<unknown>;
  title?: string;
  description?: string;
}

export function APIConnectionPanel({
  activeTab = "ai",
  aiApiConnected,
  geminiApiConnected,
  geminiFlashModel = "gemini-3.1-flash-lite",
  geminiProModel = "gemini-3.1-pro-preview",
  globalAiRules = "",
  socialAgentRules = "",
  workspaceTimezone = "Asia/Kuala_Lumpur",
  tradingAgentUrl = "",
  tradingAgentConnected,
  tradingAgentTokenSaved,
  ctraderClientId = "",
  ctraderAccountId = "",
  ctraderDemoAccountId = "",
  ctraderLiveAccountId = "",
  ctraderConnected,
  ctraderClientSecretSaved,
  ctraderAccessTokenSaved,
  syncMessage,
  onSave,
  onSyncAgent,
  title = "AI API Connection",
  description = "Shared settings used across all tools. Keep one AI API configuration here instead of repeating it in each section.",
}: APIConnectionPanelProps) {
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiFlash, setGeminiFlash] = useState(geminiFlashModel);
  const [geminiPro, setGeminiPro] = useState(geminiProModel);
  const [globalRules, setGlobalRules] = useState(globalAiRules);
  const [socialRules, setSocialRules] = useState(socialAgentRules);
  const [timezoneValue, setTimezoneValue] = useState(workspaceTimezone);
  const [agentUrl, setAgentUrl] = useState(tradingAgentUrl);
  const [agentToken, setAgentToken] = useState("");
  const [ctraderClientIdValue, setCtraderClientIdValue] = useState(ctraderClientId);
  const [ctraderClientSecret, setCtraderClientSecret] = useState("");
  const [ctraderAccessToken, setCtraderAccessToken] = useState("");
  const [ctraderAccountIdValue, setCtraderAccountIdValue] = useState(ctraderAccountId);
  const [ctraderDemoAccountIdValue, setCtraderDemoAccountIdValue] = useState(ctraderDemoAccountId);
  const [ctraderLiveAccountIdValue, setCtraderLiveAccountIdValue] = useState(ctraderLiveAccountId);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingCtrader, setSavingCtrader] = useState(false);
  const [savingRules, setSavingRules] = useState(false);

  useEffect(() => {
    setGeminiFlash(geminiFlashModel);
  }, [geminiFlashModel]);

  useEffect(() => {
    setGeminiPro(geminiProModel);
  }, [geminiProModel]);

  useEffect(() => {
    setAgentUrl(tradingAgentUrl);
  }, [tradingAgentUrl]);

  useEffect(() => {
    setGlobalRules(globalAiRules);
  }, [globalAiRules]);

  useEffect(() => {
    setSocialRules(socialAgentRules);
  }, [socialAgentRules]);

  useEffect(() => {
    setTimezoneValue(workspaceTimezone);
  }, [workspaceTimezone]);

  useEffect(() => {
    setCtraderClientIdValue(ctraderClientId);
  }, [ctraderClientId]);

  useEffect(() => {
    setCtraderAccountIdValue(ctraderAccountId);
  }, [ctraderAccountId]);

  useEffect(() => {
    setCtraderDemoAccountIdValue(ctraderDemoAccountId);
  }, [ctraderDemoAccountId]);

  useEffect(() => {
    setCtraderLiveAccountIdValue(ctraderLiveAccountId);
  }, [ctraderLiveAccountId]);

  const handleTestConnection = async (service: string) => {
    setTestingConnection(service);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setTestingConnection(null);
  };

  const buildPayload = () => ({
    gemini_api_key: geminiKey || undefined,
    gemini_flash_model: geminiFlash,
    gemini_pro_model: geminiPro,
    global_ai_rules: globalRules,
    social_agent_rules: socialRules,
    workspace_timezone: timezoneValue.trim() || "Asia/Kuala_Lumpur",
    trading_agent_url: agentUrl,
    trading_agent_token: agentToken || undefined,
    ctrader_client_id: ctraderClientIdValue,
    ctrader_client_secret: ctraderClientSecret || undefined,
    ctrader_access_token: ctraderAccessToken || undefined,
    ctrader_account_id: ctraderAccountIdValue,
    ctrader_demo_account_id: ctraderDemoAccountIdValue,
    ctrader_live_account_id: ctraderLiveAccountIdValue,
  });

  const hasUnsavedAgentChanges =
    agentUrl !== tradingAgentUrl ||
    agentToken.trim().length > 0 ||
    geminiFlash !== geminiFlashModel ||
    geminiPro !== geminiProModel ||
    globalRules !== globalAiRules ||
    socialRules !== socialAgentRules ||
    timezoneValue !== workspaceTimezone ||
    geminiKey.trim().length > 0;

  const tabMeta: Record<SettingsTabId, { title: string; description: string }> = {
    ai: {
      title: "AI API Connection",
      description: "Connect the shared Gemini models used for trading and social reasoning.",
    },
    rules: {
      title: "AI Operating Rules",
      description: "Set persistent context, voice, and non-negotiable instructions the assistant should follow.",
    },
    trading: {
      title: "Trading Platform Connection",
      description: "Keep trading credentials in one place so signals only unlock when the account is actually connected.",
    },
    agent: {
      title: "Trading Agent Sync",
      description: "Manage the bridge between the dashboard and the droplet-based trading agent.",
    },
  };

  const currentTab = tabMeta[activeTab];

  return (
    <div className="api-panel">
      <h3 className="api-panel__title">{currentTab?.title ?? title}</h3>
      <p className="api-panel__description">{currentTab?.description ?? description}</p>

      <div className={`api-panel__section ${activeTab === "ai" ? "" : "api-panel__section--hidden"}`}>
        <div className="api-panel__header">
          <h4>Shared AI API Settings</h4>
          <span className={`api-panel__status ${aiApiConnected ? "connected" : "disconnected"}`}>
            {aiApiConnected ? "✓ Connected" : "○ Not Connected"}
          </span>
        </div>
        <div className="api-panel__inputs">
          <input
            type="password"
            placeholder="Primary AI API Key"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="text"
            placeholder="Primary scan model"
            value={geminiFlash}
            onChange={(e) => setGeminiFlash(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="text"
            placeholder="Primary reasoning model"
            value={geminiPro}
            onChange={(e) => setGeminiPro(e.target.value)}
            className="api-panel__input"
          />
          <button
            onClick={async () => {
              await onSave?.(buildPayload());
              setGeminiKey("");
              setAgentToken("");
              setCtraderClientSecret("");
              setCtraderAccessToken("");
              handleTestConnection("ai");
            }}
            disabled={testingConnection === "ai"}
            className="api-panel__button"
          >
            {testingConnection === "ai" ? "Testing..." : "Save AI Settings"}
          </button>
        </div>
        <p className="api-panel__helper">
          Gemini Flash-Lite handles low-cost scan triage, while Gemini Pro handles deeper reasoning for trading and social tasks.
        </p>
        <p className="api-panel__helper">
          Current status: Gemini {geminiApiConnected ? "connected" : "not connected"}.
        </p>
      </div>

      <div className={`api-panel__section ${activeTab === "rules" ? "" : "api-panel__section--hidden"}`}>
        <div className="api-panel__header">
          <h4>AI Operating Rules</h4>
        </div>
        <div className="api-panel__inputs">
          <label className="api-panel__field">
            <span className="api-panel__field-label">Global AI Rules</span>
            <textarea
              placeholder="Add always-on rules, brand voice, hard constraints, and context the assistant should follow across the dashboard."
              value={globalRules}
              onChange={(e) => setGlobalRules(e.target.value)}
              className="api-panel__textarea"
              rows={5}
            />
          </label>
          <label className="api-panel__field">
            <span className="api-panel__field-label">Social Media Agent Brief</span>
            <textarea
              placeholder="Add audience context, positioning, banned claims, tone, hooks, product facts, and posting guidance for X, Threads, Reddit, and other social tasks."
              value={socialRules}
              onChange={(e) => setSocialRules(e.target.value)}
              className="api-panel__textarea"
              rows={6}
            />
          </label>
          <label className="api-panel__field">
            <span className="api-panel__field-label">Workspace Timezone</span>
            <input
              type="text"
              placeholder="Asia/Kuala_Lumpur"
              value={timezoneValue}
              onChange={(e) => setTimezoneValue(e.target.value)}
              className="api-panel__input"
            />
          </label>
          <p className="api-panel__helper">
            Use an IANA timezone like `Asia/Kuala_Lumpur`, `Europe/London`, or `America/New_York`. Telegram AI scheduling and relative times will follow this setting.
          </p>
          <p className="api-panel__helper">
            These rules are stored at the workspace level so the dashboard assistant can follow them whenever it writes, plans, or reviews AI-driven work.
          </p>
          <div className="api-panel__button-row">
            <button
              onClick={async () => {
                setSavingRules(true);
                try {
                  await onSave?.({
                    global_ai_rules: globalRules,
                    social_agent_rules: socialRules,
                    workspace_timezone: timezoneValue,
                  });
                } finally {
                  setSavingRules(false);
                }
              }}
              disabled={savingRules}
              className="api-panel__button"
            >
              {savingRules ? "Saving..." : "Save Rules"}
            </button>
          </div>
          {syncMessage ? <p className="api-panel__helper">{syncMessage}</p> : null}
        </div>
      </div>

      <div className={`api-panel__section ${activeTab === "trading" ? "" : "api-panel__section--hidden"}`}>
        <div className="api-panel__header">
          <h4>cTrader Workspace Connection</h4>
          <span className={`api-panel__status ${ctraderConnected ? "connected" : "disconnected"}`}>
            {ctraderConnected ? "✓ Connected" : "○ Not Connected"}
          </span>
        </div>
        <div className="api-panel__inputs">
          <input
            type="text"
            placeholder="cTrader Client ID"
            value={ctraderClientIdValue}
            onChange={(e) => setCtraderClientIdValue(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="password"
            placeholder={
              ctraderClientSecretSaved
                ? "Saved cTrader client secret on file. Enter a new one only to replace it."
                : "cTrader Client Secret"
            }
            value={ctraderClientSecret}
            onChange={(e) => setCtraderClientSecret(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="password"
            placeholder={
              ctraderAccessTokenSaved
                ? "Saved cTrader access token on file. Enter a new one only to replace it."
                : "cTrader Access Token"
            }
            value={ctraderAccessToken}
            onChange={(e) => setCtraderAccessToken(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="text"
            placeholder="Current cTrader Account ID"
            value={ctraderAccountIdValue}
            onChange={(e) => setCtraderAccountIdValue(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="text"
            placeholder="cTrader Demo Account ID"
            value={ctraderDemoAccountIdValue}
            onChange={(e) => setCtraderDemoAccountIdValue(e.target.value)}
            className="api-panel__input"
          />
          <input
            type="text"
            placeholder="cTrader Live Account ID"
            value={ctraderLiveAccountIdValue}
            onChange={(e) => setCtraderLiveAccountIdValue(e.target.value)}
            className="api-panel__input"
          />
          {ctraderClientSecretSaved || ctraderAccessTokenSaved ? (
            <p className="api-panel__helper">
              Saved cTrader secrets stay hidden. Enter new values only when you want to replace them.
            </p>
          ) : null}
          <p className="api-panel__helper">
            The trading agent will use the demo account when a strategy runs in demo mode, and the live account when a strategy runs in live mode.
          </p>
          <button
            onClick={async () => {
              setSavingCtrader(true);
              try {
                await onSave?.(buildPayload());
                setCtraderClientSecret("");
                setCtraderAccessToken("");
              } finally {
                setSavingCtrader(false);
              }
            }}
            disabled={savingCtrader}
            className="api-panel__button"
          >
            {savingCtrader ? "Saving..." : "Save cTrader Connection"}
          </button>
        </div>
      </div>

      <div className={`api-panel__section ${activeTab === "agent" ? "" : "api-panel__section--hidden"}`}>
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
            placeholder={
              tradingAgentTokenSaved
                ? "Saved token on file. Enter a new token only to replace it."
                : "Trading agent sync token"
            }
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
                  setAgentToken("");
                  setCtraderClientSecret("");
                  setCtraderAccessToken("");
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
                    setAgentToken("");
                    setCtraderClientSecret("");
                    setCtraderAccessToken("");
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
