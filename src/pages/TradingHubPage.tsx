import { useState } from "react";
import { SectionTabs } from "../components/SectionTabs";
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
        <SectionTabs
          activeId={activeTab}
          ariaLabel="Trading sections"
          className="trading-hub__tabs"
          tabClassName="trading-hub__tab"
          activeTabClassName="trading-hub__tab--active"
          onChange={setActiveTab}
          items={TRADING_TABS}
        />
      </section>

      {activeTab === "workers" ? <TradingPage /> : <MlTradingPage />}
    </div>
  );
}
