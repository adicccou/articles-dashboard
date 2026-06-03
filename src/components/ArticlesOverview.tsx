import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, TrashIcon } from "@heroicons/react/24/solid";
import type { ArticleRecord } from "../lib/types";
import { formatDisplayDate, formatDisplayTime, formatMonthDay, formatMonthYear, formatWeekRange, formatWeekdayShort } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import { SectionTabs } from "./SectionTabs";
import "../styles/planner-page.css";

type ArticlesOverviewProps = {
  articles: ArticleRecord[];
  onNewArticle: (scheduledAt?: Date) => void;
  onSelectArticle: (article: ArticleRecord) => void;
  onDeleteArticle: (article: ArticleRecord) => Promise<void>;
};

type ArticleView = "month" | "week" | "list";

const ARTICLE_VIEW_STORAGE_KEY = "dashboard:articles:view";
const DEFAULT_SCHEDULE_HOUR = 10;
const WEEK_HOUR_SLOTS = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  label: `${String(hour).padStart(2, "0")}:00`,
}));

function isArticleView(value: string | null): value is ArticleView {
  return value === "month" || value === "week" || value === "list";
}

function readStoredArticleView(): ArticleView {
  if (typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem(ARTICLE_VIEW_STORAGE_KEY);
  return isArticleView(stored) ? stored : "list";
}

function storeArticleView(view: ArticleView) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ARTICLE_VIEW_STORAGE_KEY, view);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
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

function slotDateTime(day: Date, hour = DEFAULT_SCHEDULE_HOUR): Date {
  const scheduledAt = new Date(day);
  scheduledAt.setHours(hour, 0, 0, 0);
  return scheduledAt;
}

function isFutureArticle(article: ArticleRecord): boolean {
  return Boolean(article.status === "published" && article.published_at && new Date(article.published_at).getTime() > Date.now());
}

function articleStatusLabel(article: ArticleRecord): string {
  if (article.status === "draft") return "Draft";
  return isFutureArticle(article) ? "Scheduled" : "Published";
}

function articleStatusClass(article: ArticleRecord): string {
  if (article.status === "draft") return "draft";
  return isFutureArticle(article) ? "scheduled" : "published";
}

function articleTimingValue(article: ArticleRecord): string | null {
  return article.published_at ?? null;
}

function articleSortValue(article: ArticleRecord): number {
  return new Date(articleTimingValue(article) ?? article.updated_at).getTime();
}

export function ArticlesOverview({
  articles,
  onNewArticle,
  onSelectArticle,
  onDeleteArticle,
}: ArticlesOverviewProps) {
  const [view, setView] = useState<ArticleView>(() => readStoredArticleView());
  const [calendarDate, setCalendarDate] = useState(() => new Date());

  useEffect(() => {
    storeArticleView(view);
  }, [view]);

  const today = useMemo(() => new Date(), []);
  const scheduledArticles = useMemo(
    () => articles
      .filter((article) => Boolean(article.published_at))
      .sort((left, right) => articleSortValue(left) - articleSortValue(right)),
    [articles],
  );
  const monthDays = useMemo(() => monthGrid(calendarDate), [calendarDate]);
  const weekRangeDays = useMemo(() => weekDays(calendarDate), [calendarDate]);
  const weekRangeLabel = useMemo(
    () => formatWeekRange(weekRangeDays[0], weekRangeDays[weekRangeDays.length - 1]),
    [weekRangeDays],
  );
  const monthItemsByDay = useMemo(
    () => monthDays.map((day) => ({
      day,
      items: scheduledArticles.filter((article) => {
        const publishedAt = articleTimingValue(article);
        return publishedAt ? sameDay(new Date(publishedAt), day) : false;
      }),
    })),
    [monthDays, scheduledArticles],
  );
  const weekItemsByDay = useMemo(
    () => weekRangeDays.map((day) => ({
      day,
      items: scheduledArticles.filter((article) => {
        const publishedAt = articleTimingValue(article);
        return publishedAt ? sameDay(new Date(publishedAt), day) : false;
      }),
    })),
    [scheduledArticles, weekRangeDays],
  );

  const headerTabs = (
    <SectionTabs
      activeId={view}
      ariaLabel="Article views"
      className="scheduler-tabs scheduler-tabs--header"
      tabClassName="scheduler-tab"
      activeTabClassName="scheduler-tab--active"
      onChange={setView}
      items={[
        { id: "month", label: "Month" },
        { id: "week", label: "Week" },
        { id: "list", label: "List" },
      ]}
    />
  );

  const newArticleAction = (
    <div className="scheduler-hero__actions">
      <button type="button" onClick={() => onNewArticle()}>New article</button>
    </div>
  );

  if (view === "list") {
    return (
      <section className="panel articles-overview">
        <div className="articles-overview__content">
          <div className="scheduler-hero scheduler-hero--minimal articles-overview__toolbar">
            <div className="scheduler-hero__content">
              {headerTabs}
            </div>
            {newArticleAction}
          </div>
          <div className="table articles-table">
            <div className="table__row table__row--header">
              <span>Title</span>
              <span>Category</span>
              <span>Status</span>
              <span>Sites</span>
              <span>Updated</span>
            </div>
            {articles.map((article) => (
              <div className="table__row article-row" key={article.id} onClick={() => onSelectArticle(article)}>
                <span className="article-row__title">
                  {article.cover_image ? (
                    <img
                      className="article-row__thumbnail"
                      src={normalizeDashboardMediaUrl(article.cover_image)}
                      alt=""
                      loading="lazy"
                    />
                  ) : null}
                  <span className="article-row__title-copy">
                    <span className="article-row__title-text">{article.title}</span>
                    <span className="article-row__title-meta">
                      <span className="article-row__slug">/{article.slug}</span>
                      {article.excerpt ? (
                        <span className="article-row__excerpt">{article.excerpt}</span>
                      ) : null}
                    </span>
                  </span>
                </span>
                <span className="article-row__category">{article.category?.name || "Uncategorized"}</span>
                <span className="article-row__status">
                  <span className={`social-status-pill article-status-pill article-status-pill--${articleStatusClass(article)}`}>
                    {articleStatusLabel(article)}
                  </span>
                </span>
                <span className="article-row__sites">
                  <span className="social-status-pill article-sites-pill">
                    {article.site_ids.length} {article.site_ids.length === 1 ? "site" : "sites"}
                  </span>
                </span>
                <span className="article-row__updated">
                  <strong>{formatDisplayDate(article.updated_at, false)}</strong>
                  <small>{formatDisplayTime(article.updated_at)}</small>
                </span>
                <button
                  className="article-row__delete dashboard-icon-button"
                  type="button"
                  aria-label={`Delete ${article.title}`}
                  title={`Delete ${article.title}`}
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (confirm(`Delete "${article.title}"? This cannot be undone.`)) {
                      await onDeleteArticle(article);
                    }
                  }}
                >
                  <TrashIcon aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (view === "month") {
    return (
      <section className="panel articles-overview articles-overview--calendar">
        <div className="scheduler-hero scheduler-hero--minimal scheduler-overview__bar">
          <div className="scheduler-hero__content">
            {headerTabs}
          </div>
        </div>
        <div className="scheduler-view-panel scheduler-calendar">
          <div className="panel__title-row scheduler-calendar__header">
            <div className="scheduler-calendar__heading">
              <div className="scheduler-calendar__title-block">
                <h2>{formatMonthYear(calendarDate)}</h2>
              </div>
              <div className="scheduler-calendar__nav">
                <button
                  className="button-secondary dashboard-icon-button"
                  type="button"
                  onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                  aria-label="Previous month"
                  title="Previous month"
                >
                  <ChevronLeftIcon aria-hidden="true" />
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => setCalendarDate(new Date())}
                >
                  Today
                </button>
                <button
                  className="button-secondary dashboard-icon-button"
                  type="button"
                  onClick={() => setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                  aria-label="Next month"
                  title="Next month"
                >
                  <ChevronRightIcon aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="scheduler-calendar__actions">
              {newArticleAction}
            </div>
          </div>
          <div className="scheduler-calendar__grid scheduler-calendar__grid--header">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <div className="scheduler-calendar__weekday" key={label}>{label}</div>
            ))}
          </div>
          <div className="scheduler-calendar__grid">
            {monthItemsByDay.map(({ day, items }) => (
              <div
                key={day.toISOString()}
                className={`scheduler-calendar__day${
                  day.getMonth() !== calendarDate.getMonth() ? " scheduler-calendar__day--muted" : ""
                }${sameDay(day, today) ? " scheduler-calendar__day--today" : ""}`}
                onClick={() => onNewArticle(slotDateTime(day))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onNewArticle(slotDateTime(day));
                }}
                role="button"
                tabIndex={0}
                aria-label={`Create article on ${formatMonthDay(day)}`}
              >
                <div className="scheduler-calendar__day-top">
                  <div className="scheduler-calendar__day-number">{day.getDate()}</div>
                </div>
                <div className="scheduler-calendar__events">
                  {items.slice(0, 4).map((article) => (
                    <button
                      key={article.id}
                      type="button"
                      className={`scheduler-calendar__event article-calendar__event article-calendar__event--${articleStatusClass(article)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectArticle(article);
                      }}
                    >
                      <span className="scheduler-calendar__event-time">
                        {article.published_at ? formatDisplayTime(article.published_at) : "Any time"}
                      </span>
                      <span className="scheduler-calendar__event-body">
                        <span className="scheduler-calendar__event-title">{article.title}</span>
                      </span>
                    </button>
                  ))}
                  {items.length > 4 ? (
                    <span className="scheduler-calendar__more">+{items.length - 4} more</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel articles-overview articles-overview--calendar">
      <div className="scheduler-hero scheduler-hero--minimal scheduler-overview__bar">
        <div className="scheduler-hero__content">
          {headerTabs}
        </div>
      </div>
      <div className="scheduler-view-panel scheduler-week">
        <div className="panel__title-row scheduler-week__header">
          <div className="scheduler-calendar__heading">
            <div className="scheduler-calendar__title-block">
              <h2>Week view</h2>
              <p className="scheduler-week__range">{weekRangeLabel}</p>
            </div>
            <div className="scheduler-calendar__nav">
              <button
                className="button-secondary dashboard-icon-button"
                type="button"
                onClick={() => setCalendarDate((current) => {
                  const next = new Date(current);
                  next.setDate(current.getDate() - 7);
                  return next;
                })}
                aria-label="Previous week"
                title="Previous week"
              >
                <ChevronLeftIcon aria-hidden="true" />
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => setCalendarDate(new Date())}
              >
                Today
              </button>
              <button
                className="button-secondary dashboard-icon-button"
                type="button"
                onClick={() => setCalendarDate((current) => {
                  const next = new Date(current);
                  next.setDate(current.getDate() + 7);
                  return next;
                })}
                aria-label="Next week"
                title="Next week"
              >
                <ChevronRightIcon aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="scheduler-calendar__actions">
            {newArticleAction}
          </div>
        </div>
        <div className="scheduler-week__timetable">
          <div className="scheduler-week__timetable-corner" />
          {weekRangeDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`scheduler-week__day-header${sameDay(day, today) ? " scheduler-week__day-header--today" : ""}`}
            >
              <p className="scheduler-week__day-label">{formatWeekdayShort(day)}</p>
              <strong>{formatMonthDay(day)}</strong>
            </div>
          ))}
          {WEEK_HOUR_SLOTS.map((slot) => (
            <Fragment key={slot.hour}>
              <div className="scheduler-week__time-label">{slot.label}</div>
              {weekItemsByDay.map(({ day, items }) => {
                const slotKey = `${day.toISOString()}-${slot.hour}`;
                const slotItems = items.filter((article) => {
                  if (!article.published_at) return false;
                  return new Date(article.published_at).getHours() === slot.hour;
                });
                return (
                  <div
                    key={slotKey}
                    className={`scheduler-week__cell${sameDay(day, today) ? " scheduler-week__cell--today" : ""}`}
                    onClick={() => onNewArticle(slotDateTime(day, slot.hour))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onNewArticle(slotDateTime(day, slot.hour));
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Create article on ${formatMonthDay(day)} at ${slot.label}`}
                  >
                    {slotItems.map((article) => (
                      <button
                        key={article.id}
                        type="button"
                        className={`scheduler-week__slot-item article-week__slot-item article-week__slot-item--${articleStatusClass(article)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectArticle(article);
                        }}
                      >
                        <span className="scheduler-week__slot-meta">
                          <span className="scheduler-week__slot-time">
                            {article.published_at ? formatDisplayTime(article.published_at) : slot.label}
                          </span>
                        </span>
                        <span className="scheduler-week__slot-title">{article.title}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
