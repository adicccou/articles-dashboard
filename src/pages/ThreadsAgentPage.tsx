import { useEffect, useState } from "react";
import type { SocialAccount, SocialPost, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { SocialPublisherWorkspace } from "../components/SocialPublisherWorkspace";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";
import { SocialPlannerItemModal } from "../components/SocialPlannerItemModal";

const THREADS_KB_ID = 2;

export function ThreadsAgentPage() {
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
        api.listSocialPosts("threads"),
        api.listPlannerItems(),
        api.listThreadsAccounts(),
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
    (item) => item.item_type === "campaign" && item.platform.trim().toLowerCase() === "threads",
  );

  return (
    <>
      <SocialPublisherWorkspace
        icon="🧵"
        platformLabel="Threads Agent"
        shortLabel="🧵"
        campaignCount={campaigns.length}
        connectedMessage="Threads credentials are configured and queued posts are ready for workflow-based publishing."
        disconnectedMessage="Add a Threads account with its Meta credentials before relying on the queue."
        queuePlaceholder="Write a Threads post for the queue..."
        queueHint="Draft a Threads post above, or send planned content in from the bot for later approval."
        queueLimit={500}
        accountsEmptyMessage="No Threads accounts are attached yet. Add an account with its Meta Graph API fields to start publishing."
        isConnected={isConnected}
        loading={loading}
        posts={posts}
        accounts={accounts}
        campaignContent={
          campaigns.length === 0 ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">No Threads campaigns yet.</p>
              <p className="social-empty-card__copy">Create your first Threads campaign here and it will show up in this workspace.</p>
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
            await api.createSocialPost("threads", newPost.trim(), scheduledAt ?? undefined);
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
          await api.addThreadsAccount(values);
          await load();
        }}
        onDeleteAccount={async (id) => {
          await api.deleteThreadsAccount(id);
          await load();
        }}
        knowledgeBaseContent={<KnowledgeBaseEditor type="social_platform" entityId={THREADS_KB_ID} />}
        accountInputHint="Add each Threads profile with the Meta fields required for publishing from that account."
        onCreateCampaign={() => setIsCampaignModalOpen(true)}
        accountFields={[
          {
            key: "username",
            label: "Threads username",
            placeholder: "username",
          },
          {
            key: "access_token",
            label: "Access Token",
            type: "password",
          },
          {
            key: "user_id",
            label: "User ID",
          },
        ]}
        extraActions={<span className="social-hero__caption">Planner campaigns and queued posts stay aligned here.</span>}
      />
      {isCampaignModalOpen ? (
        <SocialPlannerItemModal
          itemType="campaign"
          platform="Threads"
          platformLabel="Threads"
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
