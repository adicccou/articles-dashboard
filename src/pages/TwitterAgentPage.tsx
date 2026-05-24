import { forwardRef, useEffect, useState } from "react";
import type { SocialAccount, SocialPost, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { SocialPublisherWorkspace, type SocialAgentToolbarHandle, type SocialWorkspaceFeedback } from "../components/SocialPublisherWorkspace";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";

const TWITTER_KB_ID = 1;

export const TwitterAgentPage = forwardRef<SocialAgentToolbarHandle>(function TwitterAgentPage(_props, ref) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [scheduledSocialPosts, setScheduledSocialPosts] = useState<SocialPost[]>([]);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [newPost, setNewPost] = useState("");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<SocialWorkspaceFeedback | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [postsData, plannerData, accountsData, threadsScheduledPosts, redditScheduledPosts] = await Promise.all([
        api.listSocialPosts("twitter"),
        api.listPlannerItems(),
        api.listTwitterAccounts(),
        api.listSocialPosts("threads").catch(() => []),
        api.listSocialPosts("reddit").catch(() => []),
      ]);
      const loadedPosts = asArray<SocialPost>(postsData);
      setPosts(loadedPosts);
      setScheduledSocialPosts([
        ...loadedPosts,
        ...asArray<SocialPost>(threadsScheduledPosts),
        ...asArray<SocialPost>(redditScheduledPosts),
      ]);
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
  const activePlannerPostStatuses = new Set(["planned", "drafting", "approved"]);
  const activeSocialPostStatuses = new Set(["draft", "approved", "scheduled"]);
  const socialPlannerPlatforms = new Set(["reddit", "threads", "thread", "twitter", "x", "twitter/x"]);
  const scheduledSlots = [
    ...plannerItems
      .filter((item) => (
        item.item_type === "post"
        && activePlannerPostStatuses.has(item.status)
        && socialPlannerPlatforms.has(item.platform.trim().toLowerCase())
      ))
      .map((item) => item.scheduled_for)
      .filter((value): value is string => Boolean(value)),
    ...scheduledSocialPosts
      .filter((post) => activeSocialPostStatuses.has(post.status))
      .map((post) => post.scheduled_at)
      .filter((value): value is string => Boolean(value)),
  ];

  return (
    <>
      <SocialPublisherWorkspace
        ref={ref}
        hideHeader
        icon="𝕏"
        platformLabel="Twitter / X Agent"
        shortLabel="𝕏"
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
    </>
  );
});

TwitterAgentPage.displayName = "TwitterAgentPage";
