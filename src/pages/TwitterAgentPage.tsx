import { useEffect, useState } from "react";
import type { SocialAccount, SocialPost, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { SocialPublisherWorkspace, type SocialWorkspaceFeedback } from "../components/SocialPublisherWorkspace";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";
import { SocialCampaignModal } from "../components/SocialCampaignModal";

const TWITTER_KB_ID = 1;

export function TwitterAgentPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [newPost, setNewPost] = useState("");
  const [adding, setAdding] = useState(false);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<SocialWorkspaceFeedback | null>(null);

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

  const isConnected = accounts.some((account) => account.status === "active" && Boolean(account.credentials_ready));
  const campaigns = plannerItems.filter(
    (item) => item.item_type === "campaign" && ["x", "twitter", "twitter/x"].includes(item.platform.trim().toLowerCase()),
  );
  const scheduledSlots = [
    ...plannerItems.map((item) => item.scheduled_for).filter((value): value is string => Boolean(value)),
    ...posts.map((post) => post.scheduled_at).filter((value): value is string => Boolean(value)),
  ];
  const editingCampaign = editingCampaignId ? campaigns.find((item) => item.id === editingCampaignId) ?? null : null;
  const confirmDeleteCampaign = (title: string) =>
    window.confirm(`Delete the X campaign "${title}"? This cannot be undone.`);

  return (
    <>
      <SocialPublisherWorkspace
        icon="𝕏"
        platformLabel="Twitter / X Agent"
        shortLabel="𝕏"
        campaignCount={campaigns.length}
        queuePlaceholder="Write a tweet..."
        queueHint="Post immediately above, pick a time manually, or auto-schedule into an open planner slot."
        queueLimit={280}
        scheduledSlots={scheduledSlots}
        postActionLabel="Tweet"
        postContentLabel="Tweet"
        accountsEmptyMessage="No Twitter/X accounts are attached yet. Add an account with its API credentials to start publishing."
        isConnected={isConnected}
        loading={loading}
        posts={posts}
        accounts={accounts}
        feedback={feedback}
        campaignContent={
          campaigns.length === 0 ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">No X campaigns yet.</p>
              <p className="social-empty-card__copy">Create your first X campaign here and it will start showing up in this workspace.</p>
              <div className="social-empty-card__actions">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCampaignId(null);
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
              {campaigns.map((item) => (
                <div className="table__row" key={item.id}>
                  <span>
                    {item.title}
                    {item.instruction ? <small>{item.instruction}</small> : null}
                  </span>
                  <span className="social-muted">
                    {accounts.find((account) => account.id === item.account_id)?.username || "—"}
                  </span>
                  <span className="social-muted">{item.interval_minutes ? `${item.interval_minutes} min` : "—"}</span>
                  <span className="social-muted">
                    {item.duration_start ? new Date(item.duration_start).toLocaleString() : "Started immediately"}
                    {item.duration_end ? ` → ${new Date(item.duration_end).toLocaleString()}` : ""}
                  </span>
                  <span className="social-table-actions">
                    <button
                      type="button"
                      className="social-inline-button"
                      onClick={() => {
                        setEditingCampaignId(item.id);
                        setIsCampaignModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="social-inline-button social-inline-button--danger"
                      onClick={async () => {
                        if (!confirmDeleteCampaign(item.title)) return;
                        await api.deletePlannerItem(item.id);
                        await load();
                      }}
                    >
                      Delete
                    </button>
                  </span>
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
          setFeedback(null);
          setAdding(true);
          try {
            const content = newPost.trim();
            const post = await api.createSocialPost("twitter", content, scheduledAt ?? undefined);
            if (!scheduledAt) {
              await api.publishSocialPost(post.id);
            } else {
              await api.createPlannerItem({
                title: `Twitter post: ${content.slice(0, 80) || "Scheduled post"}`,
                description: content,
                item_type: "post",
                platform: "twitter",
                status: "approved",
                scheduled_for: scheduledAt,
              });
            }
            setNewPost("");
            await load();
          } finally {
            setAdding(false);
          }
        }}
        onDeletePost={async (id) => {
          setFeedback(null);
          try {
            const result = await api.deleteSocialPost(id);
            await load();
            setError(null);
            setFeedback(
              result.external_deleted
                ? {
                    tone: "success",
                    title: "Deleted from X and removed from the dashboard.",
                  }
                : {
                    tone: "success",
                    title: "Deleted from the dashboard.",
                    detail: "This post was removed locally because it had not been published on X yet.",
                  },
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete post");
          }
        }}
        onPublishPost={async (id) => {
          setFeedback(null);
          await api.publishSocialPost(id);
          await load();
        }}
        onAddAccount={async (values) => {
          setFeedback(null);
          await api.addTwitterAccount(values);
          await load();
        }}
        onDeleteAccount={async (id) => {
          setFeedback(null);
          await api.deleteTwitterAccount(id);
          await load();
        }}
        knowledgeBaseContent={<KnowledgeBaseEditor type="social_platform" entityId={TWITTER_KB_ID} />}
        accountInputHint="Add each X profile with the credentials required for publishing from that account."
        onCreateCampaign={() => {
          setEditingCampaignId(null);
          setIsCampaignModalOpen(true);
        }}
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
      />
      {isCampaignModalOpen ? (
        <SocialCampaignModal
          platform="twitter"
          platformLabel="X"
          accounts={accounts.map((account) => ({ id: account.id, label: account.username }))}
          initialData={editingCampaign}
          mode={editingCampaign ? "edit" : "create"}
          onClose={() => {
            setIsCampaignModalOpen(false);
            setEditingCampaignId(null);
          }}
          onSubmit={async (payload) => {
            if (editingCampaign) {
              await api.updatePlannerItem(editingCampaign.id, payload);
              setEditingCampaignId(null);
            } else {
              await api.createPlannerItem(payload);
            }
            await load();
          }}
        />
      ) : null}
    </>
  );
}
