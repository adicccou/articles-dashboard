import React, { useEffect, useRef } from "react";
import { ArrowRightOnRectangleIcon, Cog6ToothIcon } from "@heroicons/react/24/solid";
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
    { label: "Studio", view: "studio" },
    { label: "Replies", view: "replies" },
    { label: "Planner", view: "planner" },
    { label: "Statistics", view: "statistics" },
    { label: "Articles", view: "articles" },
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
    <nav className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur" aria-label="Dashboard navigation">
      <div className="mx-auto flex min-h-16 w-full max-w-[1440px] items-center gap-4 px-5 sm:px-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center" aria-label="Oilor Studio logo">
          <img src={logoMark} alt="Oilor Studio" className="h-8 w-8 object-contain" />
        </div>

        <div className="dashboard-nav-menu flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {navItems.map(({ label, view }) => (
            <button
              key={view}
              className={[
                "dashboard-nav-item shrink-0 px-3 py-2 text-sm font-semibold transition",
                currentView === view
                  ? "dashboard-nav-item--active text-slate-950"
                  : "text-slate-600 hover:text-slate-950",
              ].join(" ")}
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

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full border-0 bg-transparent p-0 text-slate-500 shadow-none transition hover:bg-transparent hover:text-slate-950"
            onClick={onOpenSettings}
            aria-label="Open settings"
            title="Settings"
          >
            <Cog6ToothIcon aria-hidden="true" className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="dashboard-icon-button"
            onClick={onLogout}
            aria-label="Sign out"
            title="Sign out"
          >
            <ArrowRightOnRectangleIcon aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
};
