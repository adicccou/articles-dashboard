import type { NavView } from "../components/TopNav";

export type DashboardSurface = "articles" | "marketing" | "trading";

export const ARTICLES_VIEWS: NavView[] = ["articles", "statistics", "config"];
export const MARKETING_VIEWS: NavView[] = ["reddit", "replies", "studio", "planner", "statistics", "config"];
export const TRADING_VIEWS: NavView[] = ["trading"];

function normalizeSurface(value: unknown): DashboardSurface | null {
  return value === "articles" || value === "trading" || value === "marketing" ? value : null;
}

export function getConfiguredDashboardSurface(): DashboardSurface | null {
  return normalizeSurface(import.meta.env.VITE_DASHBOARD_SURFACE);
}

export function getDashboardSurface(): DashboardSurface {
  const configuredSurface = getConfiguredDashboardSurface();
  if (configuredSurface) return configuredSurface;

  if (typeof window === "undefined") return "marketing";

  const params = new URLSearchParams(window.location.search);
  const forcedSurface = normalizeSurface(params.get("surface"));
  if (forcedSurface) {
    return forcedSurface;
  }

  const hostname = window.location.hostname;
  if (hostname.startsWith("articles.") || hostname.includes("articles-dashboard")) return "articles";
  return hostname.startsWith("trading.") || hostname.includes("trading-dashboard") ? "trading" : "marketing";
}

export function shouldPersistSurfaceInUrl(): boolean {
  return getConfiguredDashboardSurface() === null;
}

export function getSurfaceViews(surface: DashboardSurface): NavView[] {
  if (surface === "articles") return ARTICLES_VIEWS;
  return surface === "trading" ? TRADING_VIEWS : MARKETING_VIEWS;
}

export function getDefaultView(surface: DashboardSurface): NavView {
  if (surface === "articles") return "articles";
  return surface === "trading" ? "trading" : "planner";
}

export function isViewAllowedForSurface(view: NavView, surface: DashboardSurface): boolean {
  return getSurfaceViews(surface).includes(view);
}

export function normalizeStoredView(value: string | null): NavView | null {
  const normalized = value === "ml-trading" ? "trading" : value;
  return normalized === "articles" ||
    normalized === "reddit" ||
    normalized === "replies" ||
    normalized === "studio" ||
    normalized === "config" ||
    normalized === "trading" ||
    normalized === "planner" ||
    normalized === "statistics"
    ? normalized
    : null;
}
