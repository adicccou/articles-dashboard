import React, { useEffect, useRef } from "react";
import logoMark from "../assets/my-logo.svg";
import styles from "../styles/topnav.module.css";

export type NavView =
  | "articles"
  | "reddit"
  | "studio"
  | "trading"
  | "planner"
  | "statistics";

interface TopNavProps {
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentView,
  onNavigate,
  onOpenSettings,
  onLogout,
}) => {
  const activeNavRef = useRef<HTMLButtonElement | null>(null);
  const navItems: Array<{ label: string; view: NavView; rightStart?: boolean }> = [
    { label: "Articles", view: "articles" },
    { label: "Social Agents", view: "reddit" },
    { label: "Studio", view: "studio" },
    { label: "Trading", view: "trading", rightStart: true },
    { label: "Scheduler", view: "planner" },
    { label: "Statistics", view: "statistics" },
  ];

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
          {navItems.map(({ label, view, rightStart }) => (
            <button
              key={view}
              className={`${styles.navItem} ${
                currentView === view ? styles.active : ""
              } ${rightStart ? styles.navItemRightStart : ""}`}
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
