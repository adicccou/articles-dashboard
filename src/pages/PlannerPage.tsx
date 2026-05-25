import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { formatDisplayDateTime, formatDisplayTime, formatMonthDay, formatMonthYear, formatWeekRange, formatWeekdayShort } from "../lib/datetime";
import { getPostImageUrls, isVideoMediaUrl, serializePostMediaUrls } from "../lib/socialPostMedia";
import type { PlannerItem, PlannerItemInput } from "../lib/types";
import "../styles/planner-page.css";

type SchedulerView = "list" | "calendar" | "week";

const schedulerPlatforms = ["Blog", "X", "Threads", "Reddit", "Newsletter", "Telegram"];

type ScheduleFormState = {
  id?: number;
  title: string;
  description: string;
  media_urls: string[];
  item_type: PlannerItem["item_type"];
  platform: string;
  status: PlannerItem["status"];
  scheduled_for: string;
  related_strategy_id: string;
};

function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function createEmptyScheduleForm(): ScheduleFormState {
  return {
    title: "",
    description: "",
    media_urls: [],
    item_type: "post",
    platform: "Threads",
    status: "planned",
    scheduled_for: "",
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
  if (normalized === "newsletter") return "Newsletter";
  if (normalized === "telegram") return "Telegram";
  if (normalized === "blog") return "Blog";
  const clean = platform.trim();
  return clean ? `${clean.charAt(0).toUpperCase()}${clean.slice(1)}` : "Platform";
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
  const genericPrefix = new RegExp(`^(?:threads|thread|twitter/x|twitter|x|reddit|telegram|newsletter|blog)\\s+${type}\\s*:\\s*`, "i");
  const cleaned = rawTitle
    .replace(platformPrefix ?? /^$/, "")
    .replace(genericPrefix, "")
    .trim();
  return cleaned || rawTitle;
}

function plannerStatusLabel(status: PlannerItem["status"]): string {
  return status === "published" ? "published" : status;
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

export function PlannerPage() {
  const [items, setItems] = useState<PlannerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [view, setView] = useState<SchedulerView>("list");
  const [search, setSearch] = useState("");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<ScheduleFormState>(createEmptyScheduleForm());
  const submitLabel = form.scheduled_for ? "Schedule it" : "Publish";
  const submitBusyLabel = form.scheduled_for ? "Scheduling..." : "Publishing...";

  async function load({ silent = false } = {}) {
    try {
      if (!silent) {
        setLoading(true);
      }

      const plannerItems = await api.listPlannerItems();
      setItems(asArray<PlannerItem>(plannerItems));
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

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

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

      return {
        day,
        items: itemsForDay,
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

  function openCreateModal() {
    setForm(createEmptyScheduleForm());
    setSelectedItemId(null);
    setIsModalOpen(true);
  }

  function openEditModal(item: PlannerItem) {
    setForm({
      id: item.id,
      title: item.title,
      description: item.description ?? "",
      media_urls: getPostImageUrls(item.image_url),
      item_type: item.item_type,
      platform: item.platform,
      status: item.status,
      scheduled_for: toLocalDateTimeInput(item.scheduled_for),
      related_strategy_id: item.related_strategy_id ? String(item.related_strategy_id) : "",
    });
    setSelectedItemId(item.id);
    setIsModalOpen(true);
  }

  function closeModal() {
    setForm(createEmptyScheduleForm());
    setIsModalOpen(false);
  }

  async function uploadPlannerMedia(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
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

  function removePlannerMedia(index: number) {
    setForm((current) => ({
      ...current,
      media_urls: current.media_urls.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.platform.trim()) {
      setError("Platform is required.");
      return;
    }

    try {
      setSaving(true);
      const payload: PlannerItemInput = {
        title: buildPlannerTitle(form),
        description: form.description.trim() || null,
        image_url: form.item_type === "post" ? serializePostMediaUrls(form.media_urls) : null,
        item_type: form.item_type,
        platform: form.platform,
        status: form.status,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
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

  async function deleteSchedule(id: number) {
    try {
      await api.deletePlannerItem(id);
      if (selectedItemId === id) {
        setSelectedItemId(null);
      }
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

      <section className="panel scheduler-hero scheduler-hero--minimal">
        <div className="scheduler-hero__content">
          <div className="ui-tabs__list scheduler-tabs scheduler-tabs--header">
            <button
              className={view === "list" ? "ui-tab scheduler-tab ui-tab--active scheduler-tab--active" : "ui-tab scheduler-tab"}
              onClick={() => setView("list")}
            >
              List
            </button>
            <button
              className={view === "calendar" ? "ui-tab scheduler-tab ui-tab--active scheduler-tab--active" : "ui-tab scheduler-tab"}
              onClick={() => setView("calendar")}
            >
              Calendar view
            </button>
            <button
              className={view === "week" ? "ui-tab scheduler-tab ui-tab--active scheduler-tab--active" : "ui-tab scheduler-tab"}
              onClick={() => setView("week")}
            >
              Week view
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
      </section>

      {view === "list" ? (
        <section className="panel">
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
              {filteredItems.map((item) => (
                <div
                  className={`scheduler-list__row${selectedItemId === item.id ? " scheduler-list__row--selected" : ""}`}
                  key={item.id}
                >
                  <span>
                    <button className="scheduler-title-button" onClick={() => setSelectedItemId(item.id)}>
                      {displayPlannerTitle(item)}
                    </button>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                  <span>
                    <span className={`scheduler-pill scheduler-pill--${item.item_type}`}>{plannerPlatformLabel(item.platform)}</span>
                  </span>
                  <span>
                    <span className={`scheduler-status-chip scheduler-status-chip--${item.status}`}>
                      {plannerStatusLabel(item.status)}
                    </span>
                  </span>
                  <span>{item.scheduled_for ? formatDisplayDateTime(item.scheduled_for) : "—"}</span>
                  <span className="scheduler-row-actions">
                    <button className="button-secondary" onClick={() => openEditModal(item)}>
                      Edit
                    </button>
                    <button className="scheduler-delete" onClick={() => void deleteSchedule(item.id)}>
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : view === "calendar" ? (
        <section className="panel scheduler-calendar">
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
                  {dayItems.length > 0 ? (
                    <span className="scheduler-calendar__day-count">{dayItems.length}</span>
                  ) : null}
                </div>
                <div className="scheduler-calendar__events">
                  {dayItems.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      className={`scheduler-calendar__event scheduler-calendar__event--${item.item_type}`}
                      onClick={() => {
                        setSelectedItemId(item.id);
                        openEditModal(item);
                      }}
                    >
                      <span className="scheduler-calendar__event-meta">
                        <span>{item.scheduled_for ? formatDisplayTime(item.scheduled_for) : "Any time"}</span>
                        <span className={`scheduler-pill scheduler-pill--${item.item_type}`}>{plannerPlatformLabel(item.platform)}</span>
                      </span>
                      <strong>{displayPlannerTitle(item)}</strong>
                    </button>
                  ))}
                  {dayItems.length > 3 ? (
                    <span className="scheduler-calendar__more">+{dayItems.length - 3} more</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel scheduler-week">
          <div className="panel__title-row scheduler-week__header">
            <div>
              <h2>This Week</h2>
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
          <div className="scheduler-week__grid">
            {weekItemsByDay.map(({ day, items: dayItems }) => (
              <div key={day.toISOString()} className={`scheduler-week__day${sameDay(day, today) ? " scheduler-week__day--today" : ""}`}>
                <div className="scheduler-week__day-header">
                  <div className="scheduler-week__day-heading">
                    <p className="scheduler-week__day-label">
                      {formatWeekdayShort(day)}
                    </p>
                    <strong>{formatMonthDay(day)}</strong>
                  </div>
                  <span className="scheduler-week__count">{dayItems.length}</span>
                </div>
                {dayItems.length === 0 ? (
                  <p className="scheduler-week__empty">No planned posts or campaigns.</p>
                ) : (
                  <div className="scheduler-week__items">
                    {dayItems.map((item) => (
                      <button
                        key={item.id}
                        className={`scheduler-week__item scheduler-week__item--${item.item_type}`}
                        onClick={() => setSelectedItemId(item.id)}
                      >
                        <div className="scheduler-week__item-top">
                          <span className={`scheduler-pill scheduler-pill--${item.item_type}`}>{plannerPlatformLabel(item.platform)}</span>
                          <span className="scheduler-week__meta">
                            {item.scheduled_for ? formatDisplayTime(item.scheduled_for) : "Any time"}
                          </span>
                        </div>
                        <strong>{displayPlannerTitle(item)}</strong>
                        <span className="scheduler-week__meta">
                          {item.status}
                          {item.related_strategy_name ? ` • ${item.related_strategy_name}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {selectedItem ? (
        <section className="panel scheduler-detail">
          <div className="panel__title-row">
            <h2>Selected Schedule</h2>
            <button className="button-secondary" onClick={() => setSelectedItemId(null)}>
              Clear
            </button>
          </div>
          <div className="scheduler-detail__grid">
            <div>
              <p className="scheduler-eyebrow">Title</p>
              <h3>{displayPlannerTitle(selectedItem)}</h3>
            </div>
            <div>
              <p className="scheduler-eyebrow">Channel</p>
              <p>{plannerPlatformLabel(selectedItem.platform)}</p>
            </div>
            <div>
              <p className="scheduler-eyebrow">Status</p>
              <p>{selectedItem.status}</p>
            </div>
            <div>
              <p className="scheduler-eyebrow">Scheduled For</p>
              <p>{selectedItem.scheduled_for ? formatDisplayDateTime(selectedItem.scheduled_for) : "Not scheduled"}</p>
            </div>
          </div>
          {selectedItem.description ? (
            <div className="scheduler-detail__description">
              <p className="scheduler-eyebrow">Description</p>
              <p>{selectedItem.description}</p>
            </div>
          ) : null}
          {getPostImageUrls(selectedItem.image_url).length > 0 ? (
            <div className="scheduler-detail__description">
              <p className="scheduler-eyebrow">Media</p>
              <div className="scheduler-media-grid">
                {getPostImageUrls(selectedItem.image_url).map((url, index) => (
                  <div className="scheduler-media-card" key={`${url}-${index}`}>
                    {isVideoMediaUrl(url) ? (
                      <video className="scheduler-media-card__asset" src={url} controls playsInline />
                    ) : (
                      <img className="scheduler-media-card__asset" src={url} alt={`${selectedItem.title} media ${index + 1}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {isModalOpen ? (
        <div className="scheduler-modal-backdrop" onClick={closeModal}>
          <div className="scheduler-modal" onClick={(event) => event.stopPropagation()}>
            <form className="stack" onSubmit={saveSchedule}>
              <div className="panel__title-row">
                <h2>{form.id ? "Edit Schedule" : "New post"}</h2>
                <button type="button" className="button-secondary" onClick={closeModal}>
                  Close
                </button>
              </div>
              <label>
                Platform
                <select
                  value={form.platform}
                  onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))}
                >
                  {schedulerPlatforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <textarea
                  rows={4}
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder={form.item_type === "campaign" ? "Campaign brief, audience, CTA" : "Post angle, CTA, or draft outline"}
                />
              </label>
              {form.item_type === "post" ? (
                <div className="scheduler-media-field stack">
                  <div className="scheduler-media-field__header">
                    <div>
                      <label className="scheduler-media-field__label">Media</label>
                      <p className="scheduler-media-field__hint">Attach one video or one or more images for this post.</p>
                    </div>
                    <label className="button-secondary scheduler-media-upload">
                      <input
                        accept="image/*,video/*"
                        multiple
                        onChange={(event) => void uploadPlannerMedia(event)}
                        type="file"
                      />
                      {uploadingMedia ? "Uploading..." : form.media_urls.length ? "Add media" : "Upload media"}
                    </label>
                  </div>
                  {form.media_urls.length > 0 ? (
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
                  ) : (
                    <p className="scheduler-media-field__empty">No media attached yet.</p>
                  )}
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
              <button type="submit" disabled={saving}>
                {saving ? submitBusyLabel : submitLabel}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
