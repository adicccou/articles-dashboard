const DASHBOARD_MEDIA_HOSTS = new Set([
  "oilor.app",
  "www.oilor.app",
  "dashboard.adilet-melisov.workers.dev",
  "marketing-dashboard.adilet-melisov.workers.dev",
]);

const MEDIA_CACHE_MARKER = "dashboard-media";

function currentOrigin() {
  return typeof window === "undefined" ? null : window.location.origin;
}

export function normalizeDashboardMediaUrl(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^(blob|data):/i.test(value)) return value;

  const origin = currentOrigin();
  const base = origin ?? "https://oilor.app";

  try {
    const url = new URL(value, base);
    const isCurrentOrigin = origin ? url.origin === origin : false;
    const isKnownDashboardHost = DASHBOARD_MEDIA_HOSTS.has(url.hostname);
    const isRelativeDashboardMedia = value.startsWith("/api/media/");
    const isDashboardMedia =
      url.pathname.startsWith("/api/media/") &&
      (isRelativeDashboardMedia || isKnownDashboardHost || isCurrentOrigin);

    if (!isDashboardMedia) return value;

    if (origin) {
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
