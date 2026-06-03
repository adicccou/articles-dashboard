import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, TrashIcon } from "@heroicons/react/24/solid";
import type { ArticleRecord, Site } from "../lib/types";
import { formatDisplayDate, formatDisplayTime, formatMonthDay, formatMonthYear, formatWeekRange, formatWeekdayShort } from "../lib/datetime";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import { SectionTabs } from "./SectionTabs";
import "../styles/planner-page.css";

type ArticlesOverviewProps = {
  articles: ArticleRecord[];
  sites: Site[];
  onNewArticle: (scheduledAt?: Date) => void;
  onSelectArticle: (article: ArticleRecord) => void;
  onDeleteArticle: (article: ArticleRecord) => Promise<void>;
};

type ArticleView = "month" | "week" | "list";
type ArticleStatusFilter = "all" | "draft" | "scheduled" | "published";

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

function articlePublishDisplayValue(article: ArticleRecord): string | null {
  if (article.status === "draft") return null;
  return article.published_at ?? null;
}

function matchesSiteFilter(article: ArticleRecord, selectedSiteFilter: string): boolean {
  if (selectedSiteFilter === "all") return true;
  const siteId = Number(selectedSiteFilter);
  if (Number.isNaN(siteId)) return true;
  return article.site_ids.includes(siteId);
}

function matchesStatusFilter(article: ArticleRecord, selectedStatusFilter: ArticleStatusFilter): boolean {
  return selectedStatusFilter === "all" ? true : articleStatusClass(article) === selectedStatusFilter;
}

export function ArticlesOverview({
  articles,
  sites,
  onNewArticle,
  onSelectArticle,
  onDeleteArticle,
}: ArticlesOverviewProps) {
  const [view, setView] = useState<ArticleView>(() => readStoredArticleView());
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedSiteFilter, setSelectedSiteFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<ArticleStatusFilter>("all");

  useEffect(() => {
    storeArticleView(view);
  }, [view]);

  const today = useMemo(() => new Date(), []);
  const activeSites = useMemo(
    () => sites.filter((site) => site.status === "active"),
    [sites],
  );
  const siteMap = useMemo(
    () => new Map(sites.map((site) => [site.id, site])),
    [sites],
  );
  useEffect(() => {
    if (selectedSiteFilter === "all") return;
    const hasSelectedSite = activeSites.some((site) => String(site.id) === selectedSiteFilter);
    if (!hasSelectedSite) {
      setSelectedSiteFilter("all");
    }
  }, [activeSites, selectedSiteFilter]);
  const listFilterItems = useMemo(
    () => [
      { id: "all", label: "All websites", count: articles.length },
      ...activeSites.map((site) => ({
        id: String(site.id),
        label: site.name,
        count: articles.filter((article) => article.site_ids.includes(site.id)).length,
      })),
    ],
    [activeSites, articles],
  );
  const statusFilterItems = useMemo(
    () => [
      { id: "all" as const, label: "All statuses", count: articles.length },
      { id: "draft" as const, label: "Draft", count: articles.filter((article) => articleStatusClass(article) === "draft").length },
      { id: "scheduled" as const, label: "Scheduled", count: articles.filter((article) => articleStatusClass(article) === "scheduled").length },
      { id: "published" as const, label: "Published", count: articles.filter((article) => articleStatusClass(article) === "published").length },
    ],
    [articles],
  );
  const filteredArticles = useMemo(() => {
    return articles.filter(
      (article) => matchesSiteFilter(article, selectedSiteFilter) && matchesStatusFilter(article, selectedStatusFilter),
    );
  }, [articles, selectedSiteFilter, selectedStatusFilter]);
  const siteFilterCounts = useMemo(
    () => new Map(
      listFilterItems.map((item) => [
        item.id,
        articles.filter((article) => matchesSiteFilter(article, item.id) && matchesStatusFilter(article, selectedStatusFilter)).length,
      ]),
    ),
    [articles, listFilterItems, selectedStatusFilter],
  );
  const statusFilterCounts = useMemo(
    () => new Map(
      statusFilterItems.map((item) => [
        item.id,
        articles.filter((article) => matchesSiteFilter(article, selectedSiteFilter) && matchesStatusFilter(article, item.id)).length,
      ]),
    ),
    [articles, selectedSiteFilter, statusFilterItems],
  );
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
          {activeSites.length > 0 ? (
            <div className="articles-overview__filters">
              <SectionTabs
                activeId={selectedSiteFilter}
                ariaLabel="Filter articles by website"
                className="articles-filter-tabs"
                tabClassName="articles-filter-tab"
                activeTabClassName="articles-filter-tab--active"
                badgeClassName="articles-filter-tab__count"
                onChange={setSelectedSiteFilter}
                items={listFilterItems.map((item) => ({
                  id: item.id,
                  label: item.label,
                  badge: siteFilterCounts.get(item.id) ?? item.count,
                }))}
              />
            </div>
          ) : null}
          <div className="articles-overview__filters articles-overview__filters--subtle">
            <SectionTabs
              activeId={selectedStatusFilter}
              ariaLabel="Filter articles by status"
              className="articles-filter-tabs"
              tabClassName="articles-filter-tab articles-filter-tab--subtle"
              activeTabClassName="articles-filter-tab--active"
              badgeClassName="articles-filter-tab__count"
              onChange={(value) => setSelectedStatusFilter(value as ArticleStatusFilter)}
              items={statusFilterItems.map((item) => ({
                id: item.id,
                label: item.label,
                badge: statusFilterCounts.get(item.id) ?? item.count,
              }))}
            />
          </div>
          <div className="table articles-table">
            <div className="table__row table__row--header">
              <span>Title</span>
              <span>Category</span>
              <span>Status</span>
              <span>Sites</span>
              <span>Publish date</span>
            </div>
            {filteredArticles.map((article) => (
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
                  <span className="social-status-pill article-sites-pill" title={article.site_ids.map((siteId) => siteMap.get(siteId)?.name).filter(Boolean).join(", ")}>
                    {article.site_ids.length === 0
                      ? "No site"
                      : article.site_ids.length === 1
                        ? (siteMap.get(article.site_ids[0])?.name ?? "1 site")
                        : `${article.site_ids.length} sites`}
                  </span>
                </span>
                {articlePublishDisplayValue(article) ? (
                  <span className="article-row__updated">
                    <strong>{formatDisplayDate(articlePublishDisplayValue(article), false)}</strong>
                    <small>{formatDisplayTime(articlePublishDisplayValue(article))}</small>
                  </span>
                ) : (
                  <span className="article-row__updated" aria-hidden="true" />
                )}
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
            {filteredArticles.length === 0 ? (
              <div className="articles-table__empty">
                <strong>No articles here yet.</strong>
                <p>Try another website filter or create a new article.</p>
              </div>
            ) : null}
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
