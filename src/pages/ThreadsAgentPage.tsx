import { forwardRef, useEffect, useState } from "react";
import { SiThreads } from "react-icons/si";
import type { SocialAccount, SocialPost, PlannerItem } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { SocialPublisherWorkspace, type SocialAgentToolbarHandle, type SocialWorkspaceFeedback } from "../components/SocialPublisherWorkspace";
import { KnowledgeBaseEditor } from "../components/KnowledgeBaseEditor";

const THREADS_KB_ID = 2;
const THREADS_FULL_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_read_replies",
  "threads_manage_replies",
  "threads_keyword_search",
].join(",");

export const ThreadsAgentPage = forwardRef<SocialAgentToolbarHandle>(function ThreadsAgentPage(_props, ref) {
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
      const [
        postsData,
        plannerData,
        accountsData,
        twitterScheduledPosts,
        redditScheduledPosts,
      ] = await Promise.all([
        api.listSocialPosts("threads"),
        api.listPlannerItems(),
        api.listThreadsAccounts(),
        api.listSocialPosts("twitter").catch(() => []),
        api.listSocialPosts("reddit").catch(() => []),
      ]);
      const loadedAccounts = asArray<SocialAccount>(accountsData);
      const loadedPosts = asArray<SocialPost>(postsData);
      setPosts(loadedPosts);
      setScheduledSocialPosts([
        ...loadedPosts,
        ...asArray<SocialPost>(twitterScheduledPosts),
        ...asArray<SocialPost>(redditScheduledPosts),
      ]);
      setPlannerItems(asArray<PlannerItem>(plannerData));
      setAccounts(loadedAccounts);
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
        PlatformIcon={SiThreads}
        platformLabel="Threads Agent"
        shortLabel="Threads"
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
          setFeedback(null);
          try {
            const result = await api.deleteSocialPost(id);
            await load();
            setError(null);
            setFeedback(
              result.dashboard_only
                ? {
                    tone: "success",
                    title: "Removed from the dashboard.",
                    detail: "This only cleared the local dashboard record. Use this after deleting the post in Threads, or when you want to remove a stale entry here.",
                  }
                : {
                    tone: "success",
                    title: "Deleted from the dashboard.",
                    detail: "This Threads post had not been published yet, so it was fully removed locally.",
                  },
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete post");
          }
        }}
        onPublishPost={async (id) => {
          setFeedback(null);
          await api.publishThreadsPost(id);
          await load();
        }}
        onAddAccount={async (values) => {
          setFeedback(null);
          await api.addThreadsAccount(values);
          await load();
        }}
        onConnectAccount={async (values) => {
          setFeedback(null);
          const { auth_url } = await api.startThreadsOAuth(values);
          window.location.href = auth_url;
        }}
        onDeleteAccount={async (id) => {
          setFeedback(null);
          await api.deleteThreadsAccount(id);
          await load();
        }}
        knowledgeBaseContent={<KnowledgeBaseEditor type="social_platform" entityId={THREADS_KB_ID} />}
        accountInputHint="Enter the app details from Meta, then connect with Threads. Use the full scopes to enable publishing, search, and reply tools."
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
            placeholder: "https://marketing-dashboard.adilet-melisov.workers.dev/api/threads/auth/callback",
            defaultValue: "https://marketing-dashboard.adilet-melisov.workers.dev/api/threads/auth/callback",
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
    </>
  );
});

ThreadsAgentPage.displayName = "ThreadsAgentPage";
