import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { PhotoIcon, PlusIcon } from "@heroicons/react/24/solid";
import type { RedditAccount, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { SocialPlannerItemModal } from "../components/SocialPlannerItemModal";
import { asArray } from "../lib/collections";
import { formatDisplayDateTime } from "../lib/datetime";
import { getDisplayPostImageUrls } from "../lib/socialPostMedia";
import type { SocialAgentToolbarHandle } from "../components/SocialPublisherWorkspace";

export const RedditAgentPage = forwardRef<SocialAgentToolbarHandle>(function RedditAgentPage(_props, ref) {
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [accounts, setAccounts] = useState<RedditAccount[]>([]);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [plannerData, accountsData] = await Promise.all([
        api.listPlannerItems(),
        api.listRedditAccounts(),
      ]);
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

  useImperativeHandle(ref, () => ({
    openComposer: () => setIsPostModalOpen(true),
    reload: () => {
      void load();
    },
  }), []);

  const redditPosts = plannerItems.filter(
    (item) => item.item_type === "post" && item.platform.trim().toLowerCase() === "reddit",
  );

  function renderPlannerPostMedia(item: PlannerItem) {
    const imageUrls = getDisplayPostImageUrls(item.image_url);
    if (imageUrls.length === 0) {
      return (
        <div className="social-post-media social-post-media--placeholder" aria-label="No image attached">
          <PhotoIcon className="social-post-placeholder-icon" aria-hidden="true" />
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

      <section className="panel social-panel-shell">
        <div className="social-panel-section stack">
          <div className="panel__title-row">
            <h2>Reddit Posts ({redditPosts.length})</h2>
          </div>

          {redditPosts.length === 0 ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">No Reddit posts planned yet.</p>
              <p className="social-empty-card__copy">Add a Reddit post plan here and it will appear in this workspace for follow-up.</p>
              <div className="social-empty-card__actions">
                <button type="button" onClick={() => setIsPostModalOpen(true)}>
                  <PlusIcon aria-hidden="true" className="h-4 w-4" />
                  Post
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
          }
        </div>
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
    </div>
  );
});

RedditAgentPage.displayName = "RedditAgentPage";
