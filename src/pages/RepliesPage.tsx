import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { ArrowPathIcon, ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/solid";
import type { IconType } from "react-icons";
import { FaFacebookF, FaLinkedinIn } from "react-icons/fa6";
import { SiInstagram, SiReddit, SiThreads, SiX, SiYoutube } from "react-icons/si";
import { api } from "../lib/api";
import { ModalCloseButton } from "../components/ModalCloseButton";
import type { RedditAccount, SocialAccount, SocialComment } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import { getDisplayPostImageUrls, isVideoMediaUrl } from "../lib/socialPostMedia";
import { normalizeDashboardMediaUrl } from "../lib/mediaUrl";
import "../styles/replies-page.css";

type Platform = SocialAccount["platform"];
type CommentPlatform = SocialComment["platform"];
type ReplyAccount = Pick<SocialAccount, "id" | "platform" | "username" | "status" | "tags">;
type ReplyFilter = "all" | "new" | "replied";
type ReplyThread = {
  key: string;
  post: SocialComment;
  comments: SocialComment[];
};
type DiscussionNode = {
  id: string;
  kind: "comment" | "owner-reply";
  comment: SocialComment;
  children: DiscussionNode[];
};

const REPLIES_PLATFORM_STORAGE_KEY = "dashboard:replies-platform";
const REPLIES_REQUEST_TIMEOUT_MS = 20000;
const REPLIES_COMMENT_LIMIT = 100;
const REPLIES_THREADS_PER_PAGE = 10;
const REPLY_LIMITS: Record<CommentPlatform, number> = {
  reddit: 1000,
  twitter: 280,
  threads: 500,
};
const PLATFORMS: Array<{ id: Platform; label: string; Icon: IconType }> = [
  { id: "reddit", label: "Reddit", Icon: SiReddit },
  { id: "twitter", label: "Twitter", Icon: SiX },
  { id: "threads", label: "Threads", Icon: SiThreads },
  { id: "facebook", label: "Facebook", Icon: FaFacebookF },
  { id: "linkedin", label: "LinkedIn", Icon: FaLinkedinIn },
  { id: "instagram", label: "Instagram", Icon: SiInstagram },
  { id: "youtube", label: "YouTube", Icon: SiYoutube },
];

const COMMENT_PLATFORMS = new Set<Platform>(["reddit", "twitter", "threads"]);

function readStoredPlatform(): Platform {
  if (typeof window === "undefined") return "threads";
  const stored = window.localStorage.getItem(REPLIES_PLATFORM_STORAGE_KEY);
  return PLATFORMS.some((platform) => platform.id === stored) ? (stored as Platform) : "threads";
}

function isCommentPlatform(value: Platform): value is CommentPlatform {
  return COMMENT_PLATFORMS.has(value);
}

function accountLabel(account: ReplyAccount): string {
  const username = account.username ? `@${account.username}` : `Account ${account.id}`;
  const tags = account.tags?.length ? ` (${account.tags.join(", ")})` : "";
  return `${username}${tags}`;
}

function normalizeRedditAccounts(accounts: RedditAccount[]): ReplyAccount[] {
  return accounts.map((account) => ({
    id: account.id,
    platform: "reddit",
    username: account.name,
    status: account.status,
    tags: account.tags,
  }));
}

function uniqueAccounts(accounts: ReplyAccount[]): ReplyAccount[] {
  const seen = new Set<string>();
  const result: ReplyAccount[] = [];
  for (const account of accounts) {
    const key = `${account.platform}:${account.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(account);
  }
  return result;
}

function uniqueComments(comments: SocialComment[]): SocialComment[] {
  const seen = new Set<string>();
  const result: SocialComment[] = [];
  for (const comment of comments) {
    const key = [comment.platform, comment.post_external_id ?? comment.post_id ?? "", comment.external_id ?? comment.text].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(comment);
  }
  return result;
}

function getCommentAuthor(comment: SocialComment): string {
  if (comment.commenter_username && comment.commenter_name) {
    return `${comment.commenter_name} (@${comment.commenter_username})`;
  }
  if (comment.commenter_username) return `@${comment.commenter_username}`;
  if (comment.commenter_name) return comment.commenter_name;
  return "Unknown commenter";
}

function getCommentContext(comment: SocialComment): string | null {
  if (comment.platform === "reddit" && comment.subreddit) {
    return `r/${comment.subreddit}`;
  }

  const preview = comment.post_preview || comment.post_title || "";
  if (!preview.trim()) return null;
  return preview.trim();
}

function getCommentThreadKey(comment: SocialComment): string {
  return [
    comment.platform,
    comment.post_id ?? "no-post-id",
    comment.post_external_id ?? "no-external-id",
    comment.post_preview ?? comment.post_title ?? comment.subreddit ?? "no-context",
  ].join(":");
}

function getReplyTargetId(comment: SocialComment): string | null {
  const value = String(comment.external_id ?? "").trim();
  return value || null;
}

function getReplyStatus(comment: SocialComment): "new" | "replied" {
  if (comment.reply_status === "replied" || (comment.owner_reply_text ?? "").trim()) {
    return "replied";
  }
  return "new";
}

function sortDiscussionNodes(nodes: DiscussionNode[]): DiscussionNode[] {
  return nodes
    .sort((left, right) => getDiscussionTimestamp(left).localeCompare(getDiscussionTimestamp(right)))
    .map((node) => ({ ...node, children: sortDiscussionNodes(node.children) }));
}

function getDiscussionTimestamp(node: DiscussionNode): string {
  return node.kind === "owner-reply" ? String(node.comment.owner_replied_at ?? "") : String(node.comment.commented_at ?? "");
}

function buildDiscussionTree(comments: SocialComment[]): DiscussionNode[] {
  const nodes = new Map<string, DiscussionNode>();
  const parentById = new Map<string, string | null>();

  comments.forEach((comment, index) => {
    const commentId = String(comment.external_id ?? `comment-${index}`);
    nodes.set(commentId, { id: commentId, kind: "comment", comment, children: [] });
    parentById.set(commentId, comment.parent_external_id ?? null);

    if (comment.owner_reply_text) {
      const ownerReplyId = String(comment.owner_reply_external_id ?? `owner-reply-${commentId}`);
      nodes.set(ownerReplyId, { id: ownerReplyId, kind: "owner-reply", comment, children: [] });
      parentById.set(ownerReplyId, commentId);
    }
  });

  const roots: DiscussionNode[] = [];
  nodes.forEach((node) => {
    const parentId = parentById.get(node.id);
    const parent = parentId ? nodes.get(parentId) : null;
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
      return;
    }
    roots.push(node);
  });

  return sortDiscussionNodes(roots);
}

function attachmentSupported(platform: CommentPlatform): boolean {
  return platform === "threads";
}

function isActiveConfigAccount(account: ReplyAccount): boolean {
  return account.status === "active";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, ms);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export function RepliesPage() {
  const [platform, setPlatform] = useState<Platform>(readStoredPlatform);
  const [configuredAccounts, setConfiguredAccounts] = useState<ReplyAccount[]>([]);
  const [selectedAccountByPlatform, setSelectedAccountByPlatform] = useState<Record<string, string>>({});
  const [commentsByPlatform, setCommentsByPlatform] = useState<Record<CommentPlatform, SocialComment[]>>({
    reddit: [],
    twitter: [],
    threads: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [composerComment, setComposerComment] = useState<SocialComment | null>(null);
  const [composerDraft, setComposerDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerAttachmentUrl, setComposerAttachmentUrl] = useState<string | null>(null);
  const [suggestingReply, setSuggestingReply] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [postingReply, setPostingReply] = useState(false);
  const [mediaViewerUrl, setMediaViewerUrl] = useState<string | null>(null);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>("all");
  const [replyPage, setReplyPage] = useState(1);
  const [collapsedThreads, setCollapsedThreads] = useState<Record<string, boolean>>({});
  const replyRequestIdRef = useRef(0);

  async function load(accountSelection = selectedAccountByPlatform) {
    try {
      setError(null);
      const [twitterAccounts, threadsAccounts, redditAccounts, socialAccounts] = await withTimeout(
        Promise.all([
          api.listTwitterAccounts().catch(() => []),
          api.listThreadsAccounts().catch(() => []),
          api.listRedditAccounts().catch(() => []),
          api.listSocialAccounts().catch(() => []),
        ]),
        REPLIES_REQUEST_TIMEOUT_MS,
        "Config accounts",
      );
      const activeAccounts = uniqueAccounts([
        ...twitterAccounts,
        ...threadsAccounts,
        ...normalizeRedditAccounts(redditAccounts),
        ...socialAccounts,
      ]).filter(isActiveConfigAccount);
      const nextVisiblePlatforms = PLATFORMS.filter(({ id }) => activeAccounts.some((account) => account.platform === id));
      setConfiguredAccounts(activeAccounts);

      if (nextVisiblePlatforms.length === 0) {
        setCommentsByPlatform({
          reddit: [],
          twitter: [],
          threads: [],
        });
        return;
      }

      const nextPlatform = nextVisiblePlatforms.some(({ id }) => id === platform) ? platform : nextVisiblePlatforms[0].id;
      if (nextPlatform !== platform) {
        setPlatform(nextPlatform);
      }
      const commentPlatforms = nextVisiblePlatforms.filter((item): item is { id: CommentPlatform; label: string; Icon: IconType } => isCommentPlatform(item.id));
      const results = await Promise.allSettled(
        commentPlatforms.map(async ({ id }) => {
          const selectedAccountId = Number(accountSelection[id] || 0) || undefined;
          const platformAccounts = activeAccounts.filter((account) => account.platform === id);
          const accountIds = selectedAccountId ? [selectedAccountId] : platformAccounts.map((account) => account.id);
          const responses = await Promise.all(
            (accountIds.length ? accountIds : [undefined]).map((accountId) =>
              withTimeout(
                api.listSocialComments(id, undefined, REPLIES_COMMENT_LIMIT, accountId),
                REPLIES_REQUEST_TIMEOUT_MS,
                `${id} comments`,
              ),
            ),
          );
          return [id, uniqueComments(responses.flatMap((response) => response.data ?? []))] as const;
        }),
      );

      const nextComments: Record<CommentPlatform, SocialComment[]> = {
        reddit: [],
        twitter: [],
        threads: [],
      };
      const failedPlatforms: string[] = [];

      results.forEach((result, index) => {
        const { id, label } = commentPlatforms[index];
        if (result.status === "fulfilled") {
          nextComments[id] = result.value[1];
          return;
        }
        failedPlatforms.push(label);
      });

      setCommentsByPlatform(nextComments);
      if (failedPlatforms.length > 0) {
        setError(`Could not load comments for ${failedPlatforms.join(", ")}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load replies");
      setCommentsByPlatform({
        reddit: [],
        twitter: [],
        threads: [],
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REPLIES_PLATFORM_STORAGE_KEY, platform);
  }, [platform]);

  useEffect(() => {
    setReplyPage(1);
  }, [platform, replyFilter]);

  const visiblePlatforms = useMemo(
    () => PLATFORMS.filter(({ id }) => configuredAccounts.some((account) => account.platform === id)),
    [configuredAccounts],
  );
  const platformAccounts = useMemo(
    () => configuredAccounts.filter((account) => account.platform === platform),
    [configuredAccounts, platform],
  );
  const comments = useMemo(() => (isCommentPlatform(platform) ? commentsByPlatform[platform] ?? [] : []), [commentsByPlatform, platform]);
  const replyFilterCounts = useMemo(() => {
    return comments.reduce(
      (counts, comment) => {
        counts.all += 1;
        counts[getReplyStatus(comment)] += 1;
        return counts;
      },
      { all: 0, new: 0, replied: 0 } as Record<ReplyFilter, number>,
    );
  }, [comments]);
  const visibleComments = useMemo(
    () => comments.filter((comment) => replyFilter === "all" || getReplyStatus(comment) === replyFilter),
    [comments, replyFilter],
  );
  const visibleThreads = useMemo(() => {
    const threadMap = new Map<string, ReplyThread>();
    visibleComments.forEach((comment) => {
      const key = getCommentThreadKey(comment);
      const existing = threadMap.get(key);
      if (existing) {
        existing.comments.push(comment);
        return;
      }
      threadMap.set(key, { key, post: comment, comments: [comment] });
    });
    return Array.from(threadMap.values());
  }, [visibleComments]);
  const totalReplyPages = Math.max(1, Math.ceil(visibleThreads.length / REPLIES_THREADS_PER_PAGE));
  const currentReplyPage = Math.min(replyPage, totalReplyPages);
  const paginatedThreads = useMemo(() => {
    const start = (currentReplyPage - 1) * REPLIES_THREADS_PER_PAGE;
    return visibleThreads.slice(start, start + REPLIES_THREADS_PER_PAGE);
  }, [currentReplyPage, visibleThreads]);
  const composerPlatform = composerComment?.platform ?? (isCommentPlatform(platform) ? platform : "threads");
  const composerReplyLimit = REPLY_LIMITS[composerPlatform];
  const composerContext = composerComment ? getCommentContext(composerComment) : null;
  const composerPlatformLabel = PLATFORMS.find((item) => item.id === composerPlatform)?.label ?? composerPlatform;
  const canAttachImage = attachmentSupported(composerPlatform);

  function closeComposer() {
    replyRequestIdRef.current += 1;
    setComposerComment(null);
    setComposerDraft("");
    setComposerError(null);
    setComposerAttachmentUrl(null);
    setSuggestingReply(false);
    setUploadingAttachment(false);
    setPostingReply(false);
  }

  async function openComposer(comment: SocialComment) {
    const targetId = getReplyTargetId(comment);
    if (!targetId) {
      setError("This comment does not have a valid reply target.");
      return;
    }

    const nextRequestId = replyRequestIdRef.current + 1;
    replyRequestIdRef.current = nextRequestId;
    setComposerComment(comment);
    setComposerDraft("");
    setComposerError(null);
    setComposerAttachmentUrl(null);
    setSuggestingReply(true);
    setUploadingAttachment(false);
    setPostingReply(false);

    try {
      const suggestion = await api.suggestSocialReply({
        platform: comment.platform,
        post_preview: comment.post_preview,
        post_title: comment.post_title,
        subreddit: comment.subreddit,
        commenter_username: comment.commenter_username,
        commenter_name: comment.commenter_name,
        comment_text: comment.text,
      });
      if (replyRequestIdRef.current !== nextRequestId) return;
      setComposerDraft(suggestion.reply_text ?? "");
    } catch (err) {
      if (replyRequestIdRef.current !== nextRequestId) return;
      setComposerError(err instanceof Error ? err.message : "Failed to generate reply");
    } finally {
      if (replyRequestIdRef.current === nextRequestId) {
        setSuggestingReply(false);
      }
    }
  }

  async function uploadReplyAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!canAttachImage) {
      setComposerError("Image attachments are available on Threads replies right now.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setComposerError("Please upload an image file.");
      return;
    }

    try {
      setUploadingAttachment(true);
      setComposerError(null);
      const uploaded = await api.uploadMedia(file);
      setComposerAttachmentUrl(uploaded.url);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function postReply() {
    if (!composerComment) return;

    const targetId = getReplyTargetId(composerComment);
    if (!targetId) {
      setComposerError("This comment does not have a valid reply target.");
      return;
    }

    const replyText = composerDraft.trim();
    if (!replyText) {
      setComposerError("Reply text is required.");
      return;
    }

    if (replyText.length > composerReplyLimit) {
      setComposerError(`Keep the reply under ${composerReplyLimit} characters for ${composerPlatformLabel}.`);
      return;
    }

    if (composerAttachmentUrl && !canAttachImage) {
      setComposerError("Image attachments are available on Threads replies right now.");
      return;
    }

    try {
      setPostingReply(true);
      setComposerError(null);
      let publishedReply:
        | { success: boolean; external_id: string; permalink?: string | null }
        | null = null;

      if (composerComment.platform === "threads") {
        publishedReply = await api.createThreadsReply(targetId, replyText, composerAttachmentUrl ?? undefined, composerComment.account_id);
      } else if (composerComment.platform === "twitter") {
        publishedReply = await api.createTwitterReply(targetId, replyText, composerComment.account_id);
      } else {
        publishedReply = await api.createRedditReply(targetId, replyText, composerComment.account_id);
      }

      const commentToUpdate = composerComment;
      const repliedAt = new Date().toISOString();
      setCommentsByPlatform((current) => ({
        ...current,
        [commentToUpdate.platform]: (current[commentToUpdate.platform] ?? []).map((item) => {
          if (item.external_id !== commentToUpdate.external_id) return item;
          return {
            ...item,
            reply_status: "replied",
            owner_reply_text: replyText,
            owner_replied_at: repliedAt,
            owner_reply_external_id: publishedReply?.external_id ?? item.owner_reply_external_id ?? null,
            owner_reply_permalink: publishedReply?.permalink ?? item.owner_reply_permalink ?? null,
          };
        }),
      }));

      closeComposer();
      await load();
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : "Failed to post reply");
      setPostingReply(false);
    }
  }

  function renderDiscussionNode(node: DiscussionNode, depth = 0) {
    const comment = node.comment;
    const replyTargetId = getReplyTargetId(comment);
    const replyStatus = getReplyStatus(comment);

    if (node.kind === "owner-reply") {
      return (
        <section
          className={`replies-card__thread-branch ${node.children.length > 0 ? "replies-card__thread-branch--has-children" : ""}`}
          key={node.id}
          style={{ "--reply-depth": depth } as CSSProperties}
        >
          <section className="replies-card__thread-item replies-card__thread-item--reply">
            <section className="social-thread-card__suggestion replies-card__owner-reply">
              <div className="replies-card__owner-reply-header">
                <strong>Your reply</strong>
                {comment.owner_replied_at ? <span>{formatDisplayDateTime(comment.owner_replied_at)}</span> : null}
                {comment.owner_reply_permalink ? (
                  <a className="replies-card__owner-reply-link" href={comment.owner_reply_permalink} target="_blank" rel="noreferrer">
                    Open reply
                  </a>
                ) : null}
              </div>
              <p>{comment.owner_reply_text}</p>
            </section>
          </section>
          {node.children.length > 0 ? (
            <div className="replies-card__thread-children">
              {node.children.map((child) => renderDiscussionNode(child, depth + 1))}
            </div>
          ) : null}
        </section>
      );
    }

    return (
      <section
        className={`replies-card__thread-branch ${node.children.length > 0 ? "replies-card__thread-branch--has-children" : ""}`}
        key={node.id}
        style={{ "--reply-depth": depth } as CSSProperties}
      >
        <section className="replies-card__thread-item replies-card__thread-item--comment">
          <section className="replies-card__comment-block">
            <div className="replies-card__comment-header">
              <div className="replies-card__comment-author-row">
                <strong>{getCommentAuthor(comment)}</strong>
                {comment.permalink ? (
                  <a href={comment.permalink} target="_blank" rel="noreferrer">
                    Open comment
                  </a>
                ) : null}
              </div>
              <div className="replies-card__comment-status-row">
                <span>{comment.commented_at ? formatDisplayDateTime(comment.commented_at) : "Unknown time"}</span>
                <span className={`social-status-pill replies-card__status replies-card__status--${replyStatus === "replied" ? "replied" : "new"}`}>
                  {replyStatus === "replied" ? "Replied" : "New"}
                </span>
              </div>
            </div>
            <p className="replies-card__comment-text">{comment.text || "No comment text returned."}</p>
            <div className="social-thread-card__meta replies-card__meta replies-card__comment-actions">
              <button
                type="button"
                className="button-secondary replies-card__reply-button"
                onClick={() => {
                  void openComposer(comment);
                }}
                disabled={!replyTargetId}
              >
                Reply
              </button>
            </div>
          </section>
        </section>
        {node.children.length > 0 ? (
          <div className="replies-card__thread-children">
            {node.children.map((child) => renderDiscussionNode(child, depth + 1))}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div className="replies-page stack">
      {error ? <p className="error panel">{error}</p> : null}

      <section className="panel replies-panel replies-overview">
        {visiblePlatforms.length > 0 ? (
          <div className="social-platform-bar replies-toolbar replies-overview__bar">
            <div className="ui-tabs__list social-platform-tabs">
              {visiblePlatforms.map((item) => (
                <button
                  key={item.id}
                  className={`ui-tab social-tab ${platform === item.id ? "ui-tab--active social-tab--active" : ""}`}
                  onClick={() => setPlatform(item.id)}
                  type="button"
                >
                  <item.Icon className={`social-tab__icon social-tab__icon--${item.id}`} aria-hidden="true" />
                  {item.label}
                  <span className="ui-tab__badge replies-tab__badge">{isCommentPlatform(item.id) ? commentsByPlatform[item.id].length : 0}</span>
                </button>
              ))}
            </div>

            <div className="social-platform-actions">
              <label className="replies-account-select">
                <span>Account</span>
                <select
                  value={selectedAccountByPlatform[platform] ?? ""}
                  onChange={(event) => {
                    const nextSelection = {
                      ...selectedAccountByPlatform,
                      [platform]: event.target.value,
                    };
                    setSelectedAccountByPlatform(nextSelection);
                    if (isCommentPlatform(platform)) {
                      setRefreshing(true);
                      void load(nextSelection);
                    }
                  }}
                  disabled={platformAccounts.length === 0 || !isCommentPlatform(platform)}
                >
                  <option value="">All connected accounts</option>
                  {platformAccounts.map((account) => (
                    <option key={`${account.platform}:${account.id}`} value={String(account.id)}>
                      {accountLabel(account)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button-secondary dashboard-icon-button"
                onClick={() => {
                  setRefreshing(true);
                  void load();
                }}
                disabled={refreshing}
                aria-label="Refresh replies"
                title="Refresh"
              >
                <ArrowPathIcon aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        ) : null}

        <div className="replies-overview__content">
          <div className="panel__title-row replies-panel__header">
            <div>
              <h2>Comments</h2>
              <p className="muted">Other people commenting under your published posts.</p>
            </div>
            <div className="replies-filter-tabs" aria-label="Filter comments by reply status">
              {(["all", "new", "replied"] as const).map((filter) => (
                <button
                  className={`replies-filter-tab ${replyFilter === filter ? "replies-filter-tab--active" : ""}`}
                  key={filter}
                  onClick={() => setReplyFilter(filter)}
                  type="button"
                >
                  <span>{filter === "all" ? "All" : filter === "new" ? "New" : "Replied"}</span>
                  <span className="replies-filter-tab__count">{replyFilterCounts[filter]}</span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="social-empty">Loading comments...</p>
          ) : visiblePlatforms.length === 0 ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">No social accounts in Config yet.</p>
              <p className="social-empty-card__copy">Connect an active social account in Config and replies will start showing here by platform.</p>
            </div>
          ) : !isCommentPlatform(platform) ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">Comments are not available for this platform yet.</p>
              <p className="social-empty-card__copy">The connected accounts are shown here, but reply inbox support is currently available for Twitter/X, Threads, and Reddit.</p>
            </div>
          ) : comments.length === 0 ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">No comments yet.</p>
              <p className="social-empty-card__copy">When people reply under your posts, they will show up here by platform.</p>
            </div>
          ) : visibleComments.length === 0 ? (
            <div className="social-empty-card">
              <p className="social-empty-card__title">No {replyFilter} comments.</p>
              <p className="social-empty-card__copy">Switch filters to see other comment statuses.</p>
            </div>
          ) : (
            <div className="replies-list">
              {paginatedThreads.map((thread, index) => {
                const context = getCommentContext(thread.post);
                const postMediaUrls = getDisplayPostImageUrls(thread.post.post_image_url);
                const isCollapsed = collapsedThreads[thread.key] ?? false;
                return (
                  <article className="social-thread-card replies-card" key={`${thread.key}-${index}`}>
                    <div className="replies-card__top-row">
                      {context || postMediaUrls.length > 0 ? (
                        <section className="social-thread-card__suggestion replies-card__post-block">
                          <strong>Your post</strong>
                          <div className="replies-card__post-content-row">
                            {postMediaUrls.length > 0 ? (
                              <div className="replies-card__post-media-grid">
                                {postMediaUrls.map((url, mediaIndex) => {
                                  const isVideo = isVideoMediaUrl(url);
                                  return (
                                    <button
                                      className="replies-card__post-media-button"
                                      key={`${url}-${mediaIndex}`}
                                      type="button"
                                      onClick={() => setMediaViewerUrl(url)}
                                      aria-label={`Open post ${isVideo ? "video" : "image"} ${mediaIndex + 1}`}
                                    >
                                      {isVideo ? (
                                        <video className="replies-card__post-media" src={url} muted playsInline preload="metadata" />
                                      ) : (
                                        <img className="replies-card__post-media" src={url} alt={`Post media ${mediaIndex + 1}`} loading="lazy" />
                                      )}
                                      {isVideo ? <span className="replies-card__post-media-type">Video</span> : null}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                            {context ? <p className="replies-card__post-text">{context}</p> : null}
                          </div>
                        </section>
                      ) : null}

                      <div className="social-thread-card__header replies-card__header">
                        <div className="replies-card__header-side">
                          <button
                            className="button-secondary dashboard-icon-button replies-card__collapse-button"
                            type="button"
                            onClick={() => {
                              setCollapsedThreads((current) => ({
                                ...current,
                                [thread.key]: !(current[thread.key] ?? false),
                              }));
                            }}
                            aria-expanded={!isCollapsed}
                            aria-label={isCollapsed ? "Expand thread" : "Hide thread"}
                            title={isCollapsed ? "Expand" : "Hide"}
                          >
                            {isCollapsed ? <ChevronDownIcon aria-hidden="true" /> : <ChevronUpIcon aria-hidden="true" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="replies-card__thread-items" hidden={isCollapsed}>
                      {buildDiscussionTree(thread.comments).map((node) => renderDiscussionNode(node))}
                    </div>
                  </article>
                );
              })}
              {visibleThreads.length > REPLIES_THREADS_PER_PAGE ? (
                <div className="replies-pagination" aria-label="Replies pagination">
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => setReplyPage((current) => Math.max(1, current - 1))}
                    disabled={currentReplyPage <= 1}
                  >
                    Previous
                  </button>
                  <span>
                    Page {currentReplyPage} of {totalReplyPages}
                  </span>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => setReplyPage((current) => Math.min(totalReplyPages, current + 1))}
                    disabled={currentReplyPage >= totalReplyPages}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {mediaViewerUrl ? (
        <div className="replies-media-viewer">
          <div className="replies-media-viewer__dialog" onClick={(event) => event.stopPropagation()}>
            <ModalCloseButton className="replies-media-viewer__close" onClick={() => setMediaViewerUrl(null)} />
            {isVideoMediaUrl(mediaViewerUrl) ? (
              <video className="replies-media-viewer__asset" src={mediaViewerUrl} controls autoPlay playsInline />
            ) : (
              <img className="replies-media-viewer__asset" src={mediaViewerUrl} alt="Post media preview" />
            )}
          </div>
        </div>
      ) : null}

      {composerComment ? (
        <div className="replies-compose-backdrop">
          <div className="replies-compose-modal panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel__title-row">
              <div>
                <h2>Auto reply</h2>
                <p className="muted">AI draft for {composerPlatformLabel}. Edit it before posting.</p>
              </div>
              <ModalCloseButton onClick={closeComposer} disabled={postingReply} />
            </div>

            <div className="replies-compose__context-grid">
              {composerContext ? (
                <section className="replies-compose__context-card">
                  <span className="replies-compose__context-label">Your post</span>
                  <p>{composerContext}</p>
                </section>
              ) : null}
              <section className="replies-compose__context-card">
                <span className="replies-compose__context-label">Incoming comment</span>
                <p className="replies-compose__context-author">{getCommentAuthor(composerComment)}</p>
                <p>{composerComment.text || "No comment text returned."}</p>
              </section>
            </div>

            <label className="replies-compose__field">
              <span>Reply</span>
              <textarea
                rows={6}
                value={composerDraft}
                onChange={(event) => setComposerDraft(event.target.value)}
                placeholder={suggestingReply ? "Generating AI reply..." : "Write your reply"}
                disabled={postingReply || suggestingReply}
                maxLength={composerReplyLimit}
              />
            </label>

            <div className="replies-compose__media stack">
              <div className="replies-compose__media-header">
                <div>
                  <p className="replies-compose__media-label">Attachment</p>
                  <p className="replies-compose__media-hint">
                    {canAttachImage
                      ? "Attach one image if you want to reply with visual context."
                      : "Image replies are available on Threads right now."}
                  </p>
                </div>
                <label className={`button-secondary replies-compose__upload ${canAttachImage ? "" : "is-disabled"}`}>
                  <input
                    accept="image/*"
                    type="file"
                    onChange={(event) => {
                      void uploadReplyAttachment(event);
                    }}
                    disabled={!canAttachImage || postingReply || uploadingAttachment}
                  />
                  {uploadingAttachment ? "Uploading..." : composerAttachmentUrl ? "Replace image" : "Attach image"}
                </label>
              </div>

              {composerAttachmentUrl ? (
                <div className="replies-compose__media-card">
                  <button
                    className="replies-compose__media-remove"
                    type="button"
                    onClick={() => setComposerAttachmentUrl(null)}
                    disabled={postingReply}
                  >
                    Remove
                  </button>
                  <img src={normalizeDashboardMediaUrl(composerAttachmentUrl)} alt="Reply attachment preview" className="replies-compose__media-preview" />
                </div>
              ) : (
                <p className="replies-compose__media-empty">
                  {canAttachImage ? "No image attached." : "Use a Threads comment when you want to attach an image."}
                </p>
              )}
            </div>

            <div className="replies-compose__footer">
              <span className="replies-compose__count">
                {composerDraft.length}/{composerReplyLimit}
              </span>
              {composerError ? <p className="replies-compose__error">{composerError}</p> : null}
            </div>

            <div className="replies-compose__actions">
              <button className="button-secondary" type="button" onClick={closeComposer} disabled={postingReply}>
                Cancel
              </button>
              <button type="button" onClick={() => void postReply()} disabled={postingReply || suggestingReply}>
                {postingReply ? "Posting..." : "Post"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
