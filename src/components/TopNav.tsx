import React from "react";
import styles from "../styles/topnav.module.css";

export type NavView =
  | "articles"
  | "reddit"
  | "trading"
  | "planner"
  | "analytics";

interface TopNavProps {
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  username?: string;
  onLogout: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentView,
  onNavigate,
  username,
  onLogout,
}) => {
  const navItems: Array<{ label: string; view: NavView }> = [
    { label: "Articles", view: "articles" },
    { label: "Reddit Agents", view: "reddit" },
    { label: "Trading", view: "trading" },
    { label: "Planner", view: "planner" },
    { label: "Analytics", view: "analytics" },
  ];

  return (
    <nav className={styles.topnav}>
      <div className={styles.container}>
        <div className={styles.logo}>📝 BlogPoster</div>

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
          <span className={styles.username}>{username}</span>
          <button className={styles.logoutBtn} onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
};
