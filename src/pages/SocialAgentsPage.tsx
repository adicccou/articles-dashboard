import { useState } from "react";
import { RedditAgentPage } from "./RedditAgentPage";
import "../styles/social-agents-page.css";

type Platform = "reddit" | "twitter" | "threads" | "linkedin";

const PLATFORMS: { id: Platform; label: string; icon: string; available: boolean }[] = [
  { id: "reddit",   label: "Reddit",   icon: "🟠", available: true },
  { id: "twitter",  label: "Twitter",  icon: "𝕏",  available: false },
  { id: "threads",  label: "Threads",  icon: "🧵", available: false },
  { id: "linkedin", label: "LinkedIn", icon: "💼", available: false },
];

function ComingSoon({ platform }: { platform: string }) {
  return (
    <section className="panel">
      <div className="social-coming-soon">
        <span className="social-coming-soon__label">{platform} agent</span>
        <p className="social-coming-soon__text">Coming soon</p>
      </div>
    </section>
  );
}

export function SocialAgentsPage() {
  const [platform, setPlatform] = useState<Platform>("reddit");

  return (
    <div className="social-agents-page">
      <div className="social-platform-tabs">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            className={`social-tab ${platform === p.id ? "social-tab--active" : ""} ${!p.available ? "social-tab--disabled" : ""}`}
            onClick={() => p.available && setPlatform(p.id)}
            disabled={!p.available}
            title={!p.available ? "Coming soon" : undefined}
          >
            <span className="social-tab__icon">{p.icon}</span>
            {p.label}
            {!p.available && <span className="social-tab__badge">soon</span>}
          </button>
        ))}
      </div>

      <div className="social-tab-content">
        {platform === "reddit"   && <RedditAgentPage />}
        {platform === "twitter"  && <ComingSoon platform="Twitter" />}
        {platform === "threads"  && <ComingSoon platform="Threads" />}
        {platform === "linkedin" && <ComingSoon platform="LinkedIn" />}
      </div>
    </div>
  );
}
