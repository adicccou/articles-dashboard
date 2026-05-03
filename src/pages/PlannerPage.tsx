import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import type { PlannerItem, PlannerItemInput, TradingStrategy } from "../lib/types";
import "../styles/planner-page.css";

type SchedulerView = "list" | "calendar";
type SchedulerStatus = PlannerItem["status"] | "all";
type SchedulerType = PlannerItem["item_type"] | "all";

const schedulerStatuses: PlannerItem["status"][] = [
  "planned",
  "drafting",
  "approved",
  "published",
  "archived",
];

const schedulerPlatforms = ["Blog", "X", "Threads", "Reddit", "Newsletter", "Telegram"];

type ScheduleFormState = {
  id?: number;
  title: string;
  description: string;
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
    item_type: "post",
    platform: "Threads",
    status: "planned",
    scheduled_for: "",
    related_strategy_id: "",
  };
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

export function PlannerPage() {
  const [items, setItems] = useState<PlannerItem[]>([]);
  const [strategies, setStrategies] = useState<TradingStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SchedulerView>("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SchedulerStatus>("all");
  const [typeFilter, setTypeFilter] = useState<SchedulerType>("all");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<ScheduleFormState>(createEmptyScheduleForm());

  async function load({ silent = false } = {}) {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const [plannerItems, tradingStrategies] = await Promise.all([
        api.listPlannerItems(),
        api.listTradingStrategies(),
      ]);

      setItems(asArray<PlannerItem>(plannerItems));
      setStrategies(asArray<TradingStrategy>(tradingStrategies));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scheduler");
    } finally {
      setLoading(false);
      setRefreshing(false);
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

      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesType = typeFilter === "all" || item.item_type === typeFilter;

      return matchesQuery && matchesStatus && matchesType;
    });
  }, [items, search, statusFilter, typeFilter]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const metrics = useMemo(() => {
    const now = new Date();
    const monthEnd = endOfMonth(now);
    return {
      total: items.length,
      posts: items.filter((item) => item.item_type === "post").length,
      campaigns: items.filter((item) => item.item_type === "campaign").length,
      thisMonth: items.filter((item) => {
        if (!item.scheduled_for) return false;
        const date = new Date(item.scheduled_for);
        return date >= now && date <= monthEnd;
      }).length,
    };
  }, [items]);

  const calendarDays = useMemo(() => monthGrid(calendarDate), [calendarDate]);

  const calendarItemsByDay = useMemo(() => {
    return calendarDays.map((day) => ({
      day,
      items: filteredItems.filter((item) => item.scheduled_for && sameDay(new Date(item.scheduled_for), day)),
    }));
  }, [calendarDays, filteredItems]);

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

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim() || !form.platform.trim()) {
      setError("Title and platform are required.");
      return;
    }

    try {
      setSaving(true);
      const payload: PlannerItemInput = {
        title: form.title.trim(),
        description: form.description.trim() || null,
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

  async function updateStatus(id: number, status: PlannerItem["status"]) {
    try {
      await api.updatePlannerItem(id, { status });
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading scheduler...</div>;
  }

  return (
    <div className="scheduler-page">
      {error ? <p className="error panel">{error}</p> : null}

      <section className="panel scheduler-hero">
        <div>
          <p className="scheduler-eyebrow">Scheduling Workspace</p>
          <h2>Scheduler</h2>
          <p className="scheduler-hero__copy">
            Keep planned posts and campaigns in one place, then switch between list and calendar views.
          </p>
        </div>
        <div className="scheduler-hero__actions">
          <button className="button-secondary" onClick={() => void load({ silent: true })} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button onClick={openCreateModal}>New Schedule</button>
        </div>
      </section>

      <section className="scheduler-metrics">
        <article className="scheduler-metric">
          <span>Total</span>
          <strong>{metrics.total}</strong>
        </article>
        <article className="scheduler-metric">
          <span>Posts</span>
          <strong>{metrics.posts}</strong>
        </article>
        <article className="scheduler-metric">
          <span>Campaigns</span>
          <strong>{metrics.campaigns}</strong>
        </article>
        <article className="scheduler-metric">
          <span>Scheduled this month</span>
          <strong>{metrics.thisMonth}</strong>
        </article>
      </section>

      <section className="panel scheduler-toolbar">
        <div className="scheduler-tabs">
          <button
            className={view === "list" ? "scheduler-tab scheduler-tab--active" : "scheduler-tab"}
            onClick={() => setView("list")}
          >
            List
          </button>
          <button
            className={view === "calendar" ? "scheduler-tab scheduler-tab--active" : "scheduler-tab"}
            onClick={() => setView("calendar")}
          >
            Calendar view
          </button>
        </div>
        <div className="scheduler-filters">
          <label>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search schedules"
            />
          </label>
          <label>
            Type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as SchedulerType)}>
              <option value="all">All</option>
              <option value="post">Posts</option>
              <option value="campaign">Campaigns</option>
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SchedulerStatus)}>
              <option value="all">All</option>
              {schedulerStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {view === "list" ? (
        <section className="panel">
          <div className="panel__title-row">
            <h2>Schedule List</h2>
          </div>
          {filteredItems.length === 0 ? (
            <p className="scheduler-empty">No schedules yet. Create one from the New Schedule button.</p>
          ) : (
            <div className="scheduler-list">
              <div className="scheduler-list__row scheduler-list__row--header">
                <span>Title</span>
                <span>Type</span>
                <span>Platform</span>
                <span>Status</span>
                <span>Scheduled</span>
                <span>Strategy</span>
                <span>Actions</span>
              </div>
              {filteredItems.map((item) => (
                <div
                  className={`scheduler-list__row${selectedItemId === item.id ? " scheduler-list__row--selected" : ""}`}
                  key={item.id}
                >
                  <span>
                    <button className="scheduler-title-button" onClick={() => setSelectedItemId(item.id)}>
                      {item.title}
                    </button>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                  <span>
                    <span className={`scheduler-pill scheduler-pill--${item.item_type}`}>{item.item_type}</span>
                  </span>
                  <span>{item.platform}</span>
                  <span>
                    <select
                      value={item.status}
                      onChange={(event) => void updateStatus(item.id, event.target.value as PlannerItem["status"])}
                    >
                      {schedulerStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span>{item.scheduled_for ? new Date(item.scheduled_for).toLocaleString() : "—"}</span>
                  <span>{item.related_strategy_name || "—"}</span>
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
      ) : (
        <section className="panel scheduler-calendar">
          <div className="panel__title-row">
            <h2>{calendarDate.toLocaleString("en-US", { month: "long", year: "numeric" })}</h2>
            <div className="scheduler-calendar__nav">
              <button
                className="button-secondary"
                onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              >
                Prev
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
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="scheduler-calendar__grid">
            {calendarItemsByDay.map(({ day, items: dayItems }) => (
              <div
                key={day.toISOString()}
                className={`scheduler-calendar__day${
                  day.getMonth() !== calendarDate.getMonth() ? " scheduler-calendar__day--muted" : ""
                }`}
              >
                <div className="scheduler-calendar__day-number">{day.getDate()}</div>
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
                      {item.title}
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
              <h3>{selectedItem.title}</h3>
            </div>
            <div>
              <p className="scheduler-eyebrow">Type</p>
              <p>{selectedItem.item_type}</p>
            </div>
            <div>
              <p className="scheduler-eyebrow">Platform</p>
              <p>{selectedItem.platform}</p>
            </div>
            <div>
              <p className="scheduler-eyebrow">Status</p>
              <p>{selectedItem.status}</p>
            </div>
            <div>
              <p className="scheduler-eyebrow">Scheduled For</p>
              <p>{selectedItem.scheduled_for ? new Date(selectedItem.scheduled_for).toLocaleString() : "Not scheduled"}</p>
            </div>
            <div>
              <p className="scheduler-eyebrow">Related Strategy</p>
              <p>{selectedItem.related_strategy_name || "—"}</p>
            </div>
          </div>
          {selectedItem.description ? (
            <div className="scheduler-detail__description">
              <p className="scheduler-eyebrow">Description</p>
              <p>{selectedItem.description}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {isModalOpen ? (
        <div className="scheduler-modal-backdrop" onClick={closeModal}>
          <div className="scheduler-modal" onClick={(event) => event.stopPropagation()}>
            <form className="stack" onSubmit={saveSchedule}>
              <div className="panel__title-row">
                <h2>{form.id ? "Edit Schedule" : "New Schedule"}</h2>
                <button type="button" className="button-secondary" onClick={closeModal}>
                  Close
                </button>
              </div>
              <div className="grid-two">
                <label>
                  Type
                  <select
                    value={form.item_type}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        item_type: event.target.value as PlannerItem["item_type"],
                      }))
                    }
                  >
                    <option value="post">Planned Post</option>
                    <option value="campaign">Campaign</option>
                  </select>
                </label>
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
              </div>
              <label>
                Title
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder={form.item_type === "campaign" ? "Launch warmup campaign" : "Weekly BTC reaction post"}
                  required
                />
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
              <div className="grid-two">
                <label>
                  Status
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, status: event.target.value as PlannerItem["status"] }))
                    }
                  >
                    {schedulerStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
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
              </div>
              <label>
                Related Strategy
                <select
                  value={form.related_strategy_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, related_strategy_id: event.target.value }))
                  }
                >
                  <option value="">No linked strategy</option>
                  {strategies.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={saving}>
                {saving ? "Saving..." : form.id ? "Update Schedule" : "Create Schedule"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
