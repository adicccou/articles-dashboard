import type { TradingRuntimeBlocker, TradingRuntimeSummary } from "./types";

function blockersOf(summary: TradingRuntimeSummary | null | undefined): TradingRuntimeBlocker[] {
  return Array.isArray(summary?.blockers) ? summary.blockers : [];
}

export function formatAgo(seconds?: number | null) {
  if (!Number.isFinite(seconds) || seconds == null) {
    return "unknown";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  return `${Math.round(seconds / 3600)}h ago`;
}

export function runtimeHeadline(summary: TradingRuntimeSummary | null | undefined) {
  if (!summary?.connected) {
    return "Disconnected";
  }
  const blockers = blockersOf(summary);
  const highestLevel = blockers.some((blocker) => blocker.level === "critical")
    ? "critical"
    : blockers.some((blocker) => blocker.level === "warning")
      ? "warning"
      : "ok";
  if (highestLevel === "critical") {
    return "Needs attention";
  }
  if (highestLevel === "warning") {
    return "Watch closely";
  }
  return "Healthy";
}

export function runtimeTone(summary: TradingRuntimeSummary | null | undefined) {
  if (!summary?.connected) {
    return "custom-lean-risk";
  }
  const blockers = blockersOf(summary);
  if (blockers.some((blocker) => blocker.level === "critical")) {
    return "custom-lean-risk";
  }
  if (blockers.some((blocker) => blocker.level === "warning")) {
    return "custom-lean-warn";
  }
  return "custom-lean-good";
}

export function topRuntimeBlockers(summary: TradingRuntimeSummary | null | undefined, limit = 3): TradingRuntimeBlocker[] {
  const blockers = blockersOf(summary);
  if (!blockers.length) {
    return [];
  }
  const priority = { critical: 0, warning: 1, info: 2 };
  return [...blockers]
    .sort((a, b) => priority[a.level] - priority[b.level] || a.message.localeCompare(b.message))
    .slice(0, limit);
}

export function summarizeCounts(counts?: Record<string, number>) {
  if (!counts) {
    return "none";
  }
  const parts = Object.entries(counts)
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}: ${value}`);
  return parts.length ? parts.join(" · ") : "none";
}
