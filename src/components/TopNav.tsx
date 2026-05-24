import React, { useEffect, useRef } from "react";
import logoMark from "../assets/my-logo.svg";
import type { DashboardSurface } from "../lib/surface";
import { getSurfaceViews } from "../lib/surface";
import styles from "../styles/topnav.module.css";

export type NavView =
  | "articles"
  | "reddit"
  | "studio"
  | "config"
  | "trading"
  | "planner"
  | "statistics";

interface TopNavProps {
  currentView: NavView;
  surface: DashboardSurface;
  onNavigate: (view: NavView) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentView,
  surface,
  onNavigate,
  onOpenSettings,
  onLogout,
}) => {
  const activeNavRef = useRef<HTMLButtonElement | null>(null);
  const allNavItems: Array<{ label: string; view: NavView }> = [
    { label: "Trading", view: "trading" },
    { label: "Articles", view: "articles" },
    { label: "Studio", view: "studio" },
    { label: "Scheduler", view: "planner" },
    { label: "Statistics", view: "statistics" },
    { label: "Config", view: "config" },
  ];
  const allowedViews = getSurfaceViews(surface);
  const navItems = allNavItems.filter((item) => allowedViews.includes(item.view));

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 768px)").matches) return;
    activeNavRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [currentView]);

  return (
    <nav className={styles.topnav} aria-label="Dashboard navigation">
      <div className={styles.container}>
        <div className={styles.logo} aria-label="BlogPoster logo">
          <img src={logoMark} alt="BlogPoster" className={styles.logoImage} />
        </div>

        <div className={styles.navItems}>
          {navItems.map(({ label, view }) => (
            <button
              key={view}
              className={`${styles.navItem} ${
                currentView === view ? styles.active : ""
              }`}
              onClick={() => onNavigate(view)}
              ref={(node) => {
                if (currentView === view) {
                  activeNavRef.current = node;
                }
              }}
              aria-current={currentView === view ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.userMenu}>
          <button
            type="button"
            className={styles.settingsBtn}
            onClick={onOpenSettings}
            aria-label="Open settings"
            title="Settings"
          >
            ⚙
          </button>
          <button className={styles.logoutBtn} onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
};
