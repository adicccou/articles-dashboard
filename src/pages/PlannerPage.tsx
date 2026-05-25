import { Fragment, useEffect, useMemo, useState } from "react";
import { PencilSquareIcon, TrashIcon } from "@heroicons/react/24/solid";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { formatDisplayDateTime, formatDisplayTime, formatMonthDay, formatMonthYear, formatWeekRange, formatWeekdayShort } from "../lib/datetime";
import { getPostImageUrls, isVideoMediaUrl, serializePostMediaUrls } from "../lib/socialPostMedia";
import type { PlannerItem, PlannerItemInput, RedditAccount, RedditSubscribedSubreddit, SocialAccount, SocialPost } from "../lib/types";
import "../styles/planner-page.css";

type SchedulerView = "list" | "calendar" | "week";

const schedulerPlatformOrder: Array<SocialAccount["platform"]> = ["twitter", "threads", "instagram", "reddit", "linkedin", "youtube"];
const PLANNER_VIEW_STORAGE_KEY = "dashboard:planner:view";
const LEGACY_PLANNER_VIEW_STORAGE_KEY = "blogposter:planner:view";
const AUTO_SCHEDULE_HOURS = [10, 13, 16];
const AUTO_SCHEDULE_MIN_GAP_MS = 90 * 60 * 1000;
const AUTO_SCHEDULE_MAX_ITEMS_PER_DAY = 1;
const AUTO_SCHEDULE_LOOKAHEAD_DAYS = 14;

type ScheduleFormState = {
  id?: number;
  social_post_id?: number | null;
  title: string;
  description: string;
  media_urls: string[];
  item_type: PlannerItem["item_type"];
  platform: string;
  status: PlannerItemInput["status"];
  scheduled_for: string;
  account_id: string;
  subreddit: string;
  related_strategy_id: string;
};

type SchedulerAccount = Pick<
  SocialAccount,
  "id" | "platform" | "username" | "status" | "connection_mode" | "credentials_ready" | "playwright_ready"
>;

function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function createEmptyScheduleForm(platform = ""): ScheduleFormState {
  return {
    title: "",
    description: "",
    media_urls: [],
    item_type: "post",
    platform,
    status: "planned",
    scheduled_for: "",
    account_id: "",
    subreddit: "",
    related_strategy_id: "",
  };
}

function plannerMediaKind(urls: string[]): "none" | "image" | "video" | "mixed" {
  if (urls.length === 0) return "none";
  const hasVideo = urls.some((url) => isVideoMediaUrl(url));
  const hasImage = urls.some((url) => !isVideoMediaUrl(url));
  if (hasVideo && hasImage) return "mixed";
  return hasVideo ? "video" : "image";
}

function isSchedulerView(value: string | null): value is SchedulerView {
  return value === "calendar" || value === "week" || value === "list";
}

function readStoredPlannerView(): SchedulerView {
  if (typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem(PLANNER_VIEW_STORAGE_KEY)
    ?? window.localStorage.getItem(LEGACY_PLANNER_VIEW_STORAGE_KEY);
  return isSchedulerView(stored) ? stored : "list";
}

function storePlannerView(view: SchedulerView) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLANNER_VIEW_STORAGE_KEY, view);
  window.localStorage.setItem(LEGACY_PLANNER_VIEW_STORAGE_KEY, view);
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function chooseAutoSchedule(existingSlots: string[]) {
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

function uploadedFileKind(files: File[]): "none" | "image" | "video" | "mixed" {
  if (files.length === 0) return "none";
  const hasVideo = files.some((file) => file.type.startsWith("video/") || isVideoMediaUrl(file.name));
  const hasImage = files.some((file) => file.type.startsWith("image/") || !file.type || !isVideoMediaUrl(file.name));
  if (hasVideo && hasImage) return "mixed";
  return hasVideo ? "video" : "image";
}

function buildPlannerTitle(form: ScheduleFormState): string {
  const normalizedDescription = form.description
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/\s+/g, " ")
    ?? "";
  const existingTitle = form.title.trim().replace(/\s+/g, " ");
  const fallbackTitle = `${form.platform.trim() || "Untitled"} ${form.item_type === "campaign" ? "campaign" : "post"}`;
  const source = normalizedDescription || existingTitle || fallbackTitle;
  return source.length > 96 ? `${source.slice(0, 93).trimEnd()}...` : source;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function plannerPlatformLabel(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  if (["x", "twitter", "twitter/x"].includes(normalized)) return "X";
  if (["thread", "threads"].includes(normalized)) return "Threads";
  if (normalized === "reddit") return "Reddit";
  if (["ig", "instagram"].includes(normalized)) return "Instagram";
  if (normalized === "linkedin") return "LinkedIn";
  if (normalized === "youtube") return "YouTube";
  if (normalized === "newsletter") return "Newsletter";
  if (normalized === "telegram") return "Telegram";
  if (normalized === "blog") return "Blog";
  const clean = platform.trim();
  return clean ? `${clean.charAt(0).toUpperCase()}${clean.slice(1)}` : "Platform";
}

function normalizePlannerAccountPlatform(platform: string): SocialAccount["platform"] | null {
  const normalized = platform.trim().toLowerCase();
  if (["x", "twitter", "twitter/x"].includes(normalized)) return "twitter";
  if (["thread", "threads"].includes(normalized)) return "threads";
  if (normalized === "reddit") return "reddit";
  if (["ig", "instagram"].includes(normalized)) return "instagram";
  if (normalized === "linkedin") return "linkedin";
  if (normalized === "youtube") return "youtube";
  return null;
}

function plannerAccountLabel(account: SchedulerAccount): string {
  const mode = account.connection_mode === "playwright" ? "Playwright" : "Official API";
  return `@${account.username} (${mode})`;
}

function normalizeSubredditInput(value: string): string {
  return value.trim().replace(/^\/?r\//i, "").replace(/[^A-Za-z0-9_]/g, "");
}

function extractPlannerSubreddit(value?: string | null): string {
  const match = String(value ?? "").match(/\bsubreddit\s*[:=]\s*(?:r\/)?([A-Za-z0-9_]{2,21})\b/i);
  return match?.[1] ?? "";
}

function normalizeRedditAccount(account: RedditAccount): SchedulerAccount {
  return {
    id: account.id,
    platform: "reddit",
    username: account.name,
    status: account.status,
    connection_mode: account.connection_mode,
    playwright_ready: account.playwright_ready,
  };
}

function derivePlannerAccounts(
  twitterAccounts: SocialAccount[],
  threadsAccounts: SocialAccount[],
  redditAccounts: RedditAccount[],
  extraAccounts: SocialAccount[],
): SchedulerAccount[] {
  return [
    ...twitterAccounts,
    ...threadsAccounts,
    ...extraAccounts,
    ...redditAccounts.map(normalizeRedditAccount),
  ].filter((account) => account.status === "active");
}

function derivePlannerPlatforms(accounts: SchedulerAccount[]): Array<SocialAccount["platform"]> {
  const available = new Set<SocialAccount["platform"]>();
  accounts.forEach((account) => available.add(account.platform));
  return schedulerPlatformOrder.filter((platform) => available.has(platform));
}

function displayPlannerTitle(item: Pick<PlannerItem, "item_type" | "platform" | "title">): string {
  const rawTitle = item.title.trim();
  const platformLabel = plannerPlatformLabel(item.platform);
  const platformVariants = new Set([item.platform.trim(), platformLabel]);
  if (platformLabel === "X") {
    platformVariants.add("twitter");
    platformVariants.add("twitter/x");
    platformVariants.add("x");
  }
  if (platformLabel === "Threads") {
    platformVariants.add("thread");
    platformVariants.add("threads");
  }

  const variants = Array.from(platformVariants)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  const type = item.item_type === "campaign" ? "campaign" : "post";
  const platformPrefix = variants.length > 0
    ? new RegExp(`^(?:${variants.join("|")})\\s+${type}\\s*:\\s*`, "i")
    : null;
  const genericPrefix = new RegExp(`^(?:threads|thread|twitter/x|twitter|x|reddit|instagram|ig|linkedin|youtube|telegram|newsletter|blog)\\s+${type}\\s*:\\s*`, "i");
  const cleaned = rawTitle
    .replace(platformPrefix ?? /^$/, "")
    .replace(genericPrefix, "")
    .trim();
  return cleaned || rawTitle;
}

function normalizePlannerStatus(status?: PlannerItem["status"] | PlannerItemInput["status"] | null): NonNullable<PlannerItemInput["status"]> {
  return status === "published" ? "published" : "planned";
}

function plannerStatusLabel(status: PlannerItem["status"] | PlannerItemInput["status"]): string {
  return normalizePlannerStatus(status) === "published" ? "Published" : "Planned";
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function monthGrid(date: Date): Date[] {
  const first = startOfMonth(date);
  const last = endOfMonth(date);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));

  const days: Date[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(new Date(cursor));
  }
  return days;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function weekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

const WEEK_HOUR_SLOTS = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  label: `${String(hour).padStart(2, "0")}:00`,
}));

export function PlannerPage() {
  const [items, setItems] = useState<PlannerItem[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<Array<SocialAccount["platform"]>>([]);
  const [schedulerAccounts, setSchedulerAccounts] = useState<SchedulerAccount[]>([]);
  const [redditAccounts, setRedditAccounts] = useState<RedditAccount[]>([]);
  const [redditSubreddits, setRedditSubreddits] = useState<RedditSubscribedSubreddit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subredditWarning, setSubredditWarning] = useState<string | null>(null);
  const [loadingSubreddits, setLoadingSubreddits] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [improvingDescription, setImprovingDescription] = useState(false);
  const [view, setView] = useState<SchedulerView>(readStoredPlannerView);
  const [search, setSearch] = useState("");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<ScheduleFormState>(createEmptyScheduleForm());

  function selectView(nextView: SchedulerView) {
    setView(nextView);
    storePlannerView(nextView);
  }

  async function load({ silent = false } = {}) {
    try {
      if (!silent) {
        setLoading(true);
      }

      const [plannerItems, twitterAccounts, threadsAccounts, redditAccounts, extraAccounts] = await Promise.all([
        api.listPlannerItems(),
        api.listTwitterAccounts().catch(() => []),
        api.listThreadsAccounts().catch(() => []),
        api.listRedditAccounts().catch(() => []),
        api.listSocialAccounts().catch(() => []),
      ]);
      const activeTwitterAccounts = asArray<SocialAccount>(twitterAccounts).filter((account) => account.status === "active");
      const activeThreadsAccounts = asArray<SocialAccount>(threadsAccounts).filter((account) => account.status === "active");
      const activeRedditAccounts = asArray<RedditAccount>(redditAccounts).filter((account) => account.status === "active");
      const activeExtraAccounts = asArray<SocialAccount>(extraAccounts).filter((account) => account.status === "active");
      const plannerAccounts = derivePlannerAccounts(
        activeTwitterAccounts,
        activeThreadsAccounts,
        activeRedditAccounts,
        activeExtraAccounts,
      );
      setItems(
        asArray<PlannerItem>(plannerItems).map((item) => ({
          ...item,
          status: normalizePlannerStatus(item.status),
        })),
      );
      setRedditAccounts(activeRedditAccounts);
      setSchedulerAccounts(plannerAccounts);
      setAvailablePlatforms(derivePlannerPlatforms(plannerAccounts));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scheduler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    storePlannerView(view);
  }, [view]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        query.length === 0 ||
        item.title.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.platform.toLowerCase().includes(query) ||
        item.related_strategy_name?.toLowerCase().includes(query);

      return item.item_type === "post" && matchesQuery;
    });
  }, [items, search]);

  const calendarDays = useMemo(() => monthGrid(calendarDate), [calendarDate]);
  const currentWeekDays = useMemo(() => weekDays(calendarDate), [calendarDate]);

  const calendarItemsByDay = useMemo(() => {
    return calendarDays.map((day) => ({
      day,
      items: filteredItems.filter((item) => item.scheduled_for && sameDay(new Date(item.scheduled_for), day)),
    }));
  }, [calendarDays, filteredItems]);

  const weekItemsByDay = useMemo(() => {
    return currentWeekDays.map((day) => {
      const itemsForDay = filteredItems
        .filter((item) => item.scheduled_for && sameDay(new Date(item.scheduled_for), day))
        .sort((left, right) => {
          const leftTime = left.scheduled_for ? new Date(left.scheduled_for).getTime() : 0;
          const rightTime = right.scheduled_for ? new Date(right.scheduled_for).getTime() : 0;
          return leftTime - rightTime;
        });

      const itemsByHour = WEEK_HOUR_SLOTS.reduce<Record<number, PlannerItem[]>>((accumulator, slot) => {
        accumulator[slot.hour] = [];
        return accumulator;
      }, {});

      itemsForDay.forEach((item) => {
        if (!item.scheduled_for) return;
        const scheduledDate = new Date(item.scheduled_for);
        itemsByHour[scheduledDate.getHours()]?.push(item);
      });

      return {
        day,
        items: itemsForDay,
        itemsByHour,
      };
    });
  }, [currentWeekDays, filteredItems]);

  const weekRangeLabel = useMemo(() => {
    const first = currentWeekDays[0];
    const last = currentWeekDays[currentWeekDays.length - 1];
    if (!first || !last) return "";
    return formatWeekRange(first, last);
  }, [currentWeekDays]);

  const today = new Date();
  const modalPlatforms = useMemo(() => {
    const options = [...availablePlatforms];
    const normalizedCurrent = normalizePlannerAccountPlatform(form.platform);
    if (normalizedCurrent && !options.includes(normalizedCurrent)) {
      options.push(normalizedCurrent);
    }
    return options;
  }, [availablePlatforms, form.platform]);
  const normalizedModalPlatform = normalizePlannerAccountPlatform(form.platform);
  const modalAccounts = useMemo(
    () => schedulerAccounts.filter((account) => account.platform === normalizedModalPlatform),
    [normalizedModalPlatform, schedulerAccounts],
  );
  const selectedModalAccount = useMemo(() => {
    const selectedId = Number(form.account_id || 0);
    return modalAccounts.find((account) => account.id === selectedId) ?? modalAccounts[0] ?? null;
  }, [form.account_id, modalAccounts]);
  const plannerMediaEntries = useMemo(
    () => form.media_urls.map((url, index) => ({ url, index, isVideo: isVideoMediaUrl(url) })),
    [form.media_urls],
  );
  const plannerVideoMedia = useMemo(
    () => plannerMediaEntries.filter((item) => item.isVideo),
    [plannerMediaEntries],
  );
  const plannerImageMedia = useMemo(
    () => plannerMediaEntries.filter((item) => !item.isVideo),
    [plannerMediaEntries],
  );
  const hasMixedPlannerMedia = plannerVideoMedia.length > 0 && plannerImageMedia.length > 0;
  const canSelectModalPlatform = !form.id;
  const modalPlatformLabel = plannerPlatformLabel(form.platform);
  const modalStatus = normalizePlannerStatus(form.status);
  const isPublishedSchedule = modalStatus === "published";
  const scheduledSlots = useMemo(
    () => items
      .filter((item) => item.id !== form.id)
      .map((item) => item.scheduled_for)
      .filter((value): value is string => Boolean(value)),
    [form.id, items],
  );
  const isRedditModal = normalizedModalPlatform === "reddit";
  const selectedRedditAccount = useMemo(() => {
    const selectedId = Number(form.account_id || 0);
    return redditAccounts.find((account) => account.id === selectedId) ?? redditAccounts[0] ?? null;
  }, [form.account_id, redditAccounts]);
  const redditSubredditOptions = useMemo(() => {
    const query = normalizeSubredditInput(form.subreddit).toLowerCase();
    return redditSubreddits
      .filter((subreddit) => {
        if (!query) return true;
        return (
          subreddit.name.toLowerCase().includes(query) ||
          subreddit.display_name.toLowerCase().includes(query) ||
          String(subreddit.title ?? "").toLowerCase().includes(query)
        );
      })
      .slice(0, 8);
  }, [form.subreddit, redditSubreddits]);

  useEffect(() => {
    if (!isModalOpen || !normalizedModalPlatform || !selectedModalAccount) return;
    if (String(selectedModalAccount.id) === form.account_id) return;
    setForm((current) => ({ ...current, account_id: String(selectedModalAccount.id) }));
  }, [form.account_id, isModalOpen, normalizedModalPlatform, selectedModalAccount]);

  useEffect(() => {
    if (!isModalOpen || !isRedditModal || form.account_id || !selectedRedditAccount) return;
    setForm((current) => ({ ...current, account_id: String(selectedRedditAccount.id) }));
  }, [form.account_id, isModalOpen, isRedditModal, selectedRedditAccount]);

  useEffect(() => {
    if (!isModalOpen || !isRedditModal) {
      setRedditSubreddits([]);
      setSubredditWarning(null);
      setLoadingSubreddits(false);
      return;
    }
    if (!selectedRedditAccount) {
      setRedditSubreddits([]);
      setSubredditWarning("Add a Reddit account in Config to load subscribed subreddits.");
      setLoadingSubreddits(false);
      return;
    }

    let cancelled = false;
    setLoadingSubreddits(true);
    setSubredditWarning(null);
    api.listRedditSubscribedSubreddits(selectedRedditAccount.id)
      .then((response) => {
        if (cancelled) return;
        setRedditSubreddits(asArray<RedditSubscribedSubreddit>(response.data));
        setSubredditWarning(response.warning ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRedditSubreddits([]);
        setSubredditWarning(err instanceof Error ? err.message : "Failed to load subscribed subreddits.");
      })
      .finally(() => {
        if (!cancelled) setLoadingSubreddits(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isModalOpen, isRedditModal, selectedRedditAccount]);

  function openCreateModal() {
    const platform = availablePlatforms[0] ?? "";
    const account = schedulerAccounts.find((item) => item.platform === platform);
    setForm({
      ...createEmptyScheduleForm(platform),
      account_id: account ? String(account.id) : "",
    });
    setIsModalOpen(true);
  }

  function openEditModal(item: PlannerItem) {
    setForm({
      id: item.id,
      social_post_id: item.social_post_id ?? null,
      title: item.title,
      description: item.description ?? "",
      media_urls: getPostImageUrls(item.image_url),
      item_type: item.item_type,
      platform: item.platform,
      status: normalizePlannerStatus(item.status),
      scheduled_for: toLocalDateTimeInput(item.scheduled_for),
      account_id: item.account_id ? String(item.account_id) : "",
      subreddit: item.subreddit ?? extractPlannerSubreddit(item.instruction),
      related_strategy_id: item.related_strategy_id ? String(item.related_strategy_id) : "",
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    setForm(createEmptyScheduleForm(availablePlatforms[0] ?? ""));
    setIsModalOpen(false);
  }

  async function uploadPlannerFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const incomingKind = uploadedFileKind(files);
    const currentKind = plannerMediaKind(form.media_urls);
    const nextKind = currentKind === "none" ? incomingKind : currentKind;

    if (incomingKind === "mixed") {
      setError("Upload either one video or one or more images, not both together.");
      return;
    }
    if (incomingKind === "video" && files.length > 1) {
      setError("Only one video can be attached to a post.");
      return;
    }
    if (currentKind !== "none" && currentKind !== incomingKind) {
      setError("Use either images or a video for a post. Remove current media before switching.");
      return;
    }
    if (nextKind === "video" && form.media_urls.length + files.length > 1) {
      setError("Only one video can be attached to a post.");
      return;
    }

    try {
      setUploadingMedia(true);
      setError(null);
      const uploaded = await Promise.all(files.map((file) => api.uploadMedia(file)));
      setForm((current) => ({
        ...current,
        media_urls: [...current.media_urls, ...uploaded.map((item) => item.url)],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload media");
    } finally {
      setUploadingMedia(false);
    }
  }

  async function uploadPlannerMedia(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await uploadPlannerFiles(files);
  }

  async function pastePlannerImage() {
    try {
      setError(null);
      if (!navigator.clipboard?.read) {
        setError("Clipboard image paste is not supported in this browser.");
        return;
      }
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const extension = imageType.split("/")[1] || "png";
        files.push(new File([blob], `clipboard-image.${extension}`, { type: imageType }));
      }
      if (files.length === 0) {
        setError("No image found in clipboard.");
        return;
      }
      await uploadPlannerFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read image from clipboard");
    }
  }

  function removePlannerMedia(index: number) {
    setForm((current) => ({
      ...current,
      media_urls: current.media_urls.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  async function savePlannerItem(scheduledFor: string | null) {
    const normalizedPlatform = normalizePlannerAccountPlatform(form.platform);
    if (!normalizedPlatform) {
      setError("Platform is required.");
      return;
    }
    const selectedAccount = selectedModalAccount;
    const selectedAccountId = selectedAccount?.id ?? null;
    if (!selectedAccountId) {
      setError(`Connect an active ${plannerPlatformLabel(normalizedPlatform)} account in Config before creating a post.`);
      return;
    }
    const isRedditPost = normalizedPlatform === "reddit";
    const subreddit = normalizeSubredditInput(form.subreddit);

    if (isRedditPost && !selectedAccountId) {
      setError("Connect a Reddit account in Config before creating a Reddit post.");
      return;
    }
    if (isRedditPost && !subreddit) {
      setError("Choose a subreddit before creating a Reddit post.");
      return;
    }

    try {
      setSaving(true);
      const title = buildPlannerTitle(form);
      const imageUrl = form.item_type === "post" ? serializePostMediaUrls(form.media_urls) : null;
      let socialPostId = form.social_post_id ?? null;

      if (form.item_type === "post") {
        const socialPostPayload: Partial<SocialPost> & {
          platform: SocialAccount["platform"];
          content: string;
          scheduled_at?: string | null;
          image_url?: string | null;
        } = {
          platform: normalizedPlatform,
          title,
          subreddit: isRedditPost ? subreddit : null,
          content: form.description.trim(),
          image_url: imageUrl,
          scheduled_at: scheduledFor,
          account_id: selectedAccountId,
          status: scheduledFor ? "scheduled" : "draft",
        };

        if (socialPostId) {
          await api.updateSocialPost(socialPostId, socialPostPayload);
        } else {
          const socialPost = await api.createSocialPost(normalizedPlatform, socialPostPayload);
          socialPostId = socialPost.id;
        }
      }

      const payload: PlannerItemInput = {
        title,
        description: form.description.trim() || null,
        image_url: imageUrl,
        item_type: form.item_type,
        platform: normalizedPlatform,
        status: normalizePlannerStatus(form.status),
        scheduled_for: scheduledFor,
        social_post_id: socialPostId,
        account_id: selectedAccountId,
        subreddit: isRedditPost ? subreddit : null,
        instruction: isRedditPost ? `subreddit: ${subreddit}` : null,
        related_strategy_id: form.related_strategy_id ? Number(form.related_strategy_id) : null,
      };

      if (form.id) {
        await api.updatePlannerItem(form.id, payload);
      } else {
        await api.createPlannerItem(payload);
      }

      closeModal();
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await savePlannerItem(form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null);
  }

  async function autoSchedulePlannerItem() {
    const scheduledAt = chooseAutoSchedule(scheduledSlots);
    setForm((current) => ({ ...current, scheduled_for: toDateTimeLocalValue(scheduledAt) }));
    await savePlannerItem(scheduledAt.toISOString());
  }

  async function improveDescription() {
    const description = form.description.trim();
    if (!description) {
      setError("Add description text before improving it.");
      return;
    }
    try {
      setImprovingDescription(true);
      setError(null);
      const result = await api.improvePlannerDescription({ description, platform: form.platform });
      setForm((current) => ({ ...current, description: result.value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to improve description");
    } finally {
      setImprovingDescription(false);
    }
  }

  async function deleteSchedule(id: number) {
    try {
      await api.deletePlannerItem(id);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule");
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading scheduler...</div>;
  }

  return (
    <div className="scheduler-page">
      {error ? <p className="error panel">{error}</p> : null}

      <section className="panel scheduler-overview">
        <div className="scheduler-hero scheduler-hero--minimal scheduler-overview__bar">
          <div className="scheduler-hero__content">
            <div className="ui-tabs__list scheduler-tabs scheduler-tabs--header">
              <button
                className={view === "calendar" ? "ui-tab scheduler-tab ui-tab--active scheduler-tab--active" : "ui-tab scheduler-tab"}
                onClick={() => selectView("calendar")}
                type="button"
              >
                Calendar
              </button>
              <button
                className={view === "week" ? "ui-tab scheduler-tab ui-tab--active scheduler-tab--active" : "ui-tab scheduler-tab"}
                onClick={() => selectView("week")}
                type="button"
              >
                Week
              </button>
              <button
                className={view === "list" ? "ui-tab scheduler-tab ui-tab--active scheduler-tab--active" : "ui-tab scheduler-tab"}
                onClick={() => selectView("list")}
                type="button"
              >
                List
              </button>
            </div>
            <div className="scheduler-hero__search">
              <input
                aria-label="Search schedules"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search schedules"
              />
            </div>
          </div>
          <div className="scheduler-hero__actions">
            <button onClick={openCreateModal}>New</button>
          </div>
        </div>

        {view === "list" ? (
        <div className="scheduler-view-panel">
          <div className="panel__title-row">
            <h2>Schedule List</h2>
          </div>
          {filteredItems.length === 0 ? (
            <p className="scheduler-empty">No schedules yet. Create one from the New button.</p>
          ) : (
            <div className="scheduler-list">
              <div className="scheduler-list__row scheduler-list__row--header">
                <span>Title</span>
                <span>Channel</span>
                <span>Status</span>
                <span>Scheduled</span>
                <span>Actions</span>
              </div>
              {filteredItems.map((item) => {
                const status = normalizePlannerStatus(item.status);
                return (
                  <div className="scheduler-list__row" key={item.id}>
                    <span>
                      <button className="scheduler-title-button" onClick={() => openEditModal(item)}>
                        {displayPlannerTitle(item)}
                      </button>
                      {item.description ? <small>{item.description}</small> : null}
                    </span>
                    <span>
                      <span className={`scheduler-pill scheduler-pill--${item.item_type}`}>{plannerPlatformLabel(item.platform)}</span>
                    </span>
                    <span>
                      <span className={`scheduler-status-chip scheduler-status-chip--${status}`}>
                        {plannerStatusLabel(status)}
                      </span>
                    </span>
                    <span>{item.scheduled_for ? formatDisplayDateTime(item.scheduled_for) : "—"}</span>
                    <span className="scheduler-row-actions">
                      <button
                        className="button-secondary dashboard-icon-button"
                        onClick={() => openEditModal(item)}
                        aria-label={`Edit ${displayPlannerTitle(item)}`}
                        title="Edit"
                      >
                        <PencilSquareIcon aria-hidden="true" />
                      </button>
                      <button
                        className="scheduler-delete dashboard-icon-button"
                        onClick={() => void deleteSchedule(item.id)}
                        aria-label={`Delete ${displayPlannerTitle(item)}`}
                        title="Delete"
                      >
                        <TrashIcon aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : view === "calendar" ? (
        <div className="scheduler-view-panel scheduler-calendar">
          <div className="panel__title-row scheduler-calendar__header">
            <div>
              <h2>{formatMonthYear(calendarDate)}</h2>
            </div>
            <div className="scheduler-calendar__nav">
              <button
                className="button-secondary"
                onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              >
                Prev
              </button>
              <button
                className="button-secondary"
                onClick={() => setCalendarDate(new Date())}
              >
                Today
              </button>
              <button
                className="button-secondary"
                onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              >
                Next
              </button>
            </div>
          </div>
          <div className="scheduler-calendar__grid scheduler-calendar__grid--header">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <div className="scheduler-calendar__weekday" key={label}>{label}</div>
            ))}
          </div>
          <div className="scheduler-calendar__grid">
            {calendarItemsByDay.map(({ day, items: dayItems }) => (
              <div
                key={day.toISOString()}
                className={`scheduler-calendar__day${
                  day.getMonth() !== calendarDate.getMonth() ? " scheduler-calendar__day--muted" : ""
                }${sameDay(day, today) ? " scheduler-calendar__day--today" : ""}`}
              >
                <div className="scheduler-calendar__day-top">
                  <div className="scheduler-calendar__day-number">{day.getDate()}</div>
                </div>
                <div className="scheduler-calendar__events">
                  {dayItems.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      className={`scheduler-calendar__event scheduler-calendar__event--${item.item_type}`}
                      onClick={() => openEditModal(item)}
                    >
                      <span className="scheduler-calendar__event-time">
                        {item.scheduled_for ? formatDisplayTime(item.scheduled_for) : "Any time"}
                      </span>
                      <span className="scheduler-calendar__event-title">{displayPlannerTitle(item)}</span>
                    </button>
                  ))}
                  {dayItems.length > 4 ? (
                    <span className="scheduler-calendar__more">+{dayItems.length - 4} more</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="scheduler-view-panel scheduler-week">
          <div className="panel__title-row scheduler-week__header">
            <div>
              <h2>{formatMonthYear(calendarDate)}</h2>
              <p className="scheduler-week__range">{weekRangeLabel}</p>
            </div>
            <div className="scheduler-calendar__nav">
              <button
                className="button-secondary"
                onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7))}
              >
                Prev Week
              </button>
              <button
                className="button-secondary"
                onClick={() => setCalendarDate(new Date())}
              >
                Today
              </button>
              <button
                className="button-secondary"
                onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + 7))}
              >
                Next Week
              </button>
            </div>
          </div>
          <div className="scheduler-week__timetable">
            <div className="scheduler-week__timetable-corner" />
            {weekItemsByDay.map(({ day }) => (
              <div
                key={`heading-${day.toISOString()}`}
                className={`scheduler-week__day-header${sameDay(day, today) ? " scheduler-week__day-header--today" : ""}`}
              >
                <p className="scheduler-week__day-label">{formatWeekdayShort(day)}</p>
                <strong>{formatMonthDay(day)}</strong>
              </div>
            ))}

            {WEEK_HOUR_SLOTS.map((slot) => (
              <Fragment key={`week-slot-${slot.hour}`}>
                <div className="scheduler-week__time-label">{slot.label}</div>
                {weekItemsByDay.map(({ day, itemsByHour }) => (
                  <div
                    key={`${day.toISOString()}-${slot.hour}`}
                    className={`scheduler-week__cell${sameDay(day, today) ? " scheduler-week__cell--today" : ""}`}
                  >
                    {itemsByHour[slot.hour]?.map((item) => {
                      const status = normalizePlannerStatus(item.status);
                      return (
                        <button
                          key={item.id}
                          className={`scheduler-week__slot-item scheduler-week__slot-item--${item.item_type}`}
                          onClick={() => openEditModal(item)}
                        >
                          <span className="scheduler-week__slot-meta">
                            <span className="scheduler-week__slot-time">
                              {item.scheduled_for ? formatDisplayTime(item.scheduled_for) : slot.label}
                            </span>
                            <span className={`scheduler-status-chip scheduler-status-chip--micro scheduler-status-chip--${status}`}>
                              {plannerStatusLabel(status)}
                            </span>
                          </span>
                          <span className="scheduler-week__slot-title">{displayPlannerTitle(item)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
        )}
      </section>

      {isModalOpen ? (
        <div className="scheduler-modal-backdrop" onClick={closeModal}>
          <div className="scheduler-modal" onClick={(event) => event.stopPropagation()}>
            <form className="stack" onSubmit={saveSchedule}>
              <div className="panel__title-row">
                <h2>{form.id ? "Edit Schedule" : "New post"}</h2>
                <ModalCloseButton onClick={closeModal} />
              </div>
              <div className="scheduler-platform-field">
                <p className="scheduler-media-field__label">Platform</p>
                {canSelectModalPlatform ? (
                  <div className="scheduler-platform-chips" role="radiogroup" aria-label="Platform">
                    {modalPlatforms.map((platform) => (
                      <button
                        key={platform}
                        type="button"
                        className={`scheduler-platform-chip${normalizePlannerAccountPlatform(form.platform) === platform ? " scheduler-platform-chip--active" : ""}`}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            platform,
                            account_id: String(schedulerAccounts.find((account) => account.platform === platform)?.id ?? ""),
                            subreddit: platform === "reddit" ? current.subreddit : "",
                          }))
                        }
                        aria-pressed={normalizePlannerAccountPlatform(form.platform) === platform}
                      >
                        {plannerPlatformLabel(platform)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="scheduler-platform-chips scheduler-platform-chips--static" aria-label="Platform">
                    <span className="scheduler-platform-chip scheduler-platform-chip--active">{modalPlatformLabel}</span>
                  </div>
                )}
              </div>
              {modalAccounts.length > 0 ? (
                <label className="scheduler-account-field">
                  <span className="scheduler-media-field__label">Account</span>
                  <select
                    value={selectedModalAccount ? String(selectedModalAccount.id) : ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        account_id: event.target.value,
                        subreddit: isRedditModal ? "" : current.subreddit,
                      }))
                    }
                  >
                    {modalAccounts.map((account) => (
                      <option key={`${account.platform}-${account.id}`} value={account.id}>
                        {plannerAccountLabel(account)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {isRedditModal ? (
                <div className="scheduler-reddit-target">
                  <div className="scheduler-reddit-target__row">
                    <label className="scheduler-reddit-target__field">
                      <span className="scheduler-field-label-row">
                        <span>Subreddit</span>
                        {selectedRedditAccount ? <small>@{selectedRedditAccount.name}</small> : null}
                      </span>
                      <input
                        list="scheduler-reddit-subreddits"
                        value={form.subreddit}
                        onChange={(event) => setForm((current) => ({ ...current, subreddit: event.target.value }))}
                        placeholder="Search subscribed subreddits"
                      />
                      <datalist id="scheduler-reddit-subreddits">
                        {redditSubreddits.map((subreddit) => (
                          <option key={subreddit.name} value={subreddit.name}>
                            {subreddit.display_name}
                          </option>
                        ))}
                      </datalist>
                    </label>
                    {redditAccounts.length > 1 ? (
                      <label className="scheduler-reddit-target__account">
                        Account
                        <select
                          value={selectedRedditAccount ? String(selectedRedditAccount.id) : ""}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              account_id: event.target.value,
                              subreddit: "",
                            }))
                          }
                        >
                          {redditAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              @{account.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  {loadingSubreddits ? (
                    <p className="scheduler-reddit-target__hint">Loading subscribed subreddits...</p>
                  ) : subredditWarning ? (
                    <p className="scheduler-reddit-target__hint">{subredditWarning}</p>
                  ) : redditSubredditOptions.length > 0 ? (
                    <div className="scheduler-reddit-target__suggestions" aria-label="Subscribed subreddit suggestions">
                      {redditSubredditOptions.map((subreddit) => (
                        <button
                          key={subreddit.name}
                          type="button"
                          className="scheduler-reddit-target__suggestion"
                          onClick={() => setForm((current) => ({ ...current, subreddit: subreddit.name }))}
                        >
                          {subreddit.display_name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="scheduler-reddit-target__hint">No subscribed subreddits matched. You can still type one manually.</p>
                  )}
                </div>
              ) : null}
              {form.id ? (
                <div className="scheduler-modal-status-field">
                  <p className="scheduler-media-field__label">Status</p>
                  <span className={`scheduler-status-chip scheduler-status-chip--${modalStatus}`}>
                    {plannerStatusLabel(modalStatus)}
                  </span>
                </div>
              ) : null}
              <label className="scheduler-description-field">
                <span className="scheduler-field-label-row">
                  <span>Description</span>
                  {!isPublishedSchedule ? (
                    <button
                      className="button-secondary scheduler-improve-button"
                      type="button"
                      onClick={() => void improveDescription()}
                      disabled={improvingDescription || saving || !form.description.trim()}
                    >
                      {improvingDescription ? "Improving..." : "Improve"}
                    </button>
                  ) : null}
                </span>
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder={form.item_type === "campaign" ? "Campaign brief, audience, CTA" : "Post angle, CTA, or draft outline"}
                  disabled={isPublishedSchedule}
                />
              </label>
              {form.item_type === "post" ? (
                <div className="scheduler-media-field stack">
                  <div className="scheduler-media-field__header">
                    <div>
                      <label className="scheduler-media-field__label">Media</label>
                      <p className="scheduler-media-field__hint">Attach one video or one or more images for this post.</p>
                    </div>
                    <div className="scheduler-media-actions">
                      <button
                        className="button-secondary"
                        type="button"
                        onClick={() => void pastePlannerImage()}
                        disabled={uploadingMedia}
                      >
                        Paste image
                      </button>
                      <label className="button-secondary scheduler-media-upload">
                        <input
                          accept="image/*,video/*"
                          multiple
                          onChange={(event) => void uploadPlannerMedia(event)}
                          type="file"
                          disabled={uploadingMedia}
                        />
                        {uploadingMedia ? "Uploading..." : form.media_urls.length ? "Add media" : "Upload media"}
                      </label>
                    </div>
                  </div>
                  {form.media_urls.length > 0 ? (
                    hasMixedPlannerMedia ? (
                      <div className="scheduler-media-mixed">
                        <div className="scheduler-media-grid">
                          {plannerVideoMedia.map(({ url, index }) => {
                            return (
                              <div className="scheduler-media-card" key={`${url}-${index}`}>
                                <button
                                  className="scheduler-media-card__remove"
                                  onClick={() => removePlannerMedia(index)}
                                  type="button"
                                >
                                  Remove
                                </button>
                                <video className="scheduler-media-card__asset" src={url} controls playsInline />
                              </div>
                            );
                          })}
                        </div>
                        <div className="scheduler-media-thumbnails">
                          {plannerImageMedia.map(({ url, index }) => {
                            return (
                              <div className="scheduler-media-card scheduler-media-card--thumb" key={`${url}-${index}`}>
                                <button
                                  className="scheduler-media-card__remove"
                                  onClick={() => removePlannerMedia(index)}
                                  type="button"
                                >
                                  Remove
                                </button>
                                <img className="scheduler-media-card__asset" src={url} alt={`Uploaded post media ${index + 1}`} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="scheduler-media-grid">
                        {form.media_urls.map((url, index) => (
                          <div className="scheduler-media-card" key={`${url}-${index}`}>
                            <button
                              className="scheduler-media-card__remove"
                              onClick={() => removePlannerMedia(index)}
                              type="button"
                            >
                              Remove
                            </button>
                            {isVideoMediaUrl(url) ? (
                              <video className="scheduler-media-card__asset" src={url} controls playsInline />
                            ) : (
                              <img className="scheduler-media-card__asset" src={url} alt={`Uploaded post media ${index + 1}`} />
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  ) : null}
                </div>
              ) : null}
              <label>
                Scheduled For
                <input
                  type="datetime-local"
                  value={form.scheduled_for}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, scheduled_for: event.target.value }))
                  }
                />
              </label>
              <div className="scheduler-submit-actions">
                <button type="submit" disabled={saving}>
                  {saving ? "Publishing..." : "Publish"}
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => void autoSchedulePlannerItem()}
                >
                  {saving ? "Scheduling..." : "Auto-schedule it"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
