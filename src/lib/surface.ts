import type { NavView } from "../components/TopNav";

export type DashboardSurface = "marketing" | "trading";

export const MARKETING_VIEWS: NavView[] = ["articles", "reddit", "studio", "planner", "statistics", "config"];
export const TRADING_VIEWS: NavView[] = ["trading"];

export function getDashboardSurface(): DashboardSurface {
  if (typeof window === "undefined") return "marketing";

  const params = new URLSearchParams(window.location.search);
  const forcedSurface = params.get("surface");
  if (forcedSurface === "trading" || forcedSurface === "marketing") {
    return forcedSurface;
  }

  return window.location.hostname.startsWith("trading.") ? "trading" : "marketing";
}

export function getSurfaceViews(surface: DashboardSurface): NavView[] {
  return surface === "trading" ? TRADING_VIEWS : MARKETING_VIEWS;
}

export function getDefaultView(surface: DashboardSurface): NavView {
  return surface === "trading" ? "trading" : "articles";
}

export function isViewAllowedForSurface(view: NavView, surface: DashboardSurface): boolean {
  return getSurfaceViews(surface).includes(view);
}

export function normalizeStoredView(value: string | null): NavView | null {
  const normalized = value === "ml-trading" ? "trading" : value;
  return normalized === "articles" ||
    normalized === "reddit" ||
    normalized === "studio" ||
    normalized === "config" ||
    normalized === "trading" ||
    normalized === "planner" ||
    normalized === "statistics"
    ? normalized
    : null;
}
