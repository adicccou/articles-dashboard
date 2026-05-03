import { useEffect, useState } from "react";
import type { RedditCampaign, RedditAccount } from "../lib/types";
import { api } from "../lib/api";
import { RedditCampaignForm } from "../components/RedditCampaignForm";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";
import { asArray } from "../lib/collections";

type TabView = "campaigns" | "accounts" | "form" | "knowledge-base";

// entity_id=0 is the global Reddit agent knowledge base (not tied to a specific campaign)
const REDDIT_GLOBAL_KB_ID = 0;

export function RedditAgentPage() {
  const [campaigns, setCampaigns] = useState<RedditCampaign[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [tab, setTab] = useState<TabView>("campaigns");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [campaignsData, accountsData] = await Promise.all([
        api.listCampaigns(),
        api.listRedditAccounts(),
      ]);
      setCampaigns(asArray<RedditCampaign>(campaignsData));
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

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (tab === "form") {
    return (
      <div className="stack">
        <button onClick={() => setTab("campaigns")} className="button-secondary">
          ← Back to Campaigns
        </button>
        <RedditCampaignForm
          accounts={asArray<RedditAccount>(accounts)}
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

  if (tab === "accounts") {
    return (
      <div className="stack">
        <button onClick={() => setTab("campaigns")} className="button-secondary">
          ← Back to Campaigns
        </button>
        <div className="panel">
          <div className="panel__title-row">
            <h2>🔐 Connected Reddit Accounts</h2>
          </div>
          {accounts.length === 0 ? (
            <p style={{ color: "#6b7280", padding: "16px" }}>
              No Reddit accounts connected yet.
            </p>
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
                  <span>{account.status}</span>
                  <span>{new Date(account.created_at).toLocaleDateString()}</span>
                  <span>
                    <button
                      onClick={async () => {
                        await api.deleteRedditAccount(account.id);
                        await load();
                      }}
                      style={{
                        fontSize: "12px",
                        padding: "4px 8px",
                        background: "none",
                        border: "1px solid #fecaca",
                        color: "#dc2626",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Disconnect
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (tab === "knowledge-base") {
    return (
      <div className="stack">
        <button onClick={() => setTab("campaigns")} className="button-secondary">
          ← Back to Campaigns
        </button>
        <div className="panel">
          <div className="panel__title-row">
            <h2>📚 Knowledge Base</h2>
          </div>
          <p style={{ color: "#6b7280", marginBottom: "16px" }}>
            Add information about your products and services here. The AI agent uses this when generating replies to Reddit comments.
          </p>
          <KnowledgeBaseEditor type="reddit_campaign" entityId={REDDIT_GLOBAL_KB_ID} />
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {error && <p className="error panel">{error}</p>}
      <section className="panel">
        <div className="panel__title-row">
          <h2>🤖 Reddit Agent Campaigns</h2>
          <div className="actions">
            <button onClick={() => setTab("knowledge-base")} className="button-secondary">
              📚 Knowledge Base
            </button>
            <button onClick={() => setTab("accounts")} className="button-secondary">
              Accounts ({accounts.length})
            </button>
            <button onClick={() => setTab("form")}>New Campaign</button>
          </div>
        </div>

        {campaigns.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#6b7280" }}>
            <p>No campaigns yet.</p>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>
              Create your first Reddit campaign to automatically find and reply to comments.
            </p>
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
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      backgroundColor: campaign.status === "active" ? "#dcfce7" : "#f3f4f6",
                      color: campaign.status === "active" ? "#166534" : "#6b7280",
                    }}
                  >
                    {campaign.status}
                  </span>
                </span>
                <span>
                  <button
                    onClick={() => {
                      setEditingId(campaign.id);
                      setTab("form");
                    }}
                    style={{
                      fontSize: "12px",
                      padding: "4px 8px",
                      marginRight: "4px",
                      background: "none",
                      border: "1px solid #e5e7eb",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      await api.deleteCampaign(campaign.id);
                      await load();
                    }}
                    style={{
                      fontSize: "12px",
                      padding: "4px 8px",
                      background: "none",
                      border: "1px solid #fecaca",
                      color: "#dc2626",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
