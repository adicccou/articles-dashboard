import { useEffect, useState } from "react";
import type { SocialAccount, SocialPost, PlannerItem, ThreadsMedia } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { SocialPublisherWorkspace } from "../components/SocialPublisherWorkspace";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";
import { SocialCampaignModal } from "../components/SocialCampaignModal";

const THREADS_KB_ID = 2;
const THREADS_FULL_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_read_replies",
  "threads_manage_replies",
  "threads_keyword_search",
].join(",");

export function ThreadsAgentPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [newPost, setNewPost] = useState("");
  const [adding, setAdding] = useState(false);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [replyLookupResults, setReplyLookupResults] = useState<ThreadsMedia[]>([]);
  const [replyLookupError, setReplyLookupError] = useState<string | null>(null);
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
      const loadedAccounts = asArray<SocialAccount>(accountsData);
      setPosts(asArray<SocialPost>(postsData));
      setPlannerItems(asArray<PlannerItem>(plannerData));
      setAccounts(loadedAccounts);
      setError(null);
      if (loadedAccounts.length > 0) {
        try {
          const repliesData = await api.listThreadsReplies();
          setReplyLookupResults(repliesData.data ?? []);
          setReplyLookupError(null);
        } catch (replyErr) {
          setReplyLookupResults([]);
          setReplyLookupError(replyErr instanceof Error ? replyErr.message : "Failed to load Threads replies");
        }
      } else {
        setReplyLookupResults([]);
        setReplyLookupError(null);
      }
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
  const scheduledSlots = [
    ...plannerItems.map((item) => item.scheduled_for).filter((value): value is string => Boolean(value)),
    ...posts.map((post) => post.scheduled_at).filter((value): value is string => Boolean(value)),
  ];
  const replyCount = replyLookupResults.length;
  const editingCampaign = editingCampaignId ? campaigns.find((item) => item.id === editingCampaignId) ?? null : null;

  function renderThreadsResult(item: ThreadsMedia) {
    const displayName = item.username ? `@${item.username}` : "Threads post";
    return (
      <article className="social-thread-card" key={item.id}>
        <div className="social-thread-card__header">
          <strong>{displayName}</strong>
          <span>{item.timestamp ? new Date(item.timestamp).toLocaleString() : item.media_type || "THREADS"}</span>
        </div>
        <p>{item.text || "No text returned for this media."}</p>
        <div className="social-thread-card__meta">
          <code>{item.id}</code>
          {item.permalink ? <a href={item.permalink} target="_blank" rel="noreferrer">Open</a> : null}
        </div>
      </article>
    );
  }

  return (
    <>
      <SocialPublisherWorkspace
        icon="🧵"
        platformLabel="Threads Agent"
        shortLabel="🧵"
        campaignCount={campaigns.length}
        queuePlaceholder="Write a Threads post..."
        queueHint="Post immediately above, pick a time manually, or auto-schedule into an open planner slot."
        queueLimit={500}
        scheduledSlots={scheduledSlots}
        postActionLabel="Post"
        postContentLabel="Post"
        accountsEmptyMessage="No Threads accounts are attached yet. Add an account with its Meta app, OAuth, and publishing fields to start publishing."
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
                    {item.duration_start ? new Date(item.duration_start).toLocaleString() : "Any time"}
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
        replyCount={replyCount}
        repliesContent={
          <div className="threads-replies-tab stack">
            <div className="threads-results-list">
              {replyLookupError ? <p className="error">{replyLookupError}</p> : null}
              {replyLookupResults.map(renderThreadsResult)}
              {!replyLookupError && replyLookupResults.length === 0 ? (
                <p className="social-empty">No replies loaded yet.</p>
              ) : null}
            </div>
          </div>
        }
        newPost={newPost}
        adding={adding}
        error={error}
        onReload={load}
        onQueueChange={setNewPost}
        onCreatePost={async (scheduledAt) => {
          setAdding(true);
          try {
            const content = newPost.trim();
            const post = await api.createSocialPost("threads", content, scheduledAt ?? undefined);
            if (!scheduledAt) {
              await api.publishSocialPost(post.id);
            } else {
              await api.createPlannerItem({
                title: `Threads post: ${content.slice(0, 80) || "Scheduled post"}`,
                description: content,
                item_type: "post",
                platform: "threads",
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
          await api.deleteSocialPost(id);
          await load();
        }}
        onPublishPost={async (id) => {
          await api.publishThreadsPost(id);
          await load();
        }}
        onAddAccount={async (values) => {
          await api.addThreadsAccount(values);
          await load();
        }}
        onConnectAccount={async (values) => {
          const { auth_url } = await api.startThreadsOAuth(values);
          window.location.href = auth_url;
        }}
        onDeleteAccount={async (id) => {
          await api.deleteThreadsAccount(id);
          await load();
        }}
        knowledgeBaseContent={<KnowledgeBaseEditor type="social_platform" entityId={THREADS_KB_ID} />}
        accountInputHint="Enter the app details from Meta, then connect with Threads. Use the full scopes to enable publishing, search, and reply tools."
        onCreateCampaign={() => {
          setEditingCampaignId(null);
          setIsCampaignModalOpen(true);
        }}
        connectAccountLabel="Connect with Threads"
        connectAccountRequiredFieldKeys={["username", "client_id", "client_secret", "redirect_uri", "scopes"]}
        addAccountLabel="Save manual token"
        addAccountRequiredFieldKeys={["username", "client_id", "client_secret", "redirect_uri", "scopes", "access_token", "user_id"]}
        accountFields={[
          {
            key: "username",
            label: "Threads username",
            placeholder: "username",
          },
          {
            key: "client_id",
            label: "Threads App ID / Client ID",
            placeholder: "Meta app ID",
          },
          {
            key: "client_secret",
            label: "Threads App Secret",
            type: "password",
          },
          {
            key: "redirect_uri",
            label: "Redirect URI",
            placeholder: "https://dashboard.adilet-melisov.workers.dev/api/threads/auth/callback",
            defaultValue: "https://dashboard.adilet-melisov.workers.dev/api/threads/auth/callback",
          },
          {
            key: "scopes",
            label: "Scopes",
            placeholder: "threads_basic,threads_content_publish",
            defaultValue: THREADS_FULL_SCOPES,
          },
          {
            key: "access_token",
            label: "Long-Lived Access Token",
            type: "password",
            required: false,
          },
          {
            key: "user_id",
            label: "Threads User ID",
            required: false,
          },
        ]}
      />
      {isCampaignModalOpen ? (
        <SocialCampaignModal
          platform="threads"
          platformLabel="Threads"
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
