export const SOCIAL_AUTOSCHEDULE_PLATFORMS = new Set([
  "twitter",
  "threads",
  "reddit",
  "instagram",
  "linkedin",
]);

const ACTIVE_PLANNER_STATUSES = new Set(["planned", "drafting", "approved", "scheduled"]);
const AUTO_SCHEDULE_HOURS = [10, 13, 16];
const AUTO_SCHEDULE_MIN_GAP_MS = 90 * 60 * 1000;
const AUTO_SCHEDULE_MAX_ITEMS_PER_DAY = 1;
const AUTO_SCHEDULE_LOOKAHEAD_DAYS = 14;

type ScheduledPlannerLike = {
  id?: number;
  item_type?: string | null;
  platform?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
};

export function normalizeSocialSchedulePlatform(platform: string | null | undefined): string {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (["x", "twitter/x"].includes(normalized)) return "twitter";
  if (normalized === "thread") return "threads";
  if (normalized === "ig") return "instagram";
  return normalized;
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function collectActiveScheduledSocialSlots(
  items: ScheduledPlannerLike[],
  excludeItemId?: number,
  options: { platform?: string | null } = {},
): string[] {
  const requestedPlatform = normalizeSocialSchedulePlatform(options.platform);
  return items
    .filter((item) => item.id !== excludeItemId)
    .filter((item) => String(item.item_type ?? "post").trim().toLowerCase() === "post")
    .filter((item) => SOCIAL_AUTOSCHEDULE_PLATFORMS.has(normalizeSocialSchedulePlatform(item.platform)))
    .filter((item) => !requestedPlatform || normalizeSocialSchedulePlatform(item.platform) === requestedPlatform)
    .filter((item) => ACTIVE_PLANNER_STATUSES.has(String(item.status ?? "").trim().toLowerCase()))
    .map((item) => item.scheduled_for)
    .filter((value): value is string => Boolean(value));
}

export function chooseAutoSchedule(existingSlots: string[]) {
  const now = new Date();
  const minLead = new Date(now.getTime() + 45 * 60 * 1000);
  const scheduled = existingSlots
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  for (let offset = 0; offset < AUTO_SCHEDULE_LOOKAHEAD_DAYS; offset += 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);

    const dayItems = scheduled.filter((item) => sameDay(item, day));
    if (dayItems.length >= AUTO_SCHEDULE_MAX_ITEMS_PER_DAY) continue;

    for (const hour of AUTO_SCHEDULE_HOURS) {
      const candidate = new Date(day);
      candidate.setHours(hour, 0, 0, 0);
      if (candidate.getTime() <= minLead.getTime()) continue;

      const tooClose = dayItems.some((item) => Math.abs(item.getTime() - candidate.getTime()) < AUTO_SCHEDULE_MIN_GAP_MS);
      if (tooClose) continue;
      return candidate;
    }
  }

  const fallback = new Date(minLead);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(AUTO_SCHEDULE_HOURS[0], 0, 0, 0);
  return fallback;
}
