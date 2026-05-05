import { useEffect, useState } from "react";
import type { KnowledgeBase, KnowledgeBaseVersion } from "../lib/types";
import { api } from "../lib/api";
import "../styles/knowledge-base-editor.css";

interface KnowledgeBaseEditorProps {
  type: "reddit_campaign" | "trading_strategy" | "social_platform";
  entityId: number;
  onSaved?: () => void;
}

export function KnowledgeBaseEditor({ type, entityId, onSaved }: KnowledgeBaseEditorProps) {
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [versions, setVersions] = useState<KnowledgeBaseVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadKnowledgeBase() {
    try {
      setLoading(true);
      const data = await api.getKnowledgeBase(type, entityId);
      setKb(data);
      setTitle(data.title || "");
      setContent(data.content || "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  }

  async function loadVersions() {
    try {
      const data = await api.getKnowledgeBaseVersions(type, entityId);
      setVersions(data);
    } catch {
      // non-critical — version history is optional UI
    }
  }

  useEffect(() => {
    void loadKnowledgeBase();
  }, [type, entityId]);

  const handleEdit = () => {
    void loadVersions();
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      await api.saveKnowledgeBase(type, entityId, title || "Knowledge Base", content, changeSummary || undefined);
      setIsEditing(false);
      setChangeSummary("");
      await loadKnowledgeBase();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save knowledge base");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadVersion = async (version: number) => {
    try {
      setLoading(true);
      const versionData = await api.getKnowledgeBaseVersion(type, entityId, version);
      setContent(versionData.content);
      setChangeSummary(`Restored from version ${version}`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load version");
    } finally {
      setLoading(false);
    }
  };

  if (loading && !kb) {
    return <div className="kb-editor loading">Loading knowledge base...</div>;
  }

  return (
    <div className="kb-editor">
      {error && <div className="kb-editor__error">{error}</div>}

      {!isEditing ? (
        <div className="kb-editor__view">
          <div className="kb-editor__header">
            <h3>{kb?.title || "Knowledge Base"}</h3>
            <div className="kb-editor__actions">
              <button onClick={handleEdit} className="btn btn-primary">
                Edit
              </button>
            </div>
          </div>
          {kb?.content ? (
            <div className="kb-editor__content">
              <pre className="kb-editor__preview">{kb.content}</pre>
              <div className="kb-editor__meta">
                Version {kb.version || 1} • Updated {formatDate(kb.updated_at || "")}
              </div>
            </div>
          ) : (
            <div className="kb-editor__empty">
              <p>No knowledge base created yet</p>
              <button onClick={handleEdit} className="btn btn-primary">
                Create Knowledge Base
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="kb-editor__form">
          <div className="kb-editor__header">
            <h3>Edit Knowledge Base</h3>
            <div className="kb-editor__actions">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="btn btn-secondary"
              >
                {showPreview ? "Editor" : "Preview"}
              </button>
            </div>
          </div>

          <div className="kb-editor__input-group">
            <label htmlFor="kb-title">Title</label>
            <input
              id="kb-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Knowledge base title"
              className="kb-editor__input"
            />
          </div>

          <div className="kb-editor__input-group">
            <label htmlFor="kb-content">
              Content
              <span className="kb-editor__char-count">{content.length} characters</span>
            </label>
            {showPreview ? (
              <pre className="kb-editor__preview">{content}</pre>
            ) : (
              <textarea
                id="kb-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Enter knowledge base content (supports Markdown)"
                className="kb-editor__textarea"
                rows={12}
              />
            )}
          </div>

          <div className="kb-editor__input-group">
            <label htmlFor="kb-summary">Change Summary (optional)</label>
            <input
              id="kb-summary"
              type="text"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              placeholder="What changed in this version?"
              className="kb-editor__input"
            />
          </div>

          {versions.length > 0 && (
            <div className="kb-editor__versions">
              <label>Version History</label>
              <div className="kb-editor__version-list">
                {versions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => handleLoadVersion(v.version)}
                    className="kb-editor__version-item"
                  >
                    <span className="kb-editor__version-number">v{v.version}</span>
                    {v.change_summary && (
                      <span className="kb-editor__version-summary">{v.change_summary}</span>
                    )}
                    <span className="kb-editor__version-date">{formatDate(v.created_at)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="kb-editor__buttons">
            <button onClick={handleSave} disabled={loading} className="btn btn-primary">
              {loading ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                setChangeSummary("");
                setShowPreview(false);
              }}
              disabled={loading}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(date: string): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
