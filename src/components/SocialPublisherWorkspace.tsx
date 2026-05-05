import { useRef, useState } from "react";
import type { SocialAccount, SocialPost } from "../lib/types";

type Tab = "posts" | "campaigns";
type SetupTab = "overview" | "knowledge" | "accounts" | "credentials";

type CredentialField = {
  key: string;
  label: string;
  saved: boolean;
  onSave: (value: string) => Promise<unknown>;
};

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
  credentialsIntro: React.ReactNode;
  credentialsNote: string;
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
  onAddAccount?: (value: string) => Promise<void>;
  onDeleteAccount: (id: number) => Promise<void>;
  credentialFields: CredentialField[];
  knowledgeBaseContent?: React.ReactNode;
  accountInputLabel?: string;
  accountInputPlaceholder?: string;
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

function CredentialRow({ field }: { field: CredentialField }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="social-credential-row">
      <div className="social-credential-row__label">
        <strong>{field.label}</strong>
        <span>{field.saved ? "Saved and hidden" : "Not saved yet"}</span>
      </div>
      <input
        type="password"
        placeholder={field.saved ? "Replace saved value only if needed" : "Enter value"}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="button"
        disabled={!value.trim() || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await field.onSave(value.trim());
            setValue("");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving..." : "Save"}
      </button>
      <span className={`social-credential-row__check ${field.saved ? "is-saved" : ""}`}>
        {field.saved ? "Saved" : "Pending"}
      </span>
    </div>
  );
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
  credentialsIntro,
  credentialsNote,
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
  credentialFields,
  knowledgeBaseContent,
  accountInputLabel = "Account username",
  accountInputPlaceholder = "@youraccount",
  accountInputHint = "Add another account so this workspace can support multiple publishing profiles later.",
  onCreateCampaign,
  extraActions,
}: SocialPublisherWorkspaceProps) {
  const [tab, setTab] = useState<Tab>("posts");
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<SetupTab>("overview");
  const [scheduledAtInput, setScheduledAtInput] = useState("");
  const [accountInput, setAccountInput] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "posts", label: `Posts (${posts.length})` },
    { id: "campaigns", label: `Campaigns (${campaignCount})` },
  ];
  const savedCredentialCount = credentialFields.filter((field) => field.saved).length;
  const setupTabs: Array<{ id: SetupTab; label: string }> = [
    { id: "overview", label: "Overview" },
    ...(knowledgeBaseContent ? [{ id: "knowledge" as const, label: "Knowledge Base" }] : []),
    { id: "accounts", label: "Accounts" },
    { id: "credentials", label: "Credentials" },
  ];

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
            <span className="social-mini-stat"><strong>{savedCredentialCount}/{credentialFields.length}</strong> credentials</span>
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
              setSetupTab(knowledgeBaseContent ? "knowledge" : "accounts");
              setIsSetupOpen(true);
            }}
          >
            Manage
            <span className="social-toolbar-badge">{accounts.length + savedCredentialCount}</span>
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
          <span>Credentials</span>
          <strong>
            {credentialFields.filter((field) => field.saved).length}/{credentialFields.length}
          </strong>
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
                <span>Credentials</span>
                <strong>{savedCredentialCount}/{credentialFields.length}</strong>
                <small>{savedCredentialCount ? "Saved securely in dashboard settings" : "Still needs setup"}</small>
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
                    <small>{isConnected ? "Publishing path is configured." : "Finish credentials and accounts to publish safely."}</small>
                  </article>
                </div>
                <div className="social-note">
                  <strong>Workspace summary</strong>
                  <p>
                    Use this modal to keep platform knowledge, account access, and credentials together in one place while the main page stays focused on content.
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
                    <div className="social-account-adder__controls">
                      <label className="social-account-adder__field">
                        <span>{accountInputLabel}</span>
                        <input
                          type="text"
                          placeholder={accountInputPlaceholder}
                          value={accountInput}
                          onChange={(event) => {
                            setAccountInput(event.target.value);
                            if (accountError) setAccountError(null);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!accountInput.trim() || addingAccount}
                        onClick={async () => {
                          setAddingAccount(true);
                          setAccountError(null);
                          try {
                            await onAddAccount(accountInput.trim().replace(/^@+/, ""));
                            setAccountInput("");
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

            {setupTab === "credentials" ? (
              <section className="social-panel-section">
                <div className="panel__title-row">
                  <h2>{shortLabel} Credentials</h2>
                </div>
                <div className="social-credentials-intro">{credentialsIntro}</div>
                <div className="social-credential-list">
                  {credentialFields.map((field) => (
                    <CredentialRow key={field.key} field={field} />
                  ))}
                </div>
                <div className="social-note">
                  <strong>Automation note</strong>
                  <p>{credentialsNote}</p>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
