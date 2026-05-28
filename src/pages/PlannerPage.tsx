import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Bars3Icon, ChevronLeftIcon, ChevronRightIcon, ExclamationTriangleIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/solid";
import type { IconType } from "react-icons";
import { FaFacebookF, FaLinkedinIn } from "react-icons/fa6";
import { SiInstagram, SiReddit, SiThreads, SiX, SiYoutube } from "react-icons/si";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { SectionTabs } from "../components/SectionTabs";
import { formatDisplayDateTime, formatDisplayTime, formatMonthDay, formatMonthYear, formatWeekRange, formatWeekdayShort } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import { getPostImageUrls, isVideoMediaUrl, serializePostMediaUrls } from "../lib/socialPostMedia";
import { chooseAutoSchedule, collectActiveScheduledSocialSlots } from "../lib/socialSchedule";
import type { PlannerItem, PlannerItemInput, RedditAccount, RedditSubscribedSubreddit, SocialAccount, SocialPost } from "../lib/types";
import "../styles/planner-page.css";

type SchedulerView = "list" | "calendar" | "week";

const schedulerPlatformOrder: Array<SocialAccount["platform"]> = ["twitter", "threads", "instagram", "reddit", "linkedin"];
const PLANNER_VIEW_STORAGE_KEY = "dashboard:planner:view";
const LEGACY_PLANNER_VIEW_STORAGE_KEY = "blogposter:planner:view";
const DEFAULT_SCHEDULE_HOUR = 10;
const plannerPlatformIcons: Partial<Record<SocialAccount["platform"], IconType>> = {
  facebook: FaFacebookF,
  instagram: SiInstagram,
  linkedin: FaLinkedinIn,
  reddit: SiReddit,
  threads: SiThreads,
  twitter: SiX,
  youtube: SiYoutube,
};

type PlatformAccountIds = Partial<Record<SocialAccount["platform"], string[]>>;

type ScheduleFormState = {
  id?: number;
  social_post_id?: number | null;
  title: string;
  description: string;
  media_urls: string[];
  item_type: PlannerItem["item_type"];
  platform: string;
  platforms: Array<SocialAccount["platform"]>;
  status: PlannerItemInput["status"];
  scheduled_for: string;
  account_id: string;
  account_ids: PlatformAccountIds;
  subreddit: string;
  related_strategy_id: string;
};

type SchedulerAccount = Pick<
  SocialAccount,
  "id" | "platform" | "username" | "status" | "credentials_ready"
>;

type PlannerPostTarget = {
  platform: SocialAccount["platform"];
  account: SchedulerAccount;
  scheduledFor: string | null;
};

type PlannerItemMicroNote = {
  label: string;
  tone: "success" | "danger";
  title?: string;
};

function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function createEmptyScheduleForm(platform = ""): ScheduleFormState {
  const normalizedPlatform = normalizePlannerAccountPlatform(platform);
  return {
    title: "",
    description: "",
    media_urls: [],
    item_type: "post",
    platform: normalizedPlatform ?? platform,
    platforms: normalizedPlatform ? [normalizedPlatform] : [],
    status: "planned",
    scheduled_for: "",
    account_id: "",
    account_ids: {},
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

function uploadedFileKind(files: File[]): "none" | "image" | "video" | "mixed" {
  if (files.length === 0) return "none";
  const hasVideo = files.some((file) => file.type.startsWith("video/") || isVideoMediaUrl(file.name));
  const hasImage = files.some((file) => file.type.startsWith("image/") || !file.type || !isVideoMediaUrl(file.name));
  if (hasVideo && hasImage) return "mixed";
  return hasVideo ? "video" : "image";
}

function clipboardImageExtension(type: string): string {
  if (type === "image/jpeg") return "jpg";
  return type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
}

function normalizeClipboardImageFile(file: File, index: number): File {
  if (file.name) return file;
  const type = file.type || "image/png";
  return new File([file], `clipboard-image-${index + 1}.${clipboardImageExtension(type)}`, {
    type,
    lastModified: file.lastModified || Date.now(),
  });
}

function getClipboardImageFiles(clipboardData: DataTransfer | null): File[] {
  const filesFromItems = Array.from(clipboardData?.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .map(normalizeClipboardImageFile);

  if (filesFromItems.length > 0) {
    return filesFromItems;
  }

  return Array.from(clipboardData?.files ?? [])
    .filter((file) => file.type.startsWith("image/"))
    .map(normalizeClipboardImageFile);
}

function buildPlannerTitle(form: ScheduleFormState, platformOverride?: string): string {
  const normalizedDescription = form.description
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/\s+/g, " ")
    ?? "";
  const existingTitle = form.title.trim().replace(/\s+/g, " ");
  const fallbackPlatform = platformOverride ?? form.platform;
  const fallbackTitle = `${fallbackPlatform.trim() || "Untitled"} ${form.item_type === "campaign" ? "campaign" : "post"}`;
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

function normalizePlannerAccountPlatform(platform?: string | null): SocialAccount["platform"] | null {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (["x", "twitter", "twitter/x"].includes(normalized)) return "twitter";
  if (["thread", "threads"].includes(normalized)) return "threads";
  if (normalized === "reddit") return "reddit";
  if (["ig", "instagram"].includes(normalized)) return "instagram";
  if (normalized === "facebook") return "facebook";
  if (normalized === "linkedin") return "linkedin";
  if (normalized === "youtube") return "youtube";
  return null;
}

function PlannerPlatformIcon({ platform }: { platform: string }) {
  const normalized = normalizePlannerAccountPlatform(platform);
  const Icon = normalized ? plannerPlatformIcons[normalized] : null;
  return Icon ? <Icon className="scheduler-platform-icon" aria-hidden="true" /> : null;
}

function PlannerPlatformLabel({ platform }: { platform: string }) {
  return (
    <>
      <PlannerPlatformIcon platform={platform} />
      <span>{plannerPlatformLabel(platform)}</span>
    </>
  );
}

function uniquePlannerPlatforms(platforms: Array<string | null | undefined>): Array<SocialAccount["platform"]> {
  const selected = new Set<SocialAccount["platform"]>();
  platforms.forEach((platform) => {
    const normalized = normalizePlannerAccountPlatform(platform);
    if (normalized) selected.add(normalized);
  });
  return schedulerPlatformOrder.filter((platform) => selected.has(platform));
}

function selectedPlannerPlatforms(form: ScheduleFormState): Array<SocialAccount["platform"]> {
  return uniquePlannerPlatforms([...(form.platforms ?? []), form.platform]);
}

function selectedPlannerAccountIds(form: ScheduleFormState, platform: SocialAccount["platform"]): string[] {
  const fromPlatformMap = form.account_ids?.[platform] ?? [];
  const fallback = normalizePlannerAccountPlatform(form.platform) === platform && form.account_id ? [form.account_id] : [];
  const seen = new Set<string>();
  return [...fromPlatformMap, ...fallback]
    .map((id) => String(id).trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function plannerTargetKey(platform: SocialAccount["platform"], accountId: number): string {
  return `${platform}:${accountId}`;
}

function plannerAccountLabel(account: SchedulerAccount): string {
  return `@${account.username} (Official API)`;
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
    credentials_ready: account.credentials_ready,
  };
}

type SchedulerSocialAccountSource = Pick<SocialAccount, "id" | "username" | "status"> &
  Partial<Pick<SocialAccount, "platform" | "credentials_ready">>;

function normalizeSchedulerSocialAccount(
  account: SchedulerSocialAccountSource,
  fallbackPlatform?: string | null,
): SchedulerAccount | null {
  const platform = normalizePlannerAccountPlatform(account.platform ?? fallbackPlatform);
  if (!platform) return null;

  return {
    id: account.id,
    platform,
    username: account.username,
    status: account.status,
    credentials_ready: account.credentials_ready,
  };
}

function derivePlannerAccounts(
  twitterAccounts: SocialAccount[],
  threadsAccounts: SocialAccount[],
  redditAccounts: RedditAccount[],
  extraAccounts: SocialAccount[],
): SchedulerAccount[] {
  const accounts = [
    ...twitterAccounts.map((account) => normalizeSchedulerSocialAccount(account, "twitter")),
    ...threadsAccounts.map((account) => normalizeSchedulerSocialAccount(account, "threads")),
    ...extraAccounts.map((account) => normalizeSchedulerSocialAccount(account)),
    ...redditAccounts.map(normalizeRedditAccount),
  ].filter((account): account is SchedulerAccount =>
    Boolean(account && account.status === "active" && schedulerPlatformOrder.includes(account.platform))
  );
  const seen = new Set<string>();
  return accounts.filter((account) => {
    const key = `${account.platform}:${account.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function derivePlannerPlatforms(accounts: SchedulerAccount[]): Array<SocialAccount["platform"]> {
  const available = new Set<SocialAccount["platform"]>();
  accounts.forEach((account) => {
    const platform = normalizePlannerAccountPlatform(account.platform);
    if (platform) available.add(platform);
  });
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
  const [notice, setNotice] = useState<string | null>(null);
  const [subredditWarning, setSubredditWarning] = useState<string | null>(null);
  const [loadingSubreddits, setLoadingSubreddits] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [improvingDescription, setImprovingDescription] = useState(false);
  const [view, setView] = useState<SchedulerView>(readStoredPlannerView);
  const [search, setSearch] = useState("");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPublishConfirmOpen, setIsPublishConfirmOpen] = useState(false);
  const [publishConfirmTargets, setPublishConfirmTargets] = useState<PlannerPostTarget[]>([]);
  const [form, setForm] = useState<ScheduleFormState>(createEmptyScheduleForm());
  const [draggingPlannerItemId, setDraggingPlannerItemId] = useState<number | null>(null);
  const [dragOverWeekSlot, setDragOverWeekSlot] = useState<string | null>(null);
  const [draggingMediaIndex, setDraggingMediaIndex] = useState<number | null>(null);
  const [dragOverMediaIndex, setDragOverMediaIndex] = useState<number | null>(null);
  const lastAutosavedDescriptionRef = useRef<{ id?: number; description: string; title: string }>({
    description: "",
    title: "",
  });
  const autosaveDescriptionTokenRef = useRef(0);
  const descriptionAutosaveTimeoutRef = useRef<number | null>(null);
  const pendingDescriptionAutosaveRef = useRef<ScheduleFormState | null>(null);

  function selectView(nextView: SchedulerView) {
    setView(nextView);
    storePlannerView(nextView);
  }

  async function loadSchedulerAccounts() {
    const [twitterAccounts, threadsAccounts, redditAccounts, extraAccounts] = await Promise.all([
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
    setRedditAccounts(activeRedditAccounts);
    setSchedulerAccounts(plannerAccounts);
    setAvailablePlatforms(derivePlannerPlatforms(plannerAccounts));
  }

  async function load({ silent = false } = {}) {
    const accountsPromise = loadSchedulerAccounts().catch(() => undefined);
    try {
      if (!silent) {
        setLoading(true);
      }

      const plannerItems = await api.listPlannerItems();
      setItems(
        asArray<PlannerItem>(plannerItems).map((item) => ({
          ...item,
          status: normalizePlannerStatus(item.status),
        })),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scheduler");
    } finally {
      setLoading(false);
    }
    void accountsPromise;
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

  function plannerItemMicroNote(item: PlannerItem): PlannerItemMicroNote | null {
    if (normalizePlannerStatus(item.status) === "published") return null;
    if (!item.social_post_id || !item.scheduled_for) return null;
    if (item.social_post_status === "failed") {
      return { label: "Publishing failed", tone: "danger", title: item.social_post_last_error || undefined };
    }
    return null;
  }

  const today = new Date();
  const modalPlatforms = useMemo(() => {
    const options = [...availablePlatforms];
    selectedPlannerPlatforms(form).forEach((platform) => {
      if (!options.includes(platform)) options.push(platform);
    });
    return schedulerPlatformOrder.filter((platform) => options.includes(platform));
  }, [availablePlatforms, form.platform, form.platforms]);
  const selectedModalPlatforms = useMemo(() => {
    const selected = selectedPlannerPlatforms(form).filter((platform) => modalPlatforms.includes(platform));
    if (selected.length > 0) return selected;
    return modalPlatforms[0] ? [modalPlatforms[0]] : [];
  }, [form.platform, form.platforms, modalPlatforms]);
  const selectedAccountIdsByPlatform = useMemo(() => {
    const selections: PlatformAccountIds = {};
    selectedModalPlatforms.forEach((platform) => {
      const accounts = schedulerAccounts.filter((account) => normalizePlannerAccountPlatform(account.platform) === platform);
      const selectedIds = selectedPlannerAccountIds(form, platform).filter((id) =>
        accounts.some((account) => String(account.id) === id),
      );
      selections[platform] = selectedIds.length > 0
        ? selectedIds.slice(0, 1)
        : accounts[0]
        ? [String(accounts[0].id)]
        : [];
    });
    return selections;
  }, [form.account_id, form.account_ids, form.platform, form.platforms, schedulerAccounts, selectedModalPlatforms]);
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
  const canDeleteModalSchedule = Boolean(form.id && !isPublishedSchedule);
  const canReorderPlannerMedia = !isPublishedSchedule && form.media_urls.length > 1;
  const isRedditModal = selectedModalPlatforms.includes("reddit");
  const selectedRedditAccountIds = selectedAccountIdsByPlatform.reddit ?? [];
  const selectedRedditAccounts = useMemo(() => {
    const selectedIds = new Set(selectedRedditAccountIds);
    return redditAccounts.filter((account) => selectedIds.has(String(account.id)));
  }, [redditAccounts, selectedRedditAccountIds]);
  const selectedRedditAccount = useMemo(() => {
    const selectedId = Number(selectedRedditAccountIds[0] || 0);
    return redditAccounts.find((account) => account.id === selectedId) ?? redditAccounts[0] ?? null;
  }, [redditAccounts, selectedRedditAccountIds]);
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
    if (!isModalOpen) return;
    setForm((current) => {
      const currentPlatforms = selectedPlannerPlatforms(current).filter((platform) => modalPlatforms.includes(platform));
      const nextPlatforms = currentPlatforms.length > 0
        ? currentPlatforms
        : modalPlatforms[0]
        ? [modalPlatforms[0]]
        : [];
      const nextAccountIds: PlatformAccountIds = {};
      let changed = !sameStringArray(nextPlatforms, current.platforms);

      nextPlatforms.forEach((platform) => {
        const accounts = schedulerAccounts.filter((account) => normalizePlannerAccountPlatform(account.platform) === platform);
        const validIds = selectedPlannerAccountIds(current, platform).filter((id) =>
          accounts.some((account) => String(account.id) === id),
        );
        const nextIds = validIds.length > 0
          ? validIds.slice(0, 1)
          : accounts[0]
          ? [String(accounts[0].id)]
          : [];
        nextAccountIds[platform] = nextIds;
        if (!sameStringArray(current.account_ids?.[platform] ?? [], nextIds)) {
          changed = true;
        }
      });

      const primaryPlatform = nextPlatforms[0] ?? normalizePlannerAccountPlatform(current.platform);
      const primaryAccountId = primaryPlatform ? nextAccountIds[primaryPlatform]?.[0] ?? "" : "";
      if ((primaryPlatform && current.platform !== primaryPlatform) || current.account_id !== primaryAccountId) {
        changed = true;
      }

      return changed
        ? {
            ...current,
            platform: primaryPlatform ?? current.platform,
            platforms: nextPlatforms,
            account_id: primaryAccountId,
            account_ids: nextAccountIds,
            subreddit: nextPlatforms.includes("reddit") ? current.subreddit : "",
          }
        : current;
    });
  }, [isModalOpen, modalPlatforms, schedulerAccounts]);

  useEffect(() => {
    if (!isModalOpen || !isRedditModal) {
      setRedditSubreddits([]);
      setSubredditWarning(null);
      setLoadingSubreddits(false);
      return;
    }
    const accountsToLoad = selectedRedditAccounts.length > 0
      ? selectedRedditAccounts
      : selectedRedditAccount
      ? [selectedRedditAccount]
      : [];
    if (accountsToLoad.length === 0) {
      setRedditSubreddits([]);
      setSubredditWarning("Add a Reddit account in Config to load subscribed subreddits.");
      setLoadingSubreddits(false);
      return;
    }

    let cancelled = false;
    setLoadingSubreddits(true);
    setSubredditWarning(null);
    Promise.all(accountsToLoad.map((account) => api.listRedditSubscribedSubreddits(account.id)))
      .then((responses) => {
        if (cancelled) return;
        const subreddits = new Map<string, RedditSubscribedSubreddit>();
        const warnings = new Set<string>();
        responses.forEach((response) => {
          asArray<RedditSubscribedSubreddit>(response.data).forEach((subreddit) => {
            const key = subreddit.name.toLowerCase();
            if (key && !subreddits.has(key)) subreddits.set(key, subreddit);
          });
          if (response.warning) warnings.add(response.warning);
        });
        setRedditSubreddits([...subreddits.values()]);
        setSubredditWarning(warnings.size > 0 ? [...warnings].join(" ") : null);
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
  }, [isModalOpen, isRedditModal, selectedRedditAccount, selectedRedditAccounts]);

  function clearDescriptionAutosaveTimer() {
    if (descriptionAutosaveTimeoutRef.current === null) return;
    window.clearTimeout(descriptionAutosaveTimeoutRef.current);
    descriptionAutosaveTimeoutRef.current = null;
  }

  async function autosavePlannerDescription(snapshot: ScheduleFormState) {
    if (!snapshot.id || normalizePlannerStatus(snapshot.status) !== "planned") return;

    const title = buildPlannerTitle(snapshot);
    const lastAutosaved = lastAutosavedDescriptionRef.current;
    if (
      lastAutosaved.id === snapshot.id &&
      lastAutosaved.description === snapshot.description &&
      lastAutosaved.title === title
    ) {
      return;
    }

    const token = autosaveDescriptionTokenRef.current + 1;
    autosaveDescriptionTokenRef.current = token;
    const storedDescription = snapshot.description.trim();

    try {
      if (snapshot.social_post_id) {
        await api.updateSocialPost(snapshot.social_post_id, {
          title,
          content: storedDescription,
        });
      }
      const result = await api.updatePlannerItem(snapshot.id, {
        title,
        description: storedDescription || null,
      });

      if (autosaveDescriptionTokenRef.current !== token) return;
      lastAutosavedDescriptionRef.current = {
        id: snapshot.id,
        description: snapshot.description,
        title,
      };
      setItems((current) =>
        current.map((item) =>
          item.id === snapshot.id
            ? {
                ...item,
                title,
                description: storedDescription || null,
                updated_at: result.updated_at,
              }
            : item,
        ),
      );
      setError(null);
    } catch (err) {
      if (autosaveDescriptionTokenRef.current !== token) return;
      setError(err instanceof Error ? err.message : "Failed to autosave description");
    }
  }

  function queueDescriptionAutosave(snapshot: ScheduleFormState, delay = 450) {
    if (!snapshot.id || normalizePlannerStatus(snapshot.status) !== "planned") return;
    pendingDescriptionAutosaveRef.current = snapshot;
    clearDescriptionAutosaveTimer();
    descriptionAutosaveTimeoutRef.current = window.setTimeout(() => {
      descriptionAutosaveTimeoutRef.current = null;
      const pending = pendingDescriptionAutosaveRef.current;
      pendingDescriptionAutosaveRef.current = null;
      if (pending) void autosavePlannerDescription(pending);
    }, delay);
  }

  function flushDescriptionAutosave() {
    clearDescriptionAutosaveTimer();
    const pending = pendingDescriptionAutosaveRef.current;
    pendingDescriptionAutosaveRef.current = null;
    if (pending) void autosavePlannerDescription(pending);
  }

  function clearDescriptionAutosave() {
    clearDescriptionAutosaveTimer();
    pendingDescriptionAutosaveRef.current = null;
    autosaveDescriptionTokenRef.current += 1;
  }

  function slotDateTime(day: Date, hour = DEFAULT_SCHEDULE_HOUR) {
    const scheduledAt = new Date(day);
    scheduledAt.setHours(hour, 0, 0, 0);
    return scheduledAt;
  }

  function accountsForPlatform(platform: SocialAccount["platform"]) {
    return schedulerAccounts.filter((account) => normalizePlannerAccountPlatform(account.platform) === platform);
  }

  function defaultAccountIdsForPlatforms(platforms: Array<SocialAccount["platform"]>) {
    const accountIds: PlatformAccountIds = {};
    platforms.forEach((platform) => {
      const account = accountsForPlatform(platform)[0];
      accountIds[platform] = account ? [String(account.id)] : [];
    });
    return accountIds;
  }

  function selectedAccountsForPlatform(platform: SocialAccount["platform"], state: ScheduleFormState = form) {
    const accounts = accountsForPlatform(platform);
    const selectedIds = selectedPlannerAccountIds(state, platform);
    const selectedIdSet = new Set(selectedIds);
    const selectedAccounts = accounts.filter((account) => selectedIdSet.has(String(account.id)));
    return selectedAccounts.length > 0 ? selectedAccounts.slice(0, 1) : accounts.slice(0, 1);
  }

  function setPlatformAccountSelection(platform: SocialAccount["platform"], accountId: string, selected: boolean) {
    if (!selected) return;
    setForm((current) => {
      const currentPlatforms = selectedPlannerPlatforms(current);
      const nextPlatforms = currentPlatforms.includes(platform) ? currentPlatforms : [...currentPlatforms, platform];
      const nextIds = [accountId];
      const accountIds = { ...current.account_ids, [platform]: nextIds };
      const primaryPlatform = nextPlatforms[0] ?? platform;
      return {
        ...current,
        platform: primaryPlatform,
        platforms: nextPlatforms,
        account_id: accountIds[primaryPlatform]?.[0] ?? current.account_id,
        account_ids: accountIds,
        subreddit: nextPlatforms.includes("reddit") ? current.subreddit : "",
      };
    });
  }

  function toggleModalPlatform(platform: SocialAccount["platform"]) {
    setForm((current) => {
      const currentPlatforms = selectedPlannerPlatforms(current);
      const removing = currentPlatforms.includes(platform);
      const nextPlatforms = removing
        ? currentPlatforms.length > 1
          ? currentPlatforms.filter((item) => item !== platform)
          : currentPlatforms
        : [...currentPlatforms, platform];
      const accountIds: PlatformAccountIds = {};
      nextPlatforms.forEach((nextPlatform) => {
        const existingIds = selectedPlannerAccountIds(current, nextPlatform);
        accountIds[nextPlatform] = existingIds.length > 0
          ? existingIds.slice(0, 1)
          : defaultAccountIdsForPlatforms([nextPlatform])[nextPlatform] ?? [];
      });
      const primaryPlatform = nextPlatforms[0] ?? platform;
      return {
        ...current,
        platform: primaryPlatform,
        platforms: nextPlatforms,
        account_id: accountIds[primaryPlatform]?.[0] ?? "",
        account_ids: accountIds,
        subreddit: nextPlatforms.includes("reddit") ? current.subreddit : "",
      };
    });
  }

  function openCreateModal(scheduledAt?: Date) {
    const platform = availablePlatforms[0] ?? "";
    const platforms = platform ? [platform] : [];
    const accountIds = defaultAccountIdsForPlatforms(platforms);
    clearDescriptionAutosave();
    lastAutosavedDescriptionRef.current = {
      description: "",
      title: "",
    };
    setError(null);
    setNotice(null);
    setForm({
      ...createEmptyScheduleForm(platform),
      platforms,
      account_id: platform ? accountIds[platform]?.[0] ?? "" : "",
      account_ids: accountIds,
      scheduled_for: scheduledAt ? toDateTimeLocalValue(scheduledAt) : "",
    });
    setIsModalOpen(true);
  }

  function openCreateModalForDay(day: Date) {
    openCreateModal(slotDateTime(day));
  }

  function openCreateModalForWeekSlot(day: Date, hour: number) {
    openCreateModal(slotDateTime(day, hour));
  }

  function openEditModal(item: PlannerItem) {
    const description = item.description ?? "";
    const platform = normalizePlannerAccountPlatform(item.platform);
    const accountIds = platform && item.account_id ? { [platform]: [String(item.account_id)] } : {};
    const nextForm = {
      id: item.id,
      social_post_id: item.social_post_id ?? null,
      title: item.title,
      description,
      media_urls: getPostImageUrls(item.image_url),
      item_type: item.item_type,
      platform: platform ?? item.platform,
      platforms: platform ? [platform] : [],
      status: normalizePlannerStatus(item.status),
      scheduled_for: toLocalDateTimeInput(item.scheduled_for),
      account_id: item.account_id ? String(item.account_id) : "",
      account_ids: accountIds,
      subreddit: item.subreddit ?? extractPlannerSubreddit(item.instruction),
      related_strategy_id: item.related_strategy_id ? String(item.related_strategy_id) : "",
    };
    clearDescriptionAutosave();
    lastAutosavedDescriptionRef.current = {
      id: item.id,
      description,
      title: buildPlannerTitle(nextForm),
    };
    setForm(nextForm);
    setNotice(null);
    setIsPublishConfirmOpen(false);
    setPublishConfirmTargets([]);
    setIsModalOpen(true);
  }

  function closeModal() {
    flushDescriptionAutosave();
    lastAutosavedDescriptionRef.current = {
      description: "",
      title: "",
    };
    setForm(createEmptyScheduleForm(availablePlatforms[0] ?? ""));
    setIsPublishConfirmOpen(false);
    setPublishConfirmTargets([]);
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

  async function uploadClipboardImages(clipboardData: DataTransfer | null): Promise<boolean> {
    const files = getClipboardImageFiles(clipboardData);
    if (files.length === 0) return false;
    await uploadPlannerFiles(files);
    return true;
  }

  async function pastePlannerImage() {
    try {
      setError(null);
      if (!navigator.clipboard?.read) {
        setError("Browser blocked clipboard access. Press Ctrl+V while this editor is open, or use Upload media.");
        return;
      }
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        files.push(new File([blob], `clipboard-image-${files.length + 1}.${clipboardImageExtension(imageType)}`, { type: imageType }));
      }
      if (files.length === 0) {
        setError("No image found in clipboard.");
        return;
      }
      await uploadPlannerFiles(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message.toLowerCase().includes("permission")
          ? "Browser blocked clipboard access. Press Ctrl+V while this editor is open, or use Upload media."
          : "Failed to read image from clipboard",
      );
    }
  }

  useEffect(() => {
    if (!isModalOpen || form.item_type !== "post") return;

    function handleWindowPaste(event: ClipboardEvent) {
      if (getClipboardImageFiles(event.clipboardData).length === 0) return;
      event.preventDefault();
      if (uploadingMedia) return;
      void uploadClipboardImages(event.clipboardData);
    }

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, [form.item_type, form.media_urls, isModalOpen, uploadingMedia]);

  function removePlannerMedia(index: number) {
    setForm((current) => ({
      ...current,
      media_urls: current.media_urls.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function movePlannerMedia(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setForm((current) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.media_urls.length ||
        toIndex >= current.media_urls.length
      ) {
        return current;
      }
      const mediaUrls = [...current.media_urls];
      const [moved] = mediaUrls.splice(fromIndex, 1);
      mediaUrls.splice(toIndex, 0, moved);
      return {
        ...current,
        media_urls: mediaUrls,
      };
    });
  }

  function startPlannerMediaDrag(event: DragEvent<HTMLDivElement>, index: number) {
    if (!canReorderPlannerMedia) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-oilor-media-index", String(index));
    event.dataTransfer.setData("text/plain", String(index));
    setDraggingMediaIndex(index);
    setDragOverMediaIndex(index);
  }

  function handlePlannerMediaDragOver(event: DragEvent<HTMLDivElement>, index: number) {
    if (!canReorderPlannerMedia || draggingMediaIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverMediaIndex((current) => (current === index ? current : index));
  }

  function dropPlannerMedia(event: DragEvent<HTMLDivElement>, index: number) {
    if (!canReorderPlannerMedia) return;
    event.preventDefault();
    const rawIndex = event.dataTransfer.getData("application/x-oilor-media-index") || event.dataTransfer.getData("text/plain");
    const fromIndex = Number(rawIndex);
    if (Number.isInteger(fromIndex)) {
      movePlannerMedia(fromIndex, index);
    }
    setDraggingMediaIndex(null);
    setDragOverMediaIndex(null);
  }

  function endPlannerMediaDrag() {
    setDraggingMediaIndex(null);
    setDragOverMediaIndex(null);
  }

  function plannerMediaCardClass(index: number, thumbnail = false) {
    return [
      "scheduler-media-card",
      thumbnail ? "scheduler-media-card--thumb" : "",
      canReorderPlannerMedia ? "scheduler-media-card--draggable" : "",
      draggingMediaIndex === index ? "is-dragging" : "",
      dragOverMediaIndex === index && draggingMediaIndex !== null && draggingMediaIndex !== index ? "is-drop-target" : "",
    ].filter(Boolean).join(" ");
  }

  function renderPlannerMediaCard(url: string, index: number, options: { thumbnail?: boolean } = {}) {
    const order = index + 1;
    const thumbnail = options.thumbnail ?? false;
    return (
      <div
        className={plannerMediaCardClass(index, thumbnail)}
        draggable={canReorderPlannerMedia}
        key={`${url}-${index}`}
        onDragEnd={endPlannerMediaDrag}
        onDragOver={(event) => handlePlannerMediaDragOver(event, index)}
        onDragStart={(event) => startPlannerMediaDrag(event, index)}
        onDrop={(event) => dropPlannerMedia(event, index)}
      >
        <span className="scheduler-media-card__order" aria-label={`Media order ${order}`}>
          {order}
        </span>
        <button
          className="scheduler-media-card__remove"
          aria-label={`Remove media ${order}`}
          title="Remove media"
          onClick={() => removePlannerMedia(index)}
          type="button"
        >
          <TrashIcon aria-hidden="true" />
        </button>
        {isVideoMediaUrl(url) ? (
          <video className="scheduler-media-card__asset" src={normalizeDashboardMediaUrl(url)} controls playsInline />
        ) : (
          <img
            className="scheduler-media-card__asset"
            src={normalizeDashboardMediaUrl(url)}
            alt={`Uploaded post media ${order}`}
            draggable={false}
          />
        )}
        {canReorderPlannerMedia ? (
          <span className="scheduler-media-card__drag-handle" aria-hidden="true" title="Drag to reorder">
            <Bars3Icon />
          </span>
        ) : null}
      </div>
    );
  }

  function collectPlannerTargets(defaultScheduledFor: string | null, scheduledForByTarget?: Map<string, string>): PlannerPostTarget[] | null {
    const platforms = form.id
      ? uniquePlannerPlatforms([form.platform])
      : selectedModalPlatforms;
    if (platforms.length === 0) {
      setError("Choose at least one platform.");
      return null;
    }

    const targets: PlannerPostTarget[] = [];
    for (const platform of platforms) {
      const selectedAccounts = selectedAccountsForPlatform(platform);
      if (selectedAccounts.length === 0) {
        setError(`Connect an active ${plannerPlatformLabel(platform)} account in Config before creating a post.`);
        return null;
      }
      selectedAccounts.forEach((account) => {
        const key = plannerTargetKey(platform, account.id);
        targets.push({
          platform,
          account,
          scheduledFor: scheduledForByTarget?.get(key) ?? defaultScheduledFor,
        });
      });
    }

    if (targets.some((target) => target.platform === "reddit") && !normalizeSubredditInput(form.subreddit)) {
      setError("Choose a subreddit before creating a Reddit post.");
      return null;
    }
    if (targets.some((target) => target.platform === "instagram") && form.media_urls.length === 0) {
      setError("Instagram posts need at least one image or video. Add media or remove Instagram.");
      return null;
    }

    return targets;
  }

  function chooseAutoSchedulesForTargets(targets: PlannerPostTarget[]) {
    const scheduledByTarget = new Map<string, string>();
    const slotsByPlatform = new Map<SocialAccount["platform"], string[]>();

    targets.forEach((target) => {
      const platformSlots = slotsByPlatform.get(target.platform)
        ?? collectActiveScheduledSocialSlots(items, form.id, { platform: target.platform });
      const scheduledAt = chooseAutoSchedule(platformSlots);
      const scheduledIso = scheduledAt.toISOString();
      scheduledByTarget.set(plannerTargetKey(target.platform, target.account.id), scheduledIso);
      slotsByPlatform.set(target.platform, [...platformSlots, scheduledIso]);
    });

    return scheduledByTarget;
  }

  async function savePlannerItem(
    scheduledFor: string | null,
    options: { publishNow?: boolean; scheduledForByTarget?: Map<string, string> } = {},
  ) {
    clearDescriptionAutosave();
    setNotice(null);
    if (options.publishNow && !form.description.trim()) {
      setError("Add a description before publishing.");
      return;
    }
    const subreddit = normalizeSubredditInput(form.subreddit);
    const targets = collectPlannerTargets(scheduledFor, options.scheduledForByTarget);
    if (!targets) return;

    try {
      setSaving(true);
      setError(null);
      const imageUrl = form.item_type === "post" ? serializePostMediaUrls(form.media_urls) : null;
      const publishNowAt = options.publishNow ? new Date().toISOString() : null;
      const publishFailures: string[] = [];
      let publishedNowCount = 0;
      let savedCount = 0;

      for (const target of targets) {
        const title = buildPlannerTitle(form, target.platform);
        const isRedditPost = target.platform === "reddit";
        const effectiveScheduledFor = target.scheduledFor ?? publishNowAt;
        let socialPostId = form.id ? form.social_post_id ?? null : null;

        if (form.item_type === "post") {
          const socialPostPayload: Partial<SocialPost> & {
            platform: SocialAccount["platform"];
            content: string;
            scheduled_at?: string | null;
            image_url?: string | null;
          } = {
            platform: target.platform,
            title,
            subreddit: isRedditPost ? subreddit : null,
            content: form.description.trim(),
            image_url: imageUrl,
            scheduled_at: effectiveScheduledFor,
            account_id: target.account.id,
            status: effectiveScheduledFor ? "scheduled" : "draft",
          };

          if (socialPostId) {
            await api.updateSocialPost(socialPostId, socialPostPayload);
          } else {
            const socialPost = await api.createSocialPost(target.platform, socialPostPayload);
            socialPostId = socialPost.id;
          }
        }

        const payload: PlannerItemInput = {
          title,
          description: form.description.trim() || null,
          image_url: imageUrl,
          item_type: form.item_type,
          platform: target.platform,
          status: normalizePlannerStatus(form.status),
          scheduled_for: effectiveScheduledFor,
          social_post_id: socialPostId,
          account_id: target.account.id,
          subreddit: isRedditPost ? subreddit : null,
          instruction: isRedditPost ? `subreddit: ${subreddit}` : null,
          related_strategy_id: form.related_strategy_id ? Number(form.related_strategy_id) : null,
        };

        let plannerItemId = form.id ?? null;
        if (form.id) {
          await api.updatePlannerItem(form.id, payload);
        } else {
          const plannerItem = await api.createPlannerItem(payload);
          plannerItemId = plannerItem.id;
        }

        savedCount += 1;

        if (options.publishNow && socialPostId) {
          try {
            await api.publishSocialPost(socialPostId);
            publishedNowCount += 1;
            if (plannerItemId) {
              await api.updatePlannerItem(plannerItemId, {
                status: "published",
                scheduled_for: effectiveScheduledFor,
              });
            }
          } catch (err) {
            const reason = err instanceof Error ? err.message : "publish failed";
            publishFailures.push(`${plannerPlatformLabel(target.platform)} @${target.account.username}: ${reason}`);
          }
        }
      }

      closeModal();
      await load({ silent: true });
      const actionLabel = options.publishNow
        ? publishedNowCount > 0 ? `${publishedNowCount} published now` : `${savedCount} saved`
        : options.scheduledForByTarget
        ? `Auto-scheduled ${savedCount} post${savedCount === 1 ? "" : "s"}`
        : `Planned ${savedCount} post${savedCount === 1 ? "" : "s"}`;
      setNotice(actionLabel || null);
      if (publishFailures.length > 0) {
        setError(`Some targets could not publish: ${publishFailures.join(" | ")}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  }

  function startPublishNow() {
    if (!form.description.trim()) {
      setError("Add a description before publishing.");
      return;
    }
    const targets = collectPlannerTargets(null);
    if (!targets) return;
    setPublishConfirmTargets(targets);
    setIsPublishConfirmOpen(true);
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scheduledFor = form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null;
    if (!scheduledFor) {
      startPublishNow();
      return;
    }
    await savePlannerItem(scheduledFor);
  }

  async function confirmPublishNow() {
    setIsPublishConfirmOpen(false);
    await savePlannerItem(null, { publishNow: true });
  }

  async function autoSchedulePlannerItem() {
    const targets = collectPlannerTargets(null);
    if (!targets) return;
    const scheduledForByTarget = chooseAutoSchedulesForTargets(targets);
    const firstScheduled = scheduledForByTarget.values().next().value;
    if (firstScheduled) {
      setForm((current) => ({ ...current, scheduled_for: toDateTimeLocalValue(new Date(firstScheduled)) }));
    }
    await savePlannerItem(null, { scheduledForByTarget });
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
      const nextForm = { ...form, description: result.value };
      setForm(nextForm);
      queueDescriptionAutosave(nextForm, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to improve description");
    } finally {
      setImprovingDescription(false);
    }
  }

  async function deleteLinkedQueuedSocialPost(socialPostId: number, platform: string) {
    const normalizedPlatform = normalizePlannerAccountPlatform(platform);
    if (!normalizedPlatform) {
      throw new Error("Cannot delete linked post because its platform is unknown.");
    }
    const linkedPost = await api.listSocialPosts(normalizedPlatform)
      .then((posts) => posts.find((post) => post.id === socialPostId) ?? null)
      .catch(() => null);
    if (linkedPost?.status === "posted") {
      throw new Error("This post is already published, so it was not deleted.");
    }
    await api.deleteSocialPost(socialPostId);
  }

  async function deleteSchedule(item: Pick<PlannerItem, "id" | "social_post_id" | "status" | "platform">) {
    try {
      if (normalizePlannerStatus(item.status) !== "published" && item.social_post_id) {
        await deleteLinkedQueuedSocialPost(item.social_post_id, item.platform);
      } else {
        await api.deletePlannerItem(item.id);
      }
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule");
    }
  }

  async function deleteCurrentSchedule() {
    if (!form.id || isPublishedSchedule) return;
    const confirmed = window.confirm("Delete this planned post? This removes it from the calendar and publishing queue.");
    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);
      if (form.social_post_id) {
        await deleteLinkedQueuedSocialPost(form.social_post_id, form.platform);
      } else {
        await api.deletePlannerItem(form.id);
      }
      closeModal();
      setNotice("Deleted planned post.");
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete planned post");
    } finally {
      setSaving(false);
    }
  }

  async function movePlannerItemToWeekSlot(item: PlannerItem, day: Date, hour: number) {
    if (normalizePlannerStatus(item.status) !== "planned") return;

    const nextDate = new Date(day);
    nextDate.setHours(hour, 0, 0, 0);
    const scheduledFor = nextDate.toISOString();
    const previousItems = items;

    setItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id
          ? {
              ...currentItem,
              scheduled_for: scheduledFor,
              status: "planned",
            }
          : currentItem,
      ),
    );

    try {
      if (item.social_post_id) {
        await api.updateSocialPost(item.social_post_id, {
          scheduled_at: scheduledFor,
          status: "scheduled",
        });
      }
      const result = await api.updatePlannerItem(item.id, {
        scheduled_for: scheduledFor,
        status: "planned",
      });
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? {
                ...currentItem,
                scheduled_for: scheduledFor,
                status: "planned",
                updated_at: result.updated_at,
              }
            : currentItem,
        ),
      );
      setError(null);
    } catch (err) {
      setItems(previousItems);
      setError(err instanceof Error ? err.message : "Failed to move schedule");
    }
  }

  const schedulerSearchControl = (
    <div className="scheduler-hero__search">
      <input
        aria-label="Search schedules"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search schedules"
      />
    </div>
  );

  const schedulerNewAction = (
    <div className="scheduler-hero__actions">
      <button onClick={() => openCreateModal()}>New</button>
    </div>
  );

  return (
    <div className="scheduler-page">
      {error ? <p className="error panel">{error}</p> : null}
      {notice ? <p className="success panel">{notice}</p> : null}

      <section className="panel scheduler-overview">
        <div className="scheduler-hero scheduler-hero--minimal scheduler-overview__bar">
          <div className="scheduler-hero__content">
            <SectionTabs
              activeId={view}
              ariaLabel="Planner views"
              className="scheduler-tabs scheduler-tabs--header"
              tabClassName="scheduler-tab"
              activeTabClassName="scheduler-tab--active"
              onChange={selectView}
              items={[
                { id: "calendar", label: "Calendar" },
                { id: "week", label: "Week" },
                { id: "list", label: "List" },
              ]}
            />
          </div>
        </div>

        {loading ? <p className="scheduler-loading">Loading scheduler...</p> : null}

        {view === "list" ? (
        <div className="scheduler-view-panel">
          <div className="panel__title-row scheduler-calendar__header">
            <div className="scheduler-calendar__heading">
              <div className="scheduler-calendar__title-block">
                <h2>Schedule List</h2>
              </div>
            </div>
            <div className="scheduler-calendar__actions">
              {schedulerSearchControl}
              {schedulerNewAction}
            </div>
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
                const microNote = plannerItemMicroNote(item);
                return (
                  <div className="scheduler-list__row" key={item.id}>
                    <span>
                      <button className="scheduler-title-button" onClick={() => openEditModal(item)}>
                        {displayPlannerTitle(item)}
                      </button>
                      {microNote ? (
                        <small className={`scheduler-item-micro-note scheduler-item-micro-note--${microNote.tone}`}>
                          {microNote.label}
                        </small>
                      ) : null}
                      {item.description ? <small>{item.description}</small> : null}
                    </span>
                    <span>
                      <span className={`scheduler-pill scheduler-pill--${item.item_type}`}>
                        <PlannerPlatformLabel platform={item.platform} />
                      </span>
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
                        onClick={() => void deleteSchedule(item)}
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
            <div className="scheduler-calendar__heading">
              <div className="scheduler-calendar__title-block">
                <h2>{formatMonthYear(calendarDate)}</h2>
              </div>
              <div className="scheduler-calendar__nav">
                <button
                  className="button-secondary dashboard-icon-button"
                  onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                  aria-label="Previous month"
                  title="Previous month"
                >
                  <ChevronLeftIcon aria-hidden="true" />
                </button>
                <button
                  className="button-secondary"
                  onClick={() => setCalendarDate(new Date())}
                >
                  Today
                </button>
                <button
                  className="button-secondary dashboard-icon-button"
                  onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                  aria-label="Next month"
                  title="Next month"
                >
                  <ChevronRightIcon aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="scheduler-calendar__actions">
              {schedulerSearchControl}
              {schedulerNewAction}
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
                onClick={() => openCreateModalForDay(day)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openCreateModalForDay(day);
                }}
                role="button"
                tabIndex={0}
                aria-label={`Create post on ${formatMonthDay(day)}`}
              >
                <div className="scheduler-calendar__day-top">
                  <div className="scheduler-calendar__day-number">{day.getDate()}</div>
                </div>
                <div className="scheduler-calendar__events">
                  {dayItems.slice(0, 4).map((item) => {
                    const microNote = plannerItemMicroNote(item);
                    return (
                      <button
                        key={item.id}
                        className={`scheduler-calendar__event scheduler-calendar__event--${item.item_type}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditModal(item);
                        }}
                      >
                        <span className="scheduler-calendar__event-time">
                          {item.scheduled_for ? formatDisplayTime(item.scheduled_for) : "Any time"}
                        </span>
                        <span className="scheduler-calendar__event-body">
                          <span className="scheduler-calendar__event-title">{displayPlannerTitle(item)}</span>
                          {microNote ? (
                            <span className={`scheduler-item-micro-note scheduler-item-micro-note--${microNote.tone}`}>
                              {microNote.label}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
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
            <div className="scheduler-calendar__heading">
              <div className="scheduler-calendar__title-block">
                <h2>{formatMonthYear(calendarDate)}</h2>
                <p className="scheduler-week__range">{weekRangeLabel}</p>
              </div>
              <div className="scheduler-calendar__nav">
                <button
                  className="button-secondary dashboard-icon-button"
                  onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7))}
                  aria-label="Previous week"
                  title="Previous week"
                >
                  <ChevronLeftIcon aria-hidden="true" />
                </button>
                <button
                  className="button-secondary"
                  onClick={() => setCalendarDate(new Date())}
                >
                  Today
                </button>
                <button
                  className="button-secondary dashboard-icon-button"
                  onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + 7))}
                  aria-label="Next week"
                  title="Next week"
                >
                  <ChevronRightIcon aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="scheduler-calendar__actions">
              {schedulerSearchControl}
              {schedulerNewAction}
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
                {weekItemsByDay.map(({ day, itemsByHour }) => {
                  const slotKey = `${day.toISOString()}-${slot.hour}`;
                  return (
                    <div
                      key={slotKey}
                      className={`scheduler-week__cell${sameDay(day, today) ? " scheduler-week__cell--today" : ""}${
                        dragOverWeekSlot === slotKey ? " scheduler-week__cell--drag-over" : ""
                      }`}
                      onDragOver={(event) => {
                        if (!draggingPlannerItemId) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverWeekSlot(slotKey);
                      }}
                      onDragLeave={(event) => {
                        const nextTarget = event.relatedTarget;
                        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                        setDragOverWeekSlot((current) => (current === slotKey ? null : current));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const droppedItemId = Number(event.dataTransfer.getData("text/plain") || draggingPlannerItemId);
                        const droppedItem = items.find((plannerItem) => plannerItem.id === droppedItemId);
                        setDraggingPlannerItemId(null);
                        setDragOverWeekSlot(null);
                        if (droppedItem) void movePlannerItemToWeekSlot(droppedItem, day, slot.hour);
                      }}
                      onClick={(event) => {
                        if (event.target !== event.currentTarget || draggingPlannerItemId) return;
                        openCreateModalForWeekSlot(day, slot.hour);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openCreateModalForWeekSlot(day, slot.hour);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Create post on ${formatMonthDay(day)} at ${slot.label}`}
                    >
                      {itemsByHour[slot.hour]?.map((item) => {
                        const status = normalizePlannerStatus(item.status);
                        const canDragSchedule = status === "planned";
                        const microNote = plannerItemMicroNote(item);
                        return (
                          <button
                            key={item.id}
                            className={`scheduler-week__slot-item scheduler-week__slot-item--${item.item_type}${
                              canDragSchedule ? " scheduler-week__slot-item--draggable" : ""
                            }${draggingPlannerItemId === item.id ? " scheduler-week__slot-item--dragging" : ""}`}
                            draggable={canDragSchedule}
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditModal(item);
                            }}
                            onDragEnd={() => {
                              setDraggingPlannerItemId(null);
                              setDragOverWeekSlot(null);
                            }}
                            onDragStart={(event) => {
                              if (!canDragSchedule) {
                                event.preventDefault();
                                return;
                              }
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", String(item.id));
                              setDraggingPlannerItemId(item.id);
                            }}
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
                            {microNote ? (
                              <span className={`scheduler-item-micro-note scheduler-item-micro-note--${microNote.tone}`} title={microNote.title}>
                                {microNote.label}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
        )}
      </section>

      {isModalOpen ? (
        <div className="scheduler-modal-backdrop">
          <div className="scheduler-modal" onClick={(event) => event.stopPropagation()}>
            <form className="stack" onSubmit={saveSchedule}>
              <div className="panel__title-row">
                <h2>{form.id ? "Edit Schedule" : "New post"}</h2>
                <div className="scheduler-modal-title-actions">
                  {canDeleteModalSchedule ? (
                    <button
                      aria-label="Delete planned post"
                      className="scheduler-modal-delete-button"
                      disabled={saving}
                      onClick={() => void deleteCurrentSchedule()}
                      title="Delete planned post"
                      type="button"
                    >
                      <TrashIcon aria-hidden="true" />
                    </button>
                  ) : null}
                  <ModalCloseButton onClick={closeModal} />
                </div>
              </div>
              <div className="scheduler-modal-meta-row">
                <div className="scheduler-platform-field">
                  <p className="scheduler-media-field__label">Platforms</p>
                  {canSelectModalPlatform ? (
                    <div className="scheduler-platform-chips" role="group" aria-label="Platforms">
                      {modalPlatforms.map((platform) => (
                        <button
                          key={platform}
                          type="button"
                          className={`scheduler-platform-chip${selectedModalPlatforms.includes(platform) ? " scheduler-platform-chip--active" : ""}`}
                          onClick={() => toggleModalPlatform(platform)}
                          aria-pressed={selectedModalPlatforms.includes(platform)}
                        >
                          <PlannerPlatformLabel platform={platform} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="scheduler-platform-chips scheduler-platform-chips--static" aria-label="Platform">
                      <span className="scheduler-platform-chip scheduler-platform-chip--active">
                        <PlannerPlatformLabel platform={form.platform || modalPlatformLabel} />
                      </span>
                    </div>
                  )}
                </div>
                {form.id ? (
                  <div className="scheduler-modal-status-field">
                    <p className="scheduler-media-field__label">Status</p>
                    <span className={`scheduler-status-chip scheduler-status-chip--${modalStatus}`}>
                      {plannerStatusLabel(modalStatus)}
                    </span>
                  </div>
                ) : null}
              </div>
              {selectedModalPlatforms.length > 0 ? (
                <div className="scheduler-account-field">
                  <span className="scheduler-media-field__label">Accounts</span>
                  <div className="scheduler-account-targets">
                    {selectedModalPlatforms.map((platform) => {
                      const accounts = accountsForPlatform(platform);
                      const selectedIds = selectedAccountIdsByPlatform[platform] ?? [];
                      return (
                        <div className="scheduler-account-target" key={platform}>
                          <div className="scheduler-account-target__header">
                            <strong>
                              <PlannerPlatformLabel platform={platform} />
                            </strong>
                            <small>{selectedIds.length > 0 ? "1 selected" : "Choose account"}</small>
                          </div>
                          {accounts.length > 0 ? (
                            <div className="scheduler-account-target__options">
                              {accounts.map((account) => {
                                const accountId = String(account.id);
                                const checked = selectedIds.includes(accountId);
                                return (
                                  <label
                                    className="scheduler-account-option"
                                    key={`${account.platform}-${account.id}`}
                                    title={plannerAccountLabel(account)}
                                  >
                                    <input
                                      type="radio"
                                      name={`scheduler-account-${platform}`}
                                      checked={checked}
                                      disabled={!canSelectModalPlatform}
                                      onChange={(event) => setPlatformAccountSelection(platform, accountId, event.target.checked)}
                                    />
                                    <span className="scheduler-account-option__check" aria-hidden="true" />
                                    <span className="scheduler-account-option__content">
                                      <strong>@{account.username}</strong>
                                      <small>Official API</small>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="scheduler-reddit-target__hint">No active account connected.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {isRedditModal ? (
                <div className="scheduler-reddit-target">
                  <div className="scheduler-reddit-target__row">
                    <label className="scheduler-reddit-target__field">
                      <span className="scheduler-field-label-row">
                        <span>Subreddit</span>
                        {selectedRedditAccounts.length > 0 ? (
                          <small>{selectedRedditAccounts.map((account) => `@${account.name}`).join(", ")}</small>
                        ) : selectedRedditAccount ? (
                          <small>@{selectedRedditAccount.name}</small>
                        ) : null}
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
                  onBlur={flushDescriptionAutosave}
                  onChange={(event) => {
                    const nextForm = { ...form, description: event.target.value };
                    setForm(nextForm);
                    queueDescriptionAutosave(nextForm);
                  }}
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
                          {plannerVideoMedia.map(({ url, index }) => renderPlannerMediaCard(url, index))}
                        </div>
                        <div className="scheduler-media-thumbnails">
                          {plannerImageMedia.map(({ url, index }) => renderPlannerMediaCard(url, index, { thumbnail: true }))}
                        </div>
                      </div>
                    ) : (
                      <div className="scheduler-media-grid">
                        {form.media_urls.map((url, index) => renderPlannerMediaCard(url, index))}
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
                  {saving ? "Working..." : form.scheduled_for ? "Schedule" : "Publish"}
                </button>
                {form.scheduled_for ? (
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={saving}
                    onClick={startPublishNow}
                  >
                    Publish now
                  </button>
                ) : null}
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
      {isPublishConfirmOpen ? (
        <div className="scheduler-confirm-backdrop">
          <div
            className="scheduler-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduler-publish-confirm-title"
          >
            <div className="scheduler-confirm-modal__icon" aria-hidden="true">
              <ExclamationTriangleIcon />
            </div>
            <div className="scheduler-confirm-modal__body">
              <div className="panel__title-row">
                <div>
                  <h2 id="scheduler-publish-confirm-title">Publish now?</h2>
                  <p>This will send the post to the selected targets now.</p>
                </div>
                <ModalCloseButton onClick={() => setIsPublishConfirmOpen(false)} />
              </div>
              <div className="scheduler-confirm-targets" aria-label="Publishing targets">
                {publishConfirmTargets.map((target) => (
                  <div className="scheduler-confirm-target" key={plannerTargetKey(target.platform, target.account.id)}>
                    <strong>
                      <PlannerPlatformLabel platform={target.platform} />
                    </strong>
                    <span>@{target.account.username}</span>
                    <small>Official API</small>
                  </div>
                ))}
              </div>
              <div className="scheduler-confirm-actions">
                <button
                  className="button-secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => setIsPublishConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button type="button" disabled={saving} onClick={() => void confirmPublishNow()}>
                  {saving ? "Publishing..." : "Publish now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
