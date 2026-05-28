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
import {
  CalendarDaysIcon as CalendarDaysSolidIcon,
  ChartBarIcon as ChartBarSolidIcon,
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolidIcon,
  Cog6ToothIcon as Cog6ToothSolidIcon,
  CurrencyDollarIcon as CurrencyDollarSolidIcon,
  GlobeAltIcon as GlobeAltSolidIcon,
  NewspaperIcon as NewspaperSolidIcon,
  SparklesIcon as SparklesSolidIcon,
} from "@heroicons/react/24/solid";
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

type NavIcon = typeof SparklesIcon;

const navIcons: Record<NavView, { Icon: NavIcon; ActiveIcon: NavIcon }> = {
  articles: { Icon: NewspaperIcon, ActiveIcon: NewspaperSolidIcon },
  reddit: { Icon: GlobeAltIcon, ActiveIcon: GlobeAltSolidIcon },
  replies: { Icon: ChatBubbleLeftRightIcon, ActiveIcon: ChatBubbleLeftRightSolidIcon },
  studio: { Icon: SparklesIcon, ActiveIcon: SparklesSolidIcon },
  config: { Icon: Cog6ToothIcon, ActiveIcon: Cog6ToothSolidIcon },
  trading: { Icon: CurrencyDollarIcon, ActiveIcon: CurrencyDollarSolidIcon },
  planner: { Icon: CalendarDaysIcon, ActiveIcon: CalendarDaysSolidIcon },
  statistics: { Icon: ChartBarIcon, ActiveIcon: ChartBarSolidIcon },
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
          const isActive = currentView === view;
          const Icon = isActive ? navIcons[view].ActiveIcon : navIcons[view].Icon;
          return (
            <button
              key={view}
              className={[
                "shell-sidebar-nav__item",
                isActive ? "shell-sidebar-nav__item--active" : "",
              ].join(" ")}
              onClick={() => onNavigate(view)}
              ref={(node) => {
                if (isActive) {
                  activeNavRef.current = node;
                }
              }}
              aria-current={isActive ? "page" : undefined}
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
