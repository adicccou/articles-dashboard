import { useRef, useState } from "react";
import type { SocialAccount, SocialPost } from "../lib/types";

type Tab = "posts" | "campaigns";
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

type SocialPublisherWorkspaceProps = {
  icon: string;
  platformLabel: string;
  shortLabel: string;
  campaignCount: number;
  connectedMessage: string;
  disconnectedMessage: string;
  queuePlaceholder: string;
  queueHint: string;
  queueLimit: number;
  accountsEmptyMessage: string;
  isConnected: boolean;
  loading: boolean;
  posts: SocialPost[];
  accounts: SocialAccount[];
  campaignContent: React.ReactNode;
  newPost: string;
  adding: boolean;
  error: string | null;
  onReload: () => Promise<void>;
  onQueueChange: (value: string) => void;
  onCreatePost: (scheduledAt: string | null) => Promise<void>;
  onDeletePost: (id: number) => Promise<void>;
  onAddAccount?: (values: SocialAccountPayload) => Promise<void>;
  onDeleteAccount: (id: number) => Promise<void>;
  accountFields: SocialAccountField[];
  knowledgeBaseContent?: React.ReactNode;
  accountInputHint?: string;
  onCreateCampaign?: () => void;
  extraActions?: React.ReactNode;
};

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
      return "info";
    case "failed":
    case "inactive":
      return "danger";
    default:
      return "neutral";
  }
}

export function SocialPublisherWorkspace({
  icon,
  platformLabel,
  shortLabel,
  campaignCount,
  connectedMessage,
  disconnectedMessage,
  queuePlaceholder,
  queueHint,
  queueLimit,
  accountsEmptyMessage,
  isConnected,
  loading,
  posts,
  accounts,
  campaignContent,
  newPost,
  adding,
  error,
  onReload,
  onQueueChange,
  onCreatePost,
  onDeletePost,
  onAddAccount,
  onDeleteAccount,
  accountFields,
  knowledgeBaseContent,
  accountInputHint = "Add another account with the credentials this platform requires.",
  onCreateCampaign,
  extraActions,
}: SocialPublisherWorkspaceProps) {
  const [tab, setTab] = useState<Tab>("posts");
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<SetupTab>("overview");
  const [scheduledAtInput, setScheduledAtInput] = useState("");
  const [accountInput, setAccountInput] = useState<SocialAccountPayload>({});
  const [addingAccount, setAddingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "posts", label: `Posts (${posts.length})` },
    { id: "campaigns", label: `Campaigns (${campaignCount})` },
  ];
  const setupTabs: Array<{ id: SetupTab; label: string }> = [
    { id: "overview", label: "Overview" },
    ...(knowledgeBaseContent ? [{ id: "knowledge" as const, label: "Knowledge Base" }] : []),
    { id: "accounts", label: "Accounts" },
  ];
  const requiredAccountFields = accountFields.filter((field) => field.required !== false);
  const valueForField = (field: SocialAccountField) => accountInput[field.key] ?? field.defaultValue ?? "";
  const isAccountFormComplete = requiredAccountFields.every((field) => valueForField(field).trim());

  const minSchedule = toDateTimeLocalValue(new Date());

  return (
    <div className="social-workspace stack">
      {error ? <p className="error panel">{error}</p> : null}

      <section className="panel social-hero">
        <div className="social-hero__content">
          <p className="social-kicker">Social Agent</p>
          <div className="social-title-row">
            <h2>{icon} {platformLabel}</h2>
            <span className={`social-status-pill social-status-pill--${isConnected ? "success" : "warning"}`}>
              {isConnected ? "Connected" : "Needs setup"}
            </span>
          </div>
          <p className="social-subtitle">
            A simpler publishing workspace for posts, campaigns, connections, and operating notes.
          </p>
          <p className="social-hero__status">
            {isConnected ? connectedMessage : disconnectedMessage}
          </p>
          <div className="social-hero__metrics">
            <span className="social-mini-stat"><strong>{posts.length}</strong> posts</span>
            <span className="social-mini-stat"><strong>{campaignCount}</strong> campaigns</span>
            <span className="social-mini-stat"><strong>{accounts.length}</strong> accounts</span>
            <span className="social-mini-stat"><strong>{accountFields.length}</strong> fields</span>
          </div>
          {extraActions ? <div className="social-hero__helper">{extraActions}</div> : null}
        </div>
        <div className="social-hero__actions">
          <button
            type="button"
            onClick={() => {
              setTab("posts");
              requestAnimationFrame(() => {
                composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                composerRef.current?.focus();
              });
            }}
          >
            + Post
          </button>
          {onCreateCampaign ? (
            <button className="button-secondary" type="button" onClick={onCreateCampaign}>
              + Campaign
            </button>
          ) : null}
          <button
            className={`button-secondary ${isSetupOpen ? "social-utility-button--active" : ""}`}
            type="button"
            onClick={() => {
              setSetupTab("accounts");
              setIsSetupOpen(true);
            }}
          >
            Manage
            <span className="social-toolbar-badge">{accounts.length}</span>
          </button>
          <button className="button-secondary" type="button" onClick={() => void onReload()}>
            Refresh
          </button>
        </div>
      </section>

      <section className="social-meta-grid">
        <article className="social-meta-card">
          <span>Posts</span>
          <strong>{posts.length}</strong>
        </article>
        <article className="social-meta-card">
          <span>Campaigns</span>
          <strong>{campaignCount}</strong>
        </article>
        <article className="social-meta-card">
          <span>Accounts</span>
          <strong>{accounts.length}</strong>
        </article>
        <article className="social-meta-card">
          <span>Account Fields</span>
          <strong>{accountFields.length}</strong>
        </article>
      </section>

      <section className="panel social-panel-shell">
        <div className="social-panel-tabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`social-panel-tab ${tab === item.id ? "social-panel-tab--active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "posts" ? (
          <div className="social-panel-section stack">
            <div className="panel__title-row">
              <h2>{shortLabel} Post Queue</h2>
            </div>
            <div className="social-composer">
              <textarea
                ref={composerRef}
                placeholder={queuePlaceholder}
                value={newPost}
                onChange={(event) => onQueueChange(event.target.value.slice(0, queueLimit))}
                rows={4}
              />
              <div className="social-composer__schedule">
                <label className="social-composer__schedule-field">
                  <span>Publish date & time</span>
                  <input
                    type="datetime-local"
                    min={minSchedule}
                    value={scheduledAtInput}
                    onChange={(event) => setScheduledAtInput(event.target.value)}
                  />
                </label>
                <div className="social-composer__schedule-actions">
                  <span className="social-muted">Optional. Leave blank to add it as an unscheduled draft.</span>
                  {scheduledAtInput ? (
                    <button
                      className="social-inline-button"
                      type="button"
                      onClick={() => setScheduledAtInput("")}
                    >
                      Clear time
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="social-composer__footer">
                <span className={`social-counter ${newPost.length > queueLimit - 20 ? "is-warning" : ""}`}>
                  {newPost.length}/{queueLimit}
                </span>
                <button
                  type="button"
                  disabled={!newPost.trim() || adding}
                  onClick={async () => {
                    const scheduledAt = scheduledAtInput ? new Date(scheduledAtInput).toISOString() : null;
                    await onCreatePost(scheduledAt);
                    setScheduledAtInput("");
                  }}
                >
                  {adding ? "Saving..." : scheduledAtInput ? "Schedule Post" : "Add to Queue"}
                </button>
              </div>
            </div>

            {loading ? (
              <p className="social-empty">Loading...</p>
            ) : posts.length === 0 ? (
              <div className="social-empty-card">
                <p className="social-empty-card__title">No queued posts yet.</p>
                <p className="social-empty-card__copy">{queueHint}</p>
              </div>
            ) : (
              <div className="table">
                <div className="table__row table__row--header">
                  <span>Content</span>
                  <span>Status</span>
                  <span>Scheduled</span>
                  <span>Actions</span>
                </div>
                {posts.map((post) => (
                  <div className="table__row" key={post.id}>
                    <span className="social-content-preview">{post.content}</span>
                    <span>
                      <span className={`social-status-pill social-status-pill--${statusTone(post.status)}`}>{post.status}</span>
                    </span>
                    <span className="social-muted">
                      {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : "—"}
                    </span>
                    <span className="social-table-actions">
                      <button className="social-inline-button social-inline-button--danger" type="button" onClick={() => void onDeletePost(post.id)}>
                        Delete
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "campaigns" ? (
          <div className="social-panel-section stack">
            <div className="panel__title-row">
              <h2>{shortLabel} Campaigns</h2>
            </div>
            {campaignContent}
          </div>
        ) : null}
      </section>

      {isSetupOpen ? (
        <div className="social-connections-modal-backdrop" onClick={() => setIsSetupOpen(false)}>
          <div className="social-connections-modal panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel__title-row">
              <div>
                <p className="social-kicker">Setup</p>
                <h2>{platformLabel}</h2>
              </div>
              <button className="button-secondary" type="button" onClick={() => setIsSetupOpen(false)}>
                Close
              </button>
            </div>

            <div className="social-connections-summary">
              <article className="social-connections-summary__card">
                <span>Accounts</span>
                <strong>{accounts.length}</strong>
                <small>{accounts.length ? "Connected profiles ready" : "No connected profiles yet"}</small>
              </article>
              <article className="social-connections-summary__card">
                <span>Account fields</span>
                <strong>{accountFields.length}</strong>
                <small>Filled when you add each platform account.</small>
              </article>
            </div>

            <div className="social-panel-tabs social-panel-tabs--modal">
              {setupTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`social-panel-tab ${setupTab === item.id ? "social-panel-tab--active" : ""}`}
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
                    <strong>{posts.length + campaignCount}</strong>
                    <small>Active items across posts and campaigns.</small>
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
                {onAddAccount ? (
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
                      <button
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
                        {addingAccount ? "Adding..." : "Add account"}
                      </button>
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
                  <div className="table">
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
                        <span className="social-muted">{new Date(account.created_at).toLocaleDateString()}</span>
                        <span className="social-table-actions">
                          <button className="social-inline-button social-inline-button--danger" type="button" onClick={() => void onDeleteAccount(account.id)}>
                            Remove
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
    </div>
  );
}
