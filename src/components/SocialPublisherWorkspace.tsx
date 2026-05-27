import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  ArrowPathIcon,
  Cog6ToothIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/solid";
import { ModalCloseButton } from "./ModalCloseButton";
import type { IconType } from "react-icons";
import type { SocialAccount, SocialPost } from "../lib/types";
import { formatDisplayDate, formatDisplayDateTime } from "../lib/datetime";
import { getDisplayPostImageUrls } from "../lib/socialPostMedia";

type Tab = "posts" | "replies";
type SetupTab = "overview" | "knowledge" | "accounts";

export type SocialAccountField = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
  required?: boolean;
  defaultValue?: string;
};

export type SocialAccountPayload = Record<string, string>;

export type SocialWorkspaceFeedback = {
  tone: "success" | "warning";
  title: string;
  detail?: string;
};

export type SocialAgentToolbarHandle = {
  openComposer: () => void;
  reload: () => void;
};

type SocialPublisherWorkspaceProps = {
  PlatformIcon: IconType;
  platformLabel: string;
  shortLabel: string;
  queuePlaceholder: string;
  queueHint: string;
  queueLimit: number;
  scheduledSlots?: string[];
  postActionLabel?: string;
  postContentLabel?: string;
  accountsEmptyMessage: string;
  isConnected: boolean;
  loading: boolean;
  posts: SocialPost[];
  accounts: SocialAccount[];
  repliesContent?: React.ReactNode;
  replyCount?: number;
  newPost: string;
  adding: boolean;
  error: string | null;
  feedback?: SocialWorkspaceFeedback | null;
  onReload: () => Promise<void>;
  onQueueChange: (value: string) => void;
  onCreatePost: (scheduledAt: string | null) => Promise<void>;
  onDeletePost: (id: number) => Promise<void>;
  onPublishPost?: (id: number) => Promise<void>;
  onAddAccount?: (values: SocialAccountPayload) => Promise<void>;
  onConnectAccount?: (values: SocialAccountPayload) => Promise<void>;
  onDeleteAccount: (id: number) => Promise<void>;
  accountFields: SocialAccountField[];
  addAccountLabel?: string;
  addAccountRequiredFieldKeys?: string[];
  connectAccountLabel?: string;
  connectAccountRequiredFieldKeys?: string[];
  knowledgeBaseContent?: React.ReactNode;
  accountInputHint?: string;
  showAccountManagement?: boolean;
  hideHeader?: boolean;
};

const AUTO_SCHEDULE_HOURS = [10, 13, 16];
const AUTO_SCHEDULE_MIN_GAP_MS = 90 * 60 * 1000;
const AUTO_SCHEDULE_MAX_ITEMS_PER_DAY = 1;
const AUTO_SCHEDULE_LOOKAHEAD_DAYS = 14;

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function statusTone(status: SocialPost["status"] | SocialAccount["status"]) {
  switch (status) {
    case "posted":
    case "active":
      return "success";
    case "scheduled":
    case "approved":
    case "publishing":
      return "info";
    case "failed":
    case "inactive":
      return "danger";
    default:
      return "neutral";
  }
}

function sameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
  );
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

    const dayItems = scheduled.filter((item) => sameLocalDay(item, day));
    if (dayItems.length >= AUTO_SCHEDULE_MAX_ITEMS_PER_DAY) continue;

    for (const hour of AUTO_SCHEDULE_HOURS) {
      const candidate = new Date(day);
      candidate.setHours(hour, 0, 0, 0);
      if (candidate.getTime() <= minLead.getTime()) continue;

      const tooClose = dayItems.some(
        (item) => Math.abs(item.getTime() - candidate.getTime()) < AUTO_SCHEDULE_MIN_GAP_MS,
      );
      if (tooClose) continue;

      return candidate.toISOString();
    }
  }

  const fallback = new Date(minLead);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(AUTO_SCHEDULE_HOURS[0], 0, 0, 0);
  return fallback.toISOString();
}

function renderPostMedia(imageUrl: string | null | undefined, content: string) {
  const imageUrls = getDisplayPostImageUrls(imageUrl);
  if (imageUrls.length === 0) {
    return (
      <div className="social-post-media social-post-media--placeholder" aria-label="No image attached">
        <PhotoIcon className="social-post-placeholder-icon" aria-hidden="true" />
        <span>No image</span>
      </div>
    );
  }

  return (
    <div className={`social-post-media-grid ${imageUrls.length === 1 ? "social-post-media-grid--single" : ""}`}>
      {imageUrls.map((url, index) => (
        <img
          key={`${url}-${index}`}
          className="social-post-image"
          src={url}
          alt={imageUrls.length === 1 ? `${content || "Social post"} image` : `${content || "Social post"} image ${index + 1}`}
          loading="lazy"
        />
      ))}
    </div>
  );
}

type SocialPostComposerModalProps = {
  platformLabel: string;
  postActionLabel: string;
  postContentLabel: string;
  placeholder: string;
  value: string;
  limit: number;
  scheduledSlots?: string[];
  saving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (scheduledAt: string | null) => Promise<void>;
};

function SocialPostComposerModal({
  platformLabel,
  postActionLabel,
  postContentLabel,
  placeholder,
  value,
  limit,
  scheduledSlots = [],
  saving,
  onChange,
  onClose,
  onSubmit,
}: SocialPostComposerModalProps) {
  const [scheduledAtInput, setScheduledAtInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const minSchedule = toDateTimeLocalValue(new Date());
  const cleanPlatformLabel = platformLabel.replace(/\s+Agent$/i, "");

  async function submitPost(scheduledAt: string | null) {
    if (!value.trim()) {
      setError(`${postContentLabel} content is required.`);
      return;
    }
    setError(null);
    try {
      await onSubmit(scheduledAt);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `Failed to create ${postContentLabel.toLowerCase()}`);
    }
  }

  return (
    <div className="social-connections-modal-backdrop">
      <div className="social-connections-modal panel social-editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel__title-row">
          <div>
            <p className="social-kicker">Post</p>
            <h2>New {cleanPlatformLabel} {postContentLabel}</h2>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>

        {error ? <p className="error">{error}</p> : null}

        <form
          className="social-editor-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await submitPost(scheduledAtInput ? new Date(scheduledAtInput).toISOString() : null);
          }}
        >
          <label>
            {postContentLabel}
            <textarea
              rows={5}
              value={value}
              onChange={(event) => {
                onChange(event.target.value.slice(0, limit));
                if (error) setError(null);
              }}
              placeholder={placeholder}
              required
            />
          </label>

          <div className="grid-two">
            <label>
              Publish date & time
              <input
                type="datetime-local"
                min={minSchedule}
                value={scheduledAtInput}
                onChange={(event) => setScheduledAtInput(event.target.value)}
              />
            </label>
            <label>
              Characters
              <input readOnly value={`${value.length}/${limit}`} />
            </label>
          </div>

          <p className="social-muted">
            Leave date blank to publish now, choose a time manually, or auto-schedule into the next two weeks based on the current planner.
          </p>

          <div className="social-editor-form__actions">
            <button className="button-secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={saving || !value.trim()}
              onClick={async () => {
                const autoscheduledAt = chooseAutoSchedule(scheduledSlots);
                await submitPost(autoscheduledAt);
              }}
            >
              Auto-schedule
            </button>
            <button type="submit" disabled={saving || !value.trim()}>
              {saving ? "Saving..." : scheduledAtInput ? "Schedule" : postActionLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const SocialPublisherWorkspace = forwardRef<SocialAgentToolbarHandle, SocialPublisherWorkspaceProps>(function SocialPublisherWorkspace({
  PlatformIcon,
  platformLabel,
  shortLabel,
  queuePlaceholder,
  queueHint,
  queueLimit,
  scheduledSlots = [],
  postActionLabel = "Post",
  postContentLabel = "Post",
  accountsEmptyMessage,
  isConnected,
  loading,
  posts,
  accounts,
  repliesContent,
  replyCount = 0,
  newPost,
  adding,
  error,
  feedback,
  onReload,
  onQueueChange,
  onCreatePost,
  onDeletePost,
  onPublishPost,
  onAddAccount,
  onConnectAccount,
  onDeleteAccount,
  accountFields,
  addAccountLabel = "Add account",
  addAccountRequiredFieldKeys,
  connectAccountLabel,
  connectAccountRequiredFieldKeys,
  knowledgeBaseContent,
  accountInputHint = "Add another account with the credentials this platform requires.",
  showAccountManagement = false,
  hideHeader = false,
}, ref) {
  const tabStorageKey = useMemo(
    () => `dashboard:social-tab:${platformLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    [platformLabel],
  );
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "posts";
    const stored = window.localStorage.getItem(tabStorageKey);
    return stored === "posts" || stored === "replies" ? stored : "posts";
  });
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<SetupTab>("overview");
  const [accountInput, setAccountInput] = useState<SocialAccountPayload>({});
  const [addingAccount, setAddingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(tabStorageKey, tab);
  }, [tab, tabStorageKey]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "posts", label: `Posts (${posts.length})` },
    ...(repliesContent ? [{ id: "replies" as const, label: `Replies (${replyCount})` }] : []),
  ];
  const setupTabs: Array<{ id: SetupTab; label: string }> = [
    { id: "overview", label: "Overview" },
    ...(knowledgeBaseContent ? [{ id: "knowledge" as const, label: "Knowledge Base" }] : []),
    { id: "accounts", label: "Accounts" },
  ];
  const valueForField = (field: SocialAccountField) => accountInput[field.key] ?? field.defaultValue ?? "";
  const fieldsByKey = new Map(accountFields.map((field) => [field.key, field]));
  const hasValuesForKeys = (keys: string[]) => keys.every((key) => {
    const field = fieldsByKey.get(key);
    return field ? valueForField(field).trim() : accountInput[key]?.trim();
  });
  const requiredAccountFieldKeys = addAccountRequiredFieldKeys ?? accountFields.filter((field) => field.required !== false).map((field) => field.key);
  const requiredConnectFieldKeys = connectAccountRequiredFieldKeys ?? requiredAccountFieldKeys;
  const isAccountFormComplete = hasValuesForKeys(requiredAccountFieldKeys);
  const isConnectFormComplete = hasValuesForKeys(requiredConnectFieldKeys);
  const openComposer = () => {
    setTab("posts");
    setIsPostModalOpen(true);
  };

  useImperativeHandle(ref, () => ({
    openComposer,
    reload: () => {
      void onReload();
    },
  }), [onReload]);

  return (
    <div className="social-workspace stack">
      {error ? <p className="error panel">{error}</p> : null}
      {feedback ? (
        <div className={`panel social-status-banner social-status-banner--${feedback.tone === "success" ? "connected" : "warning"}`}>
          <span className="social-status-banner__dot" aria-hidden="true" />
          <div>
            <strong>{feedback.title}</strong>
            {feedback.detail ? <p>{feedback.detail}</p> : null}
          </div>
        </div>
      ) : null}

      {!hideHeader ? (
        <section className="panel social-hero">
          <div className="social-hero__content">
            <div className="social-title-row">
              <h2>
                <PlatformIcon className="social-heading-icon" aria-hidden="true" />
                {platformLabel}
              </h2>
              <span className={`social-status-pill social-status-pill--${isConnected ? "success" : "warning"}`}>
                {isConnected ? "Connected" : "Needs setup"}
              </span>
            </div>
          </div>
          <div className="social-hero__actions">
            <button type="button" onClick={openComposer}>
              <PlusIcon aria-hidden="true" className="h-4 w-4" />
              Post
            </button>
            {showAccountManagement ? (
              <button
                aria-label="Manage accounts and setup"
                className={`button-secondary social-icon-button ${isSetupOpen ? "social-utility-button--active" : ""}`}
                title="Manage"
                type="button"
                onClick={() => {
                  setSetupTab("accounts");
                  setIsSetupOpen(true);
                }}
              >
                <Cog6ToothIcon aria-hidden="true" className="h-4 w-4" />
                <span className="social-toolbar-badge">{accounts.length}</span>
              </button>
            ) : null}
            <button
              aria-label="Refresh"
              className="button-secondary social-icon-button"
              title="Refresh"
              type="button"
              onClick={() => void onReload()}
            >
              <ArrowPathIcon aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel social-panel-shell">
        <div className="ui-tabs__list social-panel-tabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ui-tab social-panel-tab ${tab === item.id ? "ui-tab--active social-panel-tab--active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "posts" ? (
          <div className="social-panel-section stack">
            <div className="panel__title-row">
              <h2>{shortLabel} Posts</h2>
            </div>

            {loading ? (
              <p className="social-empty">Loading...</p>
            ) : posts.length === 0 ? (
              <div className="social-empty-card">
                <p className="social-empty-card__title">No posts yet.</p>
                <p className="social-empty-card__copy">{queueHint}</p>
              </div>
            ) : (
              <div className="social-post-card-grid">
                {posts.map((post) => (
                  <article className="social-post-card" key={post.id}>
                    <div className="social-post-card__media">
                      {renderPostMedia(post.image_url, post.content)}
                    </div>
                    <div className="social-post-card__body">
                      <div className="social-post-card__meta">
                        <span className={`social-status-pill social-status-pill--${statusTone(post.status)}`}>{post.status}</span>
                        <span className="social-muted">
                          {post.scheduled_at ? formatDisplayDateTime(post.scheduled_at) : "Unscheduled"}
                        </span>
                      </div>
                      <p className="social-post-card__content">{post.content || "No text content"}</p>
                      {post.status === "failed" && post.last_error ? (
                        <p className="social-post-card__error">{post.last_error}</p>
                      ) : null}
                    </div>
                    <div className="social-post-card__actions">
                      {onPublishPost && post.status !== "posted" ? (
                        <button className="social-inline-button" type="button" onClick={() => void onPublishPost(post.id)}>
                          Publish
                        </button>
                      ) : null}
                      <button
                        className="social-inline-button social-inline-button--danger dashboard-icon-button"
                        type="button"
                        onClick={() => void onDeletePost(post.id)}
                        aria-label="Delete post"
                        title="Delete"
                      >
                        <TrashIcon aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "replies" && repliesContent ? (
          <div className="social-panel-section stack">
            <div className="panel__title-row">
              <h2>{shortLabel} Replies</h2>
            </div>
            {repliesContent}
          </div>
        ) : null}
      </section>

      {showAccountManagement && isSetupOpen ? (
        <div className="social-connections-modal-backdrop">
          <div className="social-connections-modal panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel__title-row">
              <div>
                <p className="social-kicker">Setup</p>
                <h2>{platformLabel}</h2>
              </div>
              <ModalCloseButton onClick={() => setIsSetupOpen(false)} label={`Close ${platformLabel} setup`} />
            </div>

            <div className="ui-tabs__list social-panel-tabs social-panel-tabs--modal">
              {setupTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`ui-tab social-panel-tab ${setupTab === item.id ? "ui-tab--active social-panel-tab--active" : ""}`}
                  onClick={() => setSetupTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {setupTab === "overview" ? (
              <section className="social-panel-section">
                <div className="social-connections-summary">
                  <article className="social-connections-summary__card">
                    <span>Queue health</span>
                    <strong>{posts.length}</strong>
                    <small>Active posts in this workspace.</small>
                  </article>
                  <article className="social-connections-summary__card">
                    <span>Readiness</span>
                    <strong>{isConnected ? "Ready" : "Setup"}</strong>
                    <small>{isConnected ? "At least one account is configured." : "Add an account with the required fields."}</small>
                  </article>
                </div>
                <div className="social-note">
                  <strong>Workspace summary</strong>
                  <p>
                    Use this modal to keep platform knowledge and account setup together while the main page stays focused on content.
                  </p>
                </div>
              </section>
            ) : null}

            {setupTab === "knowledge" ? (
              <section className="social-panel-section">
                <div className="panel__title-row">
                  <h2>{shortLabel} Knowledge Base</h2>
                </div>
                <div className="social-knowledge-pane">
                  {knowledgeBaseContent}
                </div>
              </section>
            ) : null}

            {setupTab === "accounts" ? (
              <section className="social-panel-section">
                <div className="panel__title-row">
                  <h2>{shortLabel} Connected Accounts</h2>
                </div>
                {onAddAccount || onConnectAccount ? (
                  <div className="social-account-adder">
                    <div className="social-account-adder__intro">
                      <strong>Add another account</strong>
                      <p>{accountInputHint}</p>
                    </div>
                    <div className="social-account-adder__fields">
                      {accountFields.map((field) => (
                        <label className="social-account-adder__field" key={field.key}>
                          <span>{field.label}{field.required === false ? "" : " *"}</span>
                          <input
                            type={field.type ?? "text"}
                            placeholder={field.placeholder}
                            value={valueForField(field)}
                            onChange={(event) => {
                              setAccountInput((current) => ({ ...current, [field.key]: event.target.value }));
                              if (accountError) setAccountError(null);
                            }}
                            autoComplete="off"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="social-account-adder__actions">
                      {onConnectAccount && connectAccountLabel ? (
                        <button
                          type="button"
                          disabled={!isConnectFormComplete || addingAccount}
                          onClick={async () => {
                            setAddingAccount(true);
                            setAccountError(null);
                            try {
                              const values = Object.fromEntries(
                                accountFields.map((field) => {
                                  const value = valueForField(field);
                                  return [
                                    field.key,
                                    field.key === "username" ? value.trim().replace(/^@+/, "") : value.trim(),
                                  ];
                                }),
                              );
                              await onConnectAccount(values);
                              setAccountInput({});
                            } catch (error) {
                              setAccountError(error instanceof Error ? error.message : "Failed to connect account");
                            } finally {
                              setAddingAccount(false);
                            }
                          }}
                        >
                          {addingAccount ? "Connecting..." : connectAccountLabel}
                        </button>
                      ) : null}
                      {onAddAccount ? (
                        <button
                          className={onConnectAccount ? "button-secondary" : undefined}
                          type="button"
                          disabled={!isAccountFormComplete || addingAccount}
                          onClick={async () => {
                            setAddingAccount(true);
                            setAccountError(null);
                            try {
                              const values = Object.fromEntries(
                                accountFields.map((field) => {
                                  const value = valueForField(field);
                                  return [
                                    field.key,
                                    field.key === "username" ? value.trim().replace(/^@+/, "") : value.trim(),
                                  ];
                                }),
                              );
                              await onAddAccount(values);
                              setAccountInput({});
                            } catch (error) {
                              setAccountError(error instanceof Error ? error.message : "Failed to add account");
                            } finally {
                              setAddingAccount(false);
                            }
                          }}
                        >
                          {addingAccount ? "Adding..." : addAccountLabel}
                        </button>
                      ) : null}
                    </div>
                    {accountError ? <p className="social-account-adder__error">{accountError}</p> : null}
                  </div>
                ) : null}
                {accounts.length === 0 ? (
                  <div className="social-empty-card">
                    <p className="social-empty-card__title">No connected accounts.</p>
                    <p className="social-empty-card__copy">{accountsEmptyMessage}</p>
                  </div>
                ) : (
                  <div className="table social-accounts-table">
                    <div className="table__row table__row--header">
                      <span>Username</span>
                      <span>Status</span>
                      <span>Added</span>
                      <span>Actions</span>
                    </div>
                    {accounts.map((account) => (
                      <div className="table__row" key={account.id}>
                        <span>@{account.username}</span>
                        <span>
                          <span className={`social-status-pill social-status-pill--${statusTone(account.status)}`}>{account.status}</span>
                        </span>
                        <span className="social-muted">{formatDisplayDate(account.created_at)}</span>
                        <span className="social-table-actions">
                          <button
                            className="social-inline-button social-inline-button--danger dashboard-icon-button"
                            type="button"
                            onClick={() => void onDeleteAccount(account.id)}
                            aria-label={`Remove @${account.username}`}
                            title="Remove"
                          >
                            <TrashIcon aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

          </div>
        </div>
      ) : null}

      {isPostModalOpen ? (
        <SocialPostComposerModal
          platformLabel={platformLabel}
          postActionLabel={postActionLabel}
          postContentLabel={postContentLabel}
          placeholder={queuePlaceholder}
          value={newPost}
          limit={queueLimit}
          scheduledSlots={scheduledSlots}
          saving={adding}
          onChange={onQueueChange}
          onClose={() => setIsPostModalOpen(false)}
          onSubmit={onCreatePost}
        />
      ) : null}
    </div>
  );
});
