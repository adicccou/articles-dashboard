import { useMemo, useState, type CSSProperties } from "react";
import { APIConnectionPanel, type SettingsTabId } from "./APIConnectionPanel";
import type { DashboardSurface } from "../lib/surface";
import type { AppSettingsInput } from "../lib/types";

type SettingsModalProps = {
  surface: DashboardSurface;
  settings: {
    ai_api_connected: boolean;
    gemini_api_connected?: boolean;
    gemini_flash_model?: string;
    gemini_pro_model?: string;
    global_ai_rules: string;
    social_agent_rules: string;
    workspace_timezone: string;
    trading_agent_url: string;
    trading_agent_connected: boolean;
    trading_agent_token_saved?: boolean;
    ctrader_client_id: string;
    ctrader_account_id: string;
    ctrader_demo_account_id: string;
    ctrader_live_account_id: string;
    ctrader_connected: boolean;
    ctrader_client_secret_saved?: boolean;
    ctrader_access_token_saved?: boolean;
  };
  syncMessage: string | null;
  onClose: () => void;
  onSave: (payload: AppSettingsInput) => Promise<unknown>;
  onSyncAgent: () => Promise<unknown>;
};

export function SettingsModal({
  surface,
  settings,
  syncMessage,
  onClose,
  onSave,
  onSyncAgent,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  const tabs = useMemo(
    () => {
      const allTabs = [
        {
          id: "general" as const,
          label: "General",
          eyebrow: "Workspace",
          status: settings.workspace_timezone ? settings.workspace_timezone : "Needs setup",
          tone: settings.workspace_timezone ? "connected" : "disconnected",
        },
        {
          id: "ai" as const,
          label: "AI API",
          eyebrow: "AI API",
          status: settings.ai_api_connected ? "Connected" : "Needs setup",
          tone: settings.ai_api_connected ? "connected" : "disconnected",
        },
        {
          id: "rules" as const,
          label: "Rules",
          eyebrow: "AI context",
          status: settings.global_ai_rules || settings.social_agent_rules ? "Configured" : "Empty",
          tone: settings.global_ai_rules || settings.social_agent_rules ? "connected" : "disconnected",
        },
        {
          id: "trading" as const,
          label: "Trading Platform",
          eyebrow: "cTrader access",
          status: settings.ctrader_connected ? "Connected" : "Needs setup",
          tone: settings.ctrader_connected ? "connected" : "disconnected",
        },
        {
          id: "agent" as const,
          label: "Agent Sync",
          eyebrow: "Droplet bridge",
          status: settings.trading_agent_connected ? "Connected" : "Needs setup",
          tone: settings.trading_agent_connected ? "connected" : "disconnected",
        },
      ];
      const allowedTabs: SettingsTabId[] =
        surface === "trading" ? ["general", "ai", "trading", "agent"] : ["general", "ai", "rules"];
      return allTabs.filter((tab) => allowedTabs.includes(tab.id));
    },
    [
      settings.ai_api_connected,
      settings.ctrader_connected,
      settings.global_ai_rules,
      settings.social_agent_rules,
      settings.trading_agent_connected,
      settings.workspace_timezone,
      surface,
    ],
  );

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

        <div
          className="settings-modal__tabs"
          role="tablist"
          aria-label="Settings sections"
          style={{ "--settings-tab-count": tabs.length } as CSSProperties}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`settings-modal__tab ${activeTab === tab.id ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="settings-modal__tab-eyebrow">{tab.eyebrow}</span>
              <span className="settings-modal__tab-label">{tab.label}</span>
              <span className={`settings-modal__tab-status ${tab.tone}`}>{tab.status}</span>
            </button>
          ))}
        </div>

        <APIConnectionPanel
          activeTab={activeTab}
          surface={surface}
          aiApiConnected={settings.ai_api_connected}
          geminiApiConnected={settings.gemini_api_connected}
          geminiFlashModel={settings.gemini_flash_model}
          geminiProModel={settings.gemini_pro_model}
          globalAiRules={settings.global_ai_rules}
          socialAgentRules={settings.social_agent_rules}
          workspaceTimezone={settings.workspace_timezone}
          tradingAgentUrl={settings.trading_agent_url}
          tradingAgentConnected={settings.trading_agent_connected}
          tradingAgentTokenSaved={settings.trading_agent_token_saved}
          ctraderClientId={settings.ctrader_client_id}
          ctraderAccountId={settings.ctrader_account_id}
          ctraderDemoAccountId={settings.ctrader_demo_account_id}
          ctraderLiveAccountId={settings.ctrader_live_account_id}
          ctraderConnected={settings.ctrader_connected}
          ctraderClientSecretSaved={settings.ctrader_client_secret_saved}
          ctraderAccessTokenSaved={settings.ctrader_access_token_saved}
          syncMessage={syncMessage}
          onSave={onSave}
          onSyncAgent={onSyncAgent}
          title="AI API Connection"
          description="One shared AI API configuration for the dashboard and the Python trading agent. Save it here once, then sync it to the agent."
        />
      </div>
    </div>
  );
}
