import { forwardRef, useEffect, useState } from "react";
import type { SocialAccount, SocialPost, PlannerItem, ThreadsMedia } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";
import { formatDisplayDateTime } from "../lib/datetime";
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
  const [replyLookupResults, setReplyLookupResults] = useState<ThreadsMedia[]>([]);
  const [replyLookupError, setReplyLookupError] = useState<string | null>(null);
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
  const replyCount = replyLookupResults.length;

  function renderThreadsResult(item: ThreadsMedia) {
    const displayName = item.username ? `@${item.username}` : "Threads post";
    return (
      <article className="social-thread-card" key={item.id}>
        <div className="social-thread-card__header">
          <strong>{displayName}</strong>
          <span>{item.timestamp ? formatDisplayDateTime(item.timestamp) : item.media_type || "THREADS"}</span>
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
        ref={ref}
        hideHeader
        icon="🧵"
        platformLabel="Threads Agent"
        shortLabel="🧵"
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
        replyCount={replyCount}
        repliesContent={
          <div className="threads-replies-tab stack">
            <div className="threads-results-list">
              <div className="panel__title-row">
                <h3>Published / account replies</h3>
              </div>
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
    </>
  );
});

ThreadsAgentPage.displayName = "ThreadsAgentPage";
