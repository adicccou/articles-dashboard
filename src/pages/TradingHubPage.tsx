import { useState } from "react";
import { TradingPage } from "./TradingPage";
import { MlTradingPage } from "./MlTradingPage";
import "../styles/trading-hub-page.css";

type TradingHubTab = "workers" | "ml-agents";

const TRADING_TABS: Array<{ id: TradingHubTab; label: string }> = [
  { id: "workers", label: "Workers" },
  { id: "ml-agents", label: "ML Agents" },
];

export function TradingHubPage() {
  const [activeTab, setActiveTab] = useState<TradingHubTab>("workers");

  return (
    <div className="trading-hub stack">
      <section className="panel trading-hub__topbar">
        <div>
          <p className="eyebrow">Trading</p>
          <h1>Trading</h1>
        </div>
        <div className="ui-tabs__list trading-hub__tabs" role="tablist" aria-label="Trading sections">
          {TRADING_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`ui-tab trading-hub__tab ${activeTab === tab.id ? "ui-tab--active trading-hub__tab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "workers" ? <TradingPage /> : <MlTradingPage />}
    </div>
  );
}
