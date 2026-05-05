import { useEffect, useState } from "react";
import { RedditAgentPage } from "./RedditAgentPage";
import { TwitterAgentPage } from "./TwitterAgentPage";
import { ThreadsAgentPage } from "./ThreadsAgentPage";
import "../styles/social-agents-page.css";

type Platform = "reddit" | "twitter" | "threads" | "linkedin";

const PLATFORMS: { id: Platform; label: string; icon: string; available: boolean }[] = [
  { id: "reddit",   label: "Reddit",   icon: "🟠", available: true },
  { id: "twitter",  label: "Twitter",  icon: "𝕏",  available: true },
  { id: "threads",  label: "Threads",  icon: "🧵", available: true },
  { id: "linkedin", label: "LinkedIn", icon: "💼", available: false },
];

const SOCIAL_PLATFORM_STORAGE_KEY = "dashboard:social-platform";

function readStoredPlatform(): Platform {
  if (typeof window === "undefined") return "reddit";
  const stored = window.localStorage.getItem(SOCIAL_PLATFORM_STORAGE_KEY);
  return PLATFORMS.some((platform) => platform.id === stored && platform.available)
    ? (stored as Platform)
    : "reddit";
}

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
  const [platform, setPlatform] = useState<Platform>(readStoredPlatform);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SOCIAL_PLATFORM_STORAGE_KEY, platform);
  }, [platform]);

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
        {platform === "twitter"  && <TwitterAgentPage />}
        {platform === "threads"  && <ThreadsAgentPage />}
        {platform === "linkedin" && <ComingSoon platform="LinkedIn" />}
      </div>
    </div>
  );
}
