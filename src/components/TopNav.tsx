import React from "react";
import logoMark from "../assets/my-logo.svg";
import styles from "../styles/topnav.module.css";

export type NavView =
  | "articles"
  | "reddit"
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
  const navItems: Array<{ label: string; view: NavView }> = [
    { label: "Articles", view: "articles" },
    { label: "Reddit Agents", view: "reddit" },
    { label: "Trading", view: "trading" },
    { label: "Scheduler", view: "planner" },
    { label: "Statistics", view: "statistics" },
  ];

  return (
    <nav className={styles.topnav}>
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
