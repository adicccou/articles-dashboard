const DASHBOARD_MEDIA_HOSTS = new Set([
  "articles-dashboard.adilet-melisov.workers.dev",
  "dashboard.adilet-melisov.workers.dev",
  "marketing-dashboard.adilet-melisov.workers.dev",
  "oilor.app",
  "www.oilor.app",
]);

const MEDIA_CACHE_MARKER = "dashboard-media";
const PRIMARY_DASHBOARD_ORIGIN = "https://articles-dashboard.adilet-melisov.workers.dev";
const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function currentOrigin() {
  return typeof window === "undefined" ? null : window.location.origin;
}

function isLocalDevelopmentOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    return LOCAL_DEVELOPMENT_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function normalizeDashboardMediaUrl(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^(blob|data):/i.test(value)) return value;

  const origin = currentOrigin();
  const shouldUseHostedDashboardOrigin = isLocalDevelopmentOrigin(origin);
  const base = shouldUseHostedDashboardOrigin ? PRIMARY_DASHBOARD_ORIGIN : origin ?? PRIMARY_DASHBOARD_ORIGIN;

  try {
    const url = new URL(value, base);
    const isCurrentOrigin = origin ? url.origin === origin : false;
    const isKnownDashboardHost = DASHBOARD_MEDIA_HOSTS.has(url.hostname);
    const isRelativeDashboardMedia = value.startsWith("/api/media/");
    const isDashboardMedia =
      url.pathname.startsWith("/api/media/") &&
      (isRelativeDashboardMedia || isKnownDashboardHost || isCurrentOrigin);

    if (!isDashboardMedia) return value;

    if (shouldUseHostedDashboardOrigin) {
      const hosted = new URL(PRIMARY_DASHBOARD_ORIGIN);
      url.protocol = hosted.protocol;
      url.host = hosted.host;
    } else if (origin) {
      const current = new URL(origin);
      url.protocol = current.protocol;
      url.host = current.host;
    }
    url.searchParams.set("source", MEDIA_CACHE_MARKER);
    return url.toString();
  } catch {
    return value;
  }
}
