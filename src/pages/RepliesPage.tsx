import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { api } from "../lib/api";
import type { SocialComment } from "../lib/types";
import { formatDisplayDateTime } from "../lib/datetime";
import "../styles/replies-page.css";

type Platform = "reddit" | "twitter" | "threads";

const REPLIES_PLATFORM_STORAGE_KEY = "dashboard:replies-platform";
const REPLY_LIMITS: Record<Platform, number> = {
  reddit: 1000,
  twitter: 280,
  threads: 500,
};
const PLATFORMS: Array<{ id: Platform; label: string; icon: string }> = [
  { id: "reddit", label: "Reddit", icon: "🟠" },
  { id: "twitter", label: "Twitter", icon: "𝕏" },
  { id: "threads", label: "Threads", icon: "🧵" },
];

function readStoredPlatform(): Platform {
  if (typeof window === "undefined") return "threads";
  const stored = window.localStorage.getItem(REPLIES_PLATFORM_STORAGE_KEY);
  return PLATFORMS.some((platform) => platform.id === stored) ? (stored as Platform) : "threads";
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

function attachmentSupported(platform: Platform): boolean {
  return platform === "threads";
}

export function RepliesPage() {
  const [platform, setPlatform] = useState<Platform>(readStoredPlatform);
  const [commentsByPlatform, setCommentsByPlatform] = useState<Record<Platform, SocialComment[]>>({
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
  const replyRequestIdRef = useRef(0);

  async function load() {
    try {
      setError(null);
      const results = await Promise.allSettled(
        PLATFORMS.map(async ({ id }) => [id, await api.listSocialComments(id, undefined, 30)] as const),
      );

      const nextComments: Record<Platform, SocialComment[]> = {
        reddit: [],
        twitter: [],
        threads: [],
      };
      const failedPlatforms: string[] = [];

      results.forEach((result, index) => {
        const { id, label } = PLATFORMS[index];
        if (result.status === "fulfilled") {
          nextComments[id] = result.value[1].data ?? [];
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

  const comments = useMemo(() => commentsByPlatform[platform] ?? [], [commentsByPlatform, platform]);
  const composerPlatform = composerComment?.platform ?? platform;
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
        | { success: boolean; external_id: string }
        | { success: boolean; external_id: string; account_id: number }
        | null = null;

      if (composerComment.platform === "threads") {
        publishedReply = await api.createThreadsReply(targetId, replyText, composerAttachmentUrl ?? undefined);
      } else if (composerComment.platform === "twitter") {
        publishedReply = await api.createTwitterReply(targetId, replyText);
      } else {
        publishedReply = await api.createRedditReply(targetId, replyText);
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

  return (
    <div className="replies-page stack">
      {error ? <p className="error panel">{error}</p> : null}

      <div className="social-platform-bar replies-toolbar">
        <div className="ui-tabs__list social-platform-tabs">
          {PLATFORMS.map((item) => (
            <button
              key={item.id}
              className={`ui-tab social-tab ${platform === item.id ? "ui-tab--active social-tab--active" : ""}`}
              onClick={() => setPlatform(item.id)}
              type="button"
            >
              <span className="social-tab__icon">{item.icon}</span>
              {item.label}
              <span className="ui-tab__badge replies-tab__badge">{commentsByPlatform[item.id].length}</span>
            </button>
          ))}
        </div>

        <div className="social-platform-actions">
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <section className="panel replies-panel">
        <div className="panel__title-row replies-panel__header">
          <div>
            <h2>Comments</h2>
            <p className="muted">Other people commenting under your published posts.</p>
          </div>
          <span className="social-status-pill social-status-pill--neutral">{comments.length}</span>
        </div>

        {loading ? (
          <p className="social-empty">Loading comments...</p>
        ) : comments.length === 0 ? (
          <div className="social-empty-card">
            <p className="social-empty-card__title">No comments yet.</p>
            <p className="social-empty-card__copy">When people reply under your posts, they will show up here by platform.</p>
          </div>
        ) : (
          <div className="replies-list">
            {comments.map((comment, index) => {
              const context = getCommentContext(comment);
              const replyTargetId = getReplyTargetId(comment);
              const replyStatus = getReplyStatus(comment);
              return (
                <article className="social-thread-card replies-card" key={`${comment.platform}-${comment.external_id ?? index}`}>
                  <div className="social-thread-card__header replies-card__header">
                    <div className="replies-card__header-main">
                      <strong>{getCommentAuthor(comment)}</strong>
                      {comment.permalink ? (
                        <a href={comment.permalink} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : null}
                    </div>
                    <div className="replies-card__header-side">
                      <span>{comment.commented_at ? formatDisplayDateTime(comment.commented_at) : "Unknown time"}</span>
                      <span
                        className={`social-status-pill replies-card__status replies-card__status--${replyStatus === "replied" ? "replied" : "new"}`}
                      >
                        {replyStatus === "replied" ? "Replied" : "New"}
                      </span>
                    </div>
                  </div>

                  {context ? <p className="replies-card__context">{context}</p> : null}
                  <p>{comment.text || "No comment text returned."}</p>

                  {comment.owner_reply_text ? (
                    <section className="social-thread-card__suggestion replies-card__owner-reply">
                      <div className="replies-card__owner-reply-header">
                        <strong>Your reply</strong>
                        {comment.owner_replied_at ? <span>{formatDisplayDateTime(comment.owner_replied_at)}</span> : null}
                      </div>
                      <p>{comment.owner_reply_text}</p>
                    </section>
                  ) : null}

                  <div className="social-thread-card__meta replies-card__meta">
                    <button
                      type="button"
                      className="button-secondary replies-card__reply-button"
                      onClick={() => {
                        void openComposer(comment);
                      }}
                      disabled={!replyTargetId}
                    >
                      Auto reply
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {composerComment ? (
        <div className="replies-compose-backdrop" onClick={closeComposer}>
          <div className="replies-compose-modal panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel__title-row">
              <div>
                <h2>Auto reply</h2>
                <p className="muted">AI draft for {composerPlatformLabel}. Edit it before posting.</p>
              </div>
              <button className="button-secondary" type="button" onClick={closeComposer} disabled={postingReply}>
                Close
              </button>
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
                  <img src={composerAttachmentUrl} alt="Reply attachment preview" className="replies-compose__media-preview" />
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
