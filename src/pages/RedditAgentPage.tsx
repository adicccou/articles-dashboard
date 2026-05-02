import { useState } from "react";
import type { RedditCampaign, RedditAccount } from "../lib/types";
import { RedditCampaignForm } from "../components/RedditCampaignForm";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";

interface RedditAgentPageProps {
  campaigns: RedditCampaign[];
  accounts: RedditAccount[];
  onCreateAccount?: () => void;
  onCreateCampaign?: (campaign: RedditCampaign) => Promise<void>;
  onUpdateCampaign?: (id: number, campaign: Partial<RedditCampaign>) => Promise<void>;
  onDeleteCampaign?: (id: number) => Promise<void>;
}

type TabView = "campaigns" | "accounts" | "form" | "knowledge-base";

export const RedditAgentPage: React.FC<RedditAgentPageProps> = ({
  campaigns,
  accounts,
  onCreateAccount,
  onCreateCampaign,
  onUpdateCampaign,
  onDeleteCampaign,
}) => {
  const [tab, setTab] = useState<TabView>("campaigns");
  const [editingId, setEditingId] = useState<number | null>(null);

  if (tab === "form") {
    return (
      <div className="stack">
        <button onClick={() => setTab("campaigns")} className="button-secondary">
          ← Back to Campaigns
        </button>
        <RedditCampaignForm
          accounts={accounts}
          onSubmit={async (data) => {
            if (editingId) {
              await onUpdateCampaign?.(editingId, data);
            } else {
              await onCreateCampaign?.(data as RedditCampaign);
            }
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
            <button onClick={onCreateAccount}>Connect Account</button>
          </div>
          {accounts.length === 0 ? (
            <p style={{ color: "#6b7280", padding: "16px" }}>
              No Reddit accounts connected yet. Click "Connect Account" to get started.
            </p>
          ) : (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Account</span>
                <span>Status</span>
                <span>Connected</span>
              </div>
              {accounts.map((account) => (
                <div className="table__row" key={account.id}>
                  <span>{account.name}</span>
                  <span>{account.status}</span>
                  <span>{new Date(account.created_at).toLocaleDateString()}</span>
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
            <h2>📚 Knowledge Base Settings</h2>
          </div>
          <p style={{ color: "#6b7280", marginBottom: "16px" }}>
            Add information about your products and services here. This knowledge will inform the AI agent when generating replies to Reddit comments.
          </p>
          <KnowledgeBaseEditor
            type="reddit_campaign"
            entityId={1}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel__title-row">
          <h2>🤖 Reddit Agent Campaigns</h2>
          <div className="actions">
            <button
              onClick={() => setTab("knowledge-base")}
              className="button-secondary"
            >
              📚 Knowledge Base
            </button>
            <button
              onClick={() => setTab("accounts")}
              className="button-secondary"
            >
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
              <span>Found</span>
              <span>Actions</span>
            </div>
            {campaigns.map((campaign) => (
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
                      backgroundColor:
                        campaign.status === "active" ? "#dcfce7" : "#f3f4f6",
                      color:
                        campaign.status === "active" ? "#166534" : "#6b7280",
                    }}
                  >
                    {campaign.status}
                  </span>
                </span>
                <span>0</span>
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
                    onClick={() => onDeleteCampaign?.(campaign.id)}
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
};
