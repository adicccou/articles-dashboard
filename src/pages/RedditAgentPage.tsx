import { useEffect, useState } from "react";
import type { RedditCampaign, RedditAccount, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";
import { SocialPlannerItemModal } from "../components/SocialPlannerItemModal";
import { SocialCampaignModal } from "../components/SocialCampaignModal";
import { asArray } from "../lib/collections";
import { getPostImageUrls } from "../lib/socialPostMedia";

type ContentMode = "posts" | "campaigns";
type SetupTab = "overview" | "knowledge" | "accounts";

// entity_id=0 is the global Reddit agent knowledge base (not tied to a specific campaign)
const REDDIT_GLOBAL_KB_ID = 0;

export function RedditAgentPage() {
  const [campaigns, setCampaigns] = useState<RedditCampaign[]>([]);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [mode, setMode] = useState<ContentMode>("campaigns");
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<SetupTab>("overview");
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [accountName, setAccountName] = useState("");
  const [connectingAccount, setConnectingAccount] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [campaignsData, plannerData, accountsData] = await Promise.all([
        api.listCampaigns(),
        api.listPlannerItems(),
        api.listRedditAccounts(),
      ]);
      setCampaigns(asArray<RedditCampaign>(campaignsData));
      setPlannerItems(asArray<PlannerItem>(plannerData));
      setAccounts(asArray<RedditAccount>(accountsData));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Reddit agent data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const redditPosts = plannerItems.filter(
    (item) => item.item_type === "post" && item.platform.trim().toLowerCase() === "reddit",
  );
  const redditReplyCount = 0;
  const editingCampaign = editingId ? campaigns.find((campaign) => campaign.id === editingId) : undefined;
  const confirmDeleteCampaign = (name: string) =>
    window.confirm(`Delete the Reddit campaign "${name}"? This cannot be undone.`);

  function renderPlannerPostMedia(item: PlannerItem) {
    const imageUrls = getPostImageUrls(item.image_url);
    if (imageUrls.length === 0) {
      return (
        <div className="social-post-media social-post-media--placeholder" aria-label="No image attached">
          <span className="social-post-placeholder-icon" aria-hidden="true">🖼</span>
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
            alt={imageUrls.length === 1 ? `${item.title || "Reddit post"} image` : `${item.title || "Reddit post"} image ${index + 1}`}
            loading="lazy"
          />
        ))}
      </div>
    );
  }

  async function connectRedditAccount() {
    if (!accountName.trim()) {
      setAccountError("Please enter an account name.");
      return;
    }

    try {
      setConnectingAccount(true);
      setAccountError(null);
      const response = await fetch("/api/reddit/auth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_name: accountName.trim() }),
      });

      if (!response.ok) {
        throw new Error(await response.text() || "Failed to start Reddit OAuth flow");
      }

      const data = (await response.json()) as { auth_url: string };
      window.location.href = data.auth_url;
    } catch (connectError) {
      setAccountError(connectError instanceof Error ? connectError.message : "Failed to connect Reddit account");
      setConnectingAccount(false);
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <div className="social-workspace stack">
      {error && <p className="error panel">{error}</p>}
      <section className="panel social-hero">
        <div className="social-hero__content">
          <div className="social-title-row">
            <h2>🟠 Reddit Agent</h2>
            <span className={`social-status-pill social-status-pill--${campaigns.length ? "success" : "neutral"}`}>
              {accounts.length ? "Connected" : "Needs setup"}
            </span>
          </div>
        </div>
        <div className="social-hero__actions">
          <button type="button" onClick={() => setIsPostModalOpen(true)}>
            + Post
          </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setEditingId(null);
              setIsCampaignModalOpen(true);
            }}
          >
            + Campaign
          </button>
          <button
            type="button"
            aria-label="Manage accounts and setup"
            className={`button-secondary social-icon-button ${isSetupOpen ? "social-utility-button--active" : ""}`}
            title="Manage"
            onClick={() => {
              setSetupTab("accounts");
              setIsSetupOpen(true);
            }}
          >
            ⚙
            <span className="social-toolbar-badge">{accounts.length}</span>
          </button>
          <button
            type="button"
            aria-label="Refresh"
            className="button-secondary social-icon-button"
            title="Refresh"
            onClick={() => void load()}
          >
            ↻
          </button>
        </div>
      </section>

      <section className="panel social-panel-shell">
        <div className="social-panel-tabs">
          <button
            type="button"
            className={`social-panel-tab ${mode === "posts" ? "social-panel-tab--active" : ""}`}
            onClick={() => setMode("posts")}
          >
            Posts ({redditPosts.length})
          </button>
          <button
            type="button"
            className={`social-panel-tab ${mode === "campaigns" ? "social-panel-tab--active" : ""}`}
            onClick={() => setMode("campaigns")}
          >
            Campaigns ({campaigns.length})
          </button>
        </div>

        {mode === "posts" ? (
          redditPosts.length === 0 ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">No Reddit posts planned yet.</p>
              <p className="social-empty-card__copy">Add a Reddit post plan here and it will appear in this workspace for follow-up.</p>
              <div className="social-empty-card__actions">
                <button type="button" onClick={() => setIsPostModalOpen(true)}>
                  + Post
                </button>
              </div>
            </div>
          ) : (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Post</span>
                <span>Status</span>
                <span>Scheduled</span>
                <span>Strategy</span>
              </div>
              {redditPosts.map((item) => (
                <div className="table__row" key={item.id}>
                  <span className="social-content-preview">
                    {renderPlannerPostMedia(item)}
                    <span className="social-content-preview__body">
                      <span className="social-content-preview__text">{item.title}</span>
                      {item.description ? <small className="social-content-preview__meta">{item.description}</small> : null}
                    </span>
                  </span>
                  <span>
                    <span className="social-status-pill social-status-pill--neutral">{item.status}</span>
                  </span>
                  <span className="social-muted">{item.scheduled_for ? new Date(item.scheduled_for).toLocaleString() : "—"}</span>
                  <span className="social-muted">{item.related_strategy_name || "—"}</span>
                </div>
              ))}
            </div>
          )
        ) : campaigns.length === 0 ? (
          <div className="social-empty-card">
            <p className="social-empty-card__title">No campaigns yet.</p>
            <p className="social-empty-card__copy">
              Create your first Reddit campaign to automatically find and reply to comments.
            </p>
            <div className="social-empty-card__actions">
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setIsCampaignModalOpen(true);
                }}
              >
                + Campaign
              </button>
            </div>
          </div>
        ) : (
          <div className="table social-campaign-table">
            <div className="table__row table__row--header">
              <span>Campaign</span>
              <span>Account</span>
              <span>Interval</span>
              <span>Duration</span>
              <span>Actions</span>
            </div>
            {asArray<RedditCampaign>(campaigns).map((campaign) => (
              <div className="table__row" key={campaign.id}>
                <span>
                  {campaign.name}
                  <small>{`r/${campaign.subreddit} • ${campaign.search_query}`}</small>
                </span>
                <span className="social-muted">
                  {accounts.find((account) => account.id === campaign.reddit_account_id)?.name || "—"}
                </span>
                <span className="social-muted">{campaign.throttle_interval_minutes ? `${campaign.throttle_interval_minutes} min` : "—"}</span>
                <span className="social-muted">
                  {campaign.start_at ? new Date(campaign.start_at).toLocaleString() : "Started immediately"}
                  {campaign.end_at ? ` → ${new Date(campaign.end_at).toLocaleString()}` : ""}
                </span>
                <span className="social-table-actions">
                  <button
                    onClick={() => {
                      setEditingId(campaign.id);
                      setIsCampaignModalOpen(true);
                    }}
                    className="social-inline-button"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirmDeleteCampaign(campaign.name)) return;
                      await api.deleteCampaign(campaign.id);
                      await load();
                    }}
                    className="social-inline-button social-inline-button--danger"
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {isSetupOpen ? (
        <div className="social-connections-modal-backdrop" onClick={() => setIsSetupOpen(false)}>
          <div className="social-connections-modal panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel__title-row">
              <div>
                <p className="social-kicker">Setup</p>
                <h2>Reddit Agent</h2>
              </div>
              <button className="button-secondary" type="button" onClick={() => setIsSetupOpen(false)}>
                Close
              </button>
            </div>

            <div className="social-panel-tabs social-panel-tabs--modal">
              <button
                type="button"
                className={`social-panel-tab ${setupTab === "overview" ? "social-panel-tab--active" : ""}`}
                onClick={() => setSetupTab("overview")}
              >
                Overview
              </button>
              <button
                type="button"
                className={`social-panel-tab ${setupTab === "knowledge" ? "social-panel-tab--active" : ""}`}
                onClick={() => setSetupTab("knowledge")}
              >
                Knowledge Base
              </button>
              <button
                type="button"
                className={`social-panel-tab ${setupTab === "accounts" ? "social-panel-tab--active" : ""}`}
                onClick={() => setSetupTab("accounts")}
              >
                Accounts
              </button>
            </div>

            {setupTab === "overview" ? (
              <section className="social-panel-section">
                <div className="social-note">
                  <strong>Workspace summary</strong>
                  <p>
                    Keep Reddit response guidance, OAuth accounts, and campaign access together here so the main page stays focused on posts and campaigns.
                  </p>
                </div>
              </section>
            ) : null}

            {setupTab === "knowledge" ? (
              <section className="social-panel-section">
                <div className="panel__title-row">
                  <h2>🟠 Reddit Knowledge Base</h2>
                </div>
                <div className="social-knowledge-pane">
                  <KnowledgeBaseEditor type="reddit_campaign" entityId={REDDIT_GLOBAL_KB_ID} />
                </div>
              </section>
            ) : null}

            {setupTab === "accounts" ? (
              <section className="social-panel-section">
                <div className="panel__title-row">
                  <h2>Connected Reddit Accounts</h2>
                </div>

                <div className="social-account-adder">
                  <div className="social-account-adder__intro">
                    <strong>Connect another account</strong>
                    <p>Each Reddit profile uses OAuth, so you can safely add multiple accounts and select them per campaign.</p>
                  </div>
                  <div className="social-account-adder__controls">
                    <label className="social-account-adder__field">
                      <span>Account name</span>
                      <input
                        type="text"
                        placeholder="My Reddit Bot"
                        value={accountName}
                        onChange={(event) => {
                          setAccountName(event.target.value);
                          if (accountError) setAccountError(null);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!accountName.trim() || connectingAccount}
                      onClick={() => void connectRedditAccount()}
                    >
                      {connectingAccount ? "Redirecting..." : "Connect"}
                    </button>
                  </div>
                  {accountError ? <p className="social-account-adder__error">{accountError}</p> : null}
                </div>

                {accounts.length === 0 ? (
                  <div className="social-empty-card">
                    <p className="social-empty-card__title">No connected accounts.</p>
                    <p className="social-empty-card__copy">Connect a Reddit account to start powering campaign discovery and response workflows.</p>
                  </div>
                ) : (
                  <div className="table">
                    <div className="table__row table__row--header">
                      <span>Account</span>
                      <span>Status</span>
                      <span>Connected</span>
                      <span>Actions</span>
                    </div>
                    {asArray<RedditAccount>(accounts).map((account) => (
                      <div className="table__row" key={account.id}>
                        <span>{account.name}</span>
                        <span>
                          <span className={`social-status-pill social-status-pill--${account.status === "active" ? "success" : "neutral"}`}>
                            {account.status}
                          </span>
                        </span>
                        <span className="social-muted">{new Date(account.created_at).toLocaleDateString()}</span>
                        <span className="social-table-actions">
                          <button
                            onClick={async () => {
                              await api.deleteRedditAccount(account.id);
                              await load();
                            }}
                            className="social-inline-button social-inline-button--danger"
                          >
                            Disconnect
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
        <SocialPlannerItemModal
          itemType="post"
          platform="Reddit"
          platformLabel="Reddit"
          onClose={() => setIsPostModalOpen(false)}
          onSubmit={async (payload) => {
            await api.createPlannerItem(payload);
            await load();
          }}
        />
      ) : null}
      {isCampaignModalOpen ? (
        <SocialCampaignModal
          platform="reddit"
          platformLabel="Reddit"
          accounts={accounts.map((account) => ({ id: account.id, label: account.name }))}
          initialData={editingCampaign}
          mode={editingCampaign ? "edit" : "create"}
          onClose={() => {
            setIsCampaignModalOpen(false);
            setEditingId(null);
          }}
          onSubmit={async (payload) => {
            if (editingCampaign?.id) {
              await api.updateCampaign(editingCampaign.id, payload);
            } else {
              await api.createCampaign({
                reddit_account_id: Number(payload.reddit_account_id),
                name: payload.name || "",
                description: payload.description || "",
                subreddit: payload.subreddit || "",
                search_query: payload.search_query || "",
                search_criteria: {
                  min_score: 0,
                  time_filter: "week",
                },
                agent_instructions: payload.agent_instructions || "",
                batch_size: 10,
                batch_window_hours: 24,
                throttle_enabled: true,
                throttle_interval_minutes: Number(payload.throttle_interval_minutes) || 60,
                start_at: payload.start_at || null,
                end_at: payload.end_at || null,
                telegram_chat_id: payload.telegram_chat_id || "",
                status: "active",
                approval_method: "batch",
              } as Omit<RedditCampaign, "id" | "created_at" | "updated_at">);
            }
            await load();
            setEditingId(null);
          }}
        />
      ) : null}
    </div>
  );
}
