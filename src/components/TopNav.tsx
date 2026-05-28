import React, { useEffect, useRef } from "react";
import {
  CalendarDaysIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  CurrencyDollarIcon,
  GlobeAltIcon,
  NewspaperIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import logoMark from "../assets/my-logo.svg";
import type { DashboardSurface } from "../lib/surface";
import { getSurfaceViews } from "../lib/surface";

export type NavView =
  | "articles"
  | "reddit"
  | "replies"
  | "studio"
  | "config"
  | "trading"
  | "planner"
  | "statistics";

interface TopNavProps {
  currentView: NavView;
  surface: DashboardSurface;
  collapsed: boolean;
  onNavigate: (view: NavView) => void;
  onToggleCollapsed: () => void;
}

export const NAV_ITEMS: Array<{ label: string; view: NavView }> = [
  { label: "Trading", view: "trading" },
  { label: "Studio", view: "studio" },
  { label: "Replies", view: "replies" },
  { label: "Planner", view: "planner" },
  { label: "Statistics", view: "statistics" },
  { label: "Articles", view: "articles" },
  { label: "Config", view: "config" },
];

export function getNavLabel(view: NavView) {
  return NAV_ITEMS.find((item) => item.view === view)?.label ?? "Dashboard";
}

const navIcons: Record<NavView, typeof SparklesIcon> = {
  articles: NewspaperIcon,
  reddit: GlobeAltIcon,
  replies: ChatBubbleLeftRightIcon,
  studio: SparklesIcon,
  config: Cog6ToothIcon,
  trading: CurrencyDollarIcon,
  planner: CalendarDaysIcon,
  statistics: ChartBarIcon,
};

export const TopNav: React.FC<TopNavProps> = ({
  currentView,
  surface,
  collapsed,
  onNavigate,
  onToggleCollapsed,
}) => {
  const activeNavRef = useRef<HTMLButtonElement | null>(null);
  const allowedViews = getSurfaceViews(surface);
  const navItems = NAV_ITEMS.filter((item) => allowedViews.includes(item.view));

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    activeNavRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [currentView]);

  return (
    <nav className="shell-sidebar-nav" aria-label="Dashboard navigation">
      <div className="shell-sidebar-nav__brand" aria-label="Oilor Studio logo">
        <img src={logoMark} alt="Oilor Studio" className="shell-sidebar-nav__logo" />
      </div>

      <div className="shell-sidebar-nav__items">
        {navItems.map(({ label, view }) => {
          const Icon = navIcons[view];
          return (
            <button
              key={view}
              className={[
                "shell-sidebar-nav__item",
                currentView === view ? "shell-sidebar-nav__item--active" : "",
              ].join(" ")}
              onClick={() => onNavigate(view)}
              ref={(node) => {
                if (currentView === view) {
                  activeNavRef.current = node;
                }
              }}
              aria-current={currentView === view ? "page" : undefined}
              aria-label={label}
              title={collapsed ? label : undefined}
            >
              <Icon className="shell-sidebar-nav__icon" aria-hidden="true" />
              <span className="shell-sidebar-nav__label">{label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="shell-sidebar-nav__collapse"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRightIcon aria-hidden="true" /> : <ChevronLeftIcon aria-hidden="true" />}
        <span className="shell-sidebar-nav__collapse-label">{collapsed ? "Expand" : "Hide sidebar"}</span>
      </button>
    </nav>
  );
};
