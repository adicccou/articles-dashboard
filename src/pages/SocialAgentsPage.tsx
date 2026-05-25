import { useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  PlusIcon,
} from "@heroicons/react/24/solid";
import type { IconType } from "react-icons";
import { FaLinkedinIn } from "react-icons/fa6";
import { SiReddit, SiThreads, SiX } from "react-icons/si";
import { RedditAgentPage } from "./RedditAgentPage";
import { TwitterAgentPage } from "./TwitterAgentPage";
import { ThreadsAgentPage } from "./ThreadsAgentPage";
import type { SocialAgentToolbarHandle } from "../components/SocialPublisherWorkspace";
import "../styles/social-agents-page.css";

type Platform = "reddit" | "twitter" | "threads" | "linkedin";

const PLATFORMS: { id: Platform; label: string; Icon: IconType; available: boolean }[] = [
  { id: "reddit", label: "Reddit", Icon: SiReddit, available: true },
  { id: "twitter", label: "Twitter", Icon: SiX, available: true },
  { id: "threads", label: "Threads", Icon: SiThreads, available: true },
  { id: "linkedin", label: "LinkedIn", Icon: FaLinkedinIn, available: false },
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
  const redditToolbarRef = useRef<SocialAgentToolbarHandle>(null);
  const twitterToolbarRef = useRef<SocialAgentToolbarHandle>(null);
  const threadsToolbarRef = useRef<SocialAgentToolbarHandle>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SOCIAL_PLATFORM_STORAGE_KEY, platform);
  }, [platform]);

  const activeToolbarRef = platform === "reddit"
    ? redditToolbarRef
    : platform === "twitter"
      ? twitterToolbarRef
      : platform === "threads"
        ? threadsToolbarRef
        : null;

  return (
    <div className="social-agents-page">
      <div className="social-platform-bar">
        <div className="ui-tabs__list social-platform-tabs">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              className={`ui-tab social-tab ${platform === p.id ? "ui-tab--active social-tab--active" : ""} ${!p.available ? "ui-tab--disabled social-tab--disabled" : ""}`}
              onClick={() => p.available && setPlatform(p.id)}
              disabled={!p.available}
              title={!p.available ? "Coming soon" : undefined}
            >
              <p.Icon className={`social-tab__icon social-tab__icon--${p.id}`} aria-hidden="true" />
              {p.label}
              {!p.available && <span className="ui-tab__badge social-tab__badge">soon</span>}
            </button>
          ))}
        </div>

        {activeToolbarRef ? (
          <div className="social-platform-actions">
            <button type="button" onClick={() => activeToolbarRef.current?.openComposer()}>
              <PlusIcon aria-hidden="true" className="h-4 w-4" />
              Post
            </button>
            <button
              type="button"
              aria-label="Refresh"
              className="button-secondary social-icon-button"
              title="Refresh"
              onClick={() => activeToolbarRef.current?.reload()}
            >
              <ArrowPathIcon aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="social-tab-content">
        {platform === "reddit"   && <RedditAgentPage ref={redditToolbarRef} />}
        {platform === "twitter"  && <TwitterAgentPage ref={twitterToolbarRef} />}
        {platform === "threads"  && <ThreadsAgentPage ref={threadsToolbarRef} />}
        {platform === "linkedin" && <ComingSoon platform="LinkedIn" />}
      </div>
    </div>
  );
}
