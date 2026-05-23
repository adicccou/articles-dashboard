import { useEffect, useState } from "react";
import type { RedditCampaign, RedditAccount, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { SocialPlannerItemModal } from "../components/SocialPlannerItemModal";
import { SocialCampaignModal } from "../components/SocialCampaignModal";
import { asArray } from "../lib/collections";
import { formatDisplayDateTime } from "../lib/datetime";
import { getPostImageUrls } from "../lib/socialPostMedia";

type ContentMode = "posts" | "campaigns";

export function RedditAgentPage() {
  const [campaigns, setCampaigns] = useState<RedditCampaign[]>([]);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [mode, setMode] = useState<ContentMode>("campaigns");
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            <div className="social-post-card-grid">
              {redditPosts.map((item) => (
                <article className="social-post-card" key={item.id}>
                  <div className="social-post-card__media">
                    {renderPlannerPostMedia(item)}
                  </div>
                  <div className="social-post-card__body">
                    <div className="social-post-card__meta">
                      <span className="social-status-pill social-status-pill--neutral">{item.status}</span>
                      <span className="social-muted">{item.scheduled_for ? formatDisplayDateTime(item.scheduled_for) : "Unscheduled"}</span>
                    </div>
                    <p className="social-post-card__content">{item.title || "Untitled Reddit post"}</p>
                    {item.description ? <p className="social-post-card__description">{item.description}</p> : null}
                    {item.related_strategy_name ? (
                      <span className="social-post-card__tag">{item.related_strategy_name}</span>
                    ) : null}
                  </div>
                </article>
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
                  {campaign.start_at ? formatDisplayDateTime(campaign.start_at) : "Started immediately"}
                  {campaign.end_at ? ` → ${formatDisplayDateTime(campaign.end_at)}` : ""}
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
