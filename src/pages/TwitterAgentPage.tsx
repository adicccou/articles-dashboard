import { useEffect, useState } from "react";
import type { SocialAccount, SocialPost, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { SocialPublisherWorkspace } from "../components/SocialPublisherWorkspace";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";
import { SocialPlannerItemModal } from "../components/SocialPlannerItemModal";

const TWITTER_KB_ID = 1;

export function TwitterAgentPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [newPost, setNewPost] = useState("");
  const [adding, setAdding] = useState(false);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [postsData, plannerData, accountsData] = await Promise.all([
        api.listSocialPosts("twitter"),
        api.listPlannerItems(),
        api.listTwitterAccounts(),
      ]);
      setPosts(asArray<SocialPost>(postsData));
      setPlannerItems(asArray<PlannerItem>(plannerData));
      setAccounts(asArray<SocialAccount>(accountsData));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const isConnected = accounts.length > 0;
  const campaigns = plannerItems.filter(
    (item) => item.item_type === "campaign" && ["x", "twitter", "twitter/x"].includes(item.platform.trim().toLowerCase()),
  );

  return (
    <>
      <SocialPublisherWorkspace
        icon="𝕏"
        platformLabel="Twitter / X Agent"
        shortLabel="𝕏"
        campaignCount={campaigns.length}
        connectedMessage="Twitter/X credentials are in place and the queue is ready for approved publishing."
        disconnectedMessage="Add an X account with its API credentials before relying on the queue."
        queuePlaceholder="Write a tweet for the queue..."
        queueHint="Draft a post above, or send content into the queue from your Telegram bot."
        queueLimit={280}
        accountsEmptyMessage="No Twitter/X accounts are attached yet. Add an account with its API credentials to start publishing."
        isConnected={isConnected}
        loading={loading}
        posts={posts}
        accounts={accounts}
        campaignContent={
          campaigns.length === 0 ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">No X campaigns yet.</p>
              <p className="social-empty-card__copy">Create your first X campaign here and it will start showing up in this workspace.</p>
              <div className="social-empty-card__actions">
                <button type="button" onClick={() => setIsCampaignModalOpen(true)}>
                  + Campaign
                </button>
              </div>
            </div>
          ) : (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Campaign</span>
                <span>Status</span>
                <span>Scheduled</span>
                <span>Strategy</span>
              </div>
              {campaigns.map((item) => (
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
        }
        newPost={newPost}
        adding={adding}
        error={error}
        onReload={load}
        onQueueChange={setNewPost}
        onCreatePost={async (scheduledAt) => {
          setAdding(true);
          try {
            await api.createSocialPost("twitter", newPost.trim(), scheduledAt ?? undefined);
            setNewPost("");
            await load();
          } finally {
            setAdding(false);
          }
        }}
        onDeletePost={async (id) => {
          await api.deleteSocialPost(id);
          await load();
        }}
        onAddAccount={async (values) => {
          await api.addTwitterAccount(values);
          await load();
        }}
        onDeleteAccount={async (id) => {
          await api.deleteTwitterAccount(id);
          await load();
        }}
        knowledgeBaseContent={<KnowledgeBaseEditor type="social_platform" entityId={TWITTER_KB_ID} />}
        accountInputHint="Add each X profile with the credentials required for publishing from that account."
        onCreateCampaign={() => setIsCampaignModalOpen(true)}
        accountFields={[
          {
            key: "username",
            label: "Twitter / X username",
            placeholder: "username",
          },
          {
            key: "api_key",
            label: "API Key",
            type: "password",
          },
          {
            key: "api_secret",
            label: "API Secret",
            type: "password",
          },
          {
            key: "access_token",
            label: "Access Token",
            type: "password",
          },
          {
            key: "access_secret",
            label: "Access Secret",
            type: "password",
          },
        ]}
        extraActions={<span className="social-hero__caption">Posts and campaigns share the same approval pipeline.</span>}
      />
      {isCampaignModalOpen ? (
        <SocialPlannerItemModal
          itemType="campaign"
          platform="Twitter"
          platformLabel="X"
          onClose={() => setIsCampaignModalOpen(false)}
          onSubmit={async (payload) => {
            await api.createPlannerItem(payload);
            await load();
          }}
        />
      ) : null}
    </>
  );
}
