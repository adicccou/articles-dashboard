import { useEffect, useState } from "react";
import type { RedditCampaign, RedditAccount, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { RedditCampaignForm } from "../components/RedditCampaignForm";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";
import { SocialPlannerItemModal } from "../components/SocialPlannerItemModal";
import { asArray } from "../lib/collections";

type TabView = "campaigns" | "form";
type ContentMode = "posts" | "campaigns";
type SetupTab = "overview" | "knowledge" | "accounts";

// entity_id=0 is the global Reddit agent knowledge base (not tied to a specific campaign)
const REDDIT_GLOBAL_KB_ID = 0;

export function RedditAgentPage() {
  const [campaigns, setCampaigns] = useState<RedditCampaign[]>([]);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [tab, setTab] = useState<TabView>("campaigns");
  const [mode, setMode] = useState<ContentMode>("campaigns");
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<SetupTab>("overview");
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
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
  const editingCampaign = editingId ? campaigns.find((campaign) => campaign.id === editingId) : undefined;

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

  if (tab === "form") {
    return (
      <div className="social-workspace stack">
        <section className="panel social-hero">
          <div className="social-hero__content">
            <p className="social-kicker">Social Agent</p>
            <div className="social-title-row">
              <h2>🟠 Reddit Agent</h2>
              <span className="social-status-pill social-status-pill--info">Campaign builder</span>
            </div>
            <p className="social-subtitle">Create or edit campaigns with the same layout and navigation style as the other social agents.</p>
          </div>
          <div className="social-hero__actions">
            <button
              onClick={() => {
                setEditingId(null);
                setTab("campaigns");
              }}
              className="button-secondary"
            >
              Back to Campaigns
            </button>
          </div>
        </section>
        <RedditCampaignForm
          accounts={asArray<RedditAccount>(accounts)}
          initialData={editingCampaign}
          onSubmit={async (data) => {
            if (editingId) {
              await api.updateCampaign(editingId, data);
            } else {
              await api.createCampaign(data as Omit<RedditCampaign, "id" | "created_at" | "updated_at">);
            }
            await load();
            setTab("campaigns");
            setEditingId(null);
          }}
          onCancel={() => {
            setTab("campaigns");
            setEditingId(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="social-workspace stack">
      {error && <p className="error panel">{error}</p>}
      <section className="panel social-hero">
        <div className="social-hero__content">
          <p className="social-kicker">Social Agent</p>
          <div className="social-title-row">
            <h2>🟠 Reddit Agent</h2>
            <span className={`social-status-pill social-status-pill--${campaigns.length ? "success" : "neutral"}`}>
              {accounts.length ? "Connected" : "Needs setup"}
            </span>
          </div>
          <p className="social-subtitle">Manage subreddit campaigns, planned Reddit posts, connected accounts, and response guidance from one workspace.</p>
          <p className="social-hero__status">
            {accounts.length
              ? "Reddit accounts are connected and ready to power campaign discovery and approvals."
              : "Connect a Reddit account to start powering campaign discovery and approval workflows."}
          </p>
          <div className="social-hero__metrics">
            <span className="social-mini-stat"><strong>{redditPosts.length}</strong> posts</span>
            <span className="social-mini-stat"><strong>{campaigns.length}</strong> campaigns</span>
            <span className="social-mini-stat"><strong>{accounts.length}</strong> accounts</span>
            <span className="social-mini-stat"><strong>{campaigns.filter((campaign) => campaign.status === "active").length}</strong> active</span>
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
              setTab("form");
            }}
          >
            + Campaign
          </button>
          <button
            type="button"
            className={`button-secondary ${isSetupOpen ? "social-utility-button--active" : ""}`}
            onClick={() => {
              setSetupTab("knowledge");
              setIsSetupOpen(true);
            }}
          >
            Manage
            <span className="social-toolbar-badge">{accounts.length}</span>
          </button>
          <button type="button" className="button-secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </section>

      <section className="social-meta-grid">
        <article className="social-meta-card">
          <span>Posts</span>
          <strong>{redditPosts.length}</strong>
        </article>
        <article className="social-meta-card">
          <span>Campaigns</span>
          <strong>{campaigns.length}</strong>
        </article>
        <article className="social-meta-card">
          <span>Accounts</span>
          <strong>{accounts.length}</strong>
        </article>
        <article className="social-meta-card">
          <span>Active</span>
          <strong>{campaigns.filter((campaign) => campaign.status === "active").length}</strong>
        </article>
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
                  <span>
                    {item.title}
                    {item.description ? <small>{item.description}</small> : null}
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
                  setTab("form");
                }}
              >
                + Campaign
              </button>
            </div>
          </div>
        ) : (
          <div className="table">
            <div className="table__row table__row--header">
              <span>Name</span>
              <span>Subreddit</span>
              <span>Query</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {asArray<RedditCampaign>(campaigns).map((campaign) => (
              <div className="table__row" key={campaign.id}>
                <span className="truncate">{campaign.name}</span>
                <span>r/{campaign.subreddit}</span>
                <span className="truncate">{campaign.search_query}</span>
                <span>
                  <span className={`social-status-pill social-status-pill--${campaign.status === "active" ? "success" : campaign.status === "paused" ? "warning" : "neutral"}`}>
                    {campaign.status}
                  </span>
                </span>
                <span className="social-table-actions">
                  <button
                    onClick={() => {
                      setEditingId(campaign.id);
                      setTab("form");
                    }}
                    className="social-inline-button"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
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

            <div className="social-connections-summary">
              <article className="social-connections-summary__card">
                <span>Accounts</span>
                <strong>{accounts.length}</strong>
                <small>{accounts.length ? "Connected Reddit profiles ready for campaigns" : "No Reddit profiles connected yet"}</small>
              </article>
              <article className="social-connections-summary__card">
                <span>Connection type</span>
                <strong>OAuth</strong>
                <small>Use Reddit authorization so you can safely manage several accounts later.</small>
              </article>
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
    </div>
  );
}
