import { useEffect, useMemo, useRef, useState } from "react";
import type { ArticleInput, ArticleRecord, Site, ArticleCategory } from "../lib/types";
import { slugify } from "../lib/slug";

type ArticleEditorProps = {
  article?: ArticleRecord;
  sites: Site[];
  categories: ArticleCategory[];
  onSave: (payload: ArticleInput, id?: number) => Promise<void>;
  onUpload: (file: File) => Promise<{ key: string; url: string }>;
  onCancel?: () => void;
};

function toInitialState(article?: ArticleRecord): ArticleInput {
  return (
    article ?? {
      title: "",
      slug: "",
      excerpt: "",
      content: "",
      cover_image: null,
      status: "draft",
      published_at: null,
      category_id: null,
      site_ids: [],
      seo: {
        meta_title: "",
        meta_description: "",
        og_image: "",
        canonical_url: "",
      },
    }
  );
}

const fontSizeMap: Record<string, string> = {
  sm: "0.9rem",
  base: "1rem",
  lg: "1.125rem",
  xl: "1.35rem",
  "2xl": "1.7rem",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeContentForEditor(value: string): string {
  if (!value.trim()) return "";
  if (/<\/?[a-z][\s\S]*>/i.test(value)) {
    return value;
  }

  return value
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function ArticleEditor({ article, sites, categories, onSave, onUpload, onCancel }: ArticleEditorProps) {
  const [form, setForm] = useState<ArticleInput>(() => toInitialState(article));
  const [categoryText, setCategoryText] = useState(() => article?.category?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const selectedSites = useMemo(() => new Set(form.site_ids), [form.site_ids]);

  useEffect(() => {
    setForm(toInitialState(article));
    setCategoryText(article?.category?.name ?? "");
    setError(null);
  }, [article]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const normalized = normalizeContentForEditor(form.content);
    if (editor.innerHTML !== normalized) {
      editor.innerHTML = normalized;
    }
  }, [form.content]);

  useEffect(() => {
    document.execCommand("styleWithCSS", false, "true");
  }, []);

  function update<K extends keyof ArticleInput>(key: K, value: ArticleInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateSeo<K extends keyof ArticleInput["seo"]>(
    key: K,
    value: ArticleInput["seo"][K],
  ) {
    setForm((current) => ({
      ...current,
      seo: {
        ...current.seo,
        [key]: value,
      },
    }));
  }

  function syncEditorContent() {
    const editor = editorRef.current;
    if (!editor) return;
    update("content", editor.innerHTML);
  }

  function focusEditor() {
    editorRef.current?.focus();
  }

  function applyEditorCommand(command: string, value?: string) {
    focusEditor();
    document.execCommand(command, false, value);
    syncEditorContent();
  }

  function applyBlock(block: "p" | "h1" | "h2" | "h3" | "blockquote") {
    applyEditorCommand("formatBlock", block);
  }

  function applyFontSize(sizeKey: keyof typeof fontSizeMap) {
    focusEditor();
    document.execCommand("fontSize", false, "7");
    const editor = editorRef.current;
    if (editor) {
      editor.querySelectorAll('font[size="7"]').forEach((node) => {
        const span = document.createElement("span");
        span.style.fontSize = fontSizeMap[sizeKey];
        span.innerHTML = node.innerHTML;
        node.replaceWith(span);
      });
    }
    syncEditorContent();
  }

  function createLink() {
    const url = window.prompt("Enter link URL");
    if (!url) return;
    applyEditorCommand("createLink", url);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await onUpload(file);
      update("cover_image", uploaded.url);
      if (!form.seo.og_image) {
        updateSeo("og_image", uploaded.url);
      }
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleOgFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await onUpload(file);
      updateSeo("og_image", uploaded.url);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>, status: "draft" | "published") {
    event.preventDefault();
    if (form.site_ids.length === 0) {
      setError("Select at least one site before saving.");
      return;
    }
    const editorText = editorRef.current?.textContent?.trim() ?? "";
    if (!editorText) {
      setError("Add article content before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const now = status === "published" ? new Date().toISOString() : null;
      const slug = form.slug || slugify(form.title);
      await onSave(
        {
          ...form,
          slug,
          status,
          published_at: now,
          seo: {
            ...form.seo,
            meta_title: form.seo.meta_title || form.title,
            canonical_url: form.seo.canonical_url || `https://journl.day/articles/${slug}`,
          },
        },
        article?.id,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save article");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack article-editor" onSubmit={(e) => handleSubmit(e, "draft")}>
      <section className="panel stack">
        <div className="panel__title-row">
          <h2>{article ? "Edit Article" : "New Article"}</h2>
          <div className="actions">
            {onCancel && (
              <button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>
                Cancel
              </button>
            )}
            <button type="submit" disabled={busy}>
              {busy ? "Saving..." : "Save draft"}
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => {
                const syntheticEvent = {
                  preventDefault() {},
                } as React.FormEvent<HTMLFormElement>;
                void handleSubmit(syntheticEvent, "published");
              }}
            >
              Publish
            </button>
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <label>
          Title
          <input
            value={form.title}
            onChange={(e) => {
              const title = e.target.value;
              setForm((current) => ({
                ...current,
                title,
                slug: current.slug ? current.slug : slugify(title),
                seo: {
                  ...current.seo,
                  meta_title: current.seo.meta_title || title,
                },
              }));
            }}
            placeholder="How to build a syndication workflow"
            required
          />
        </label>
        <div className="grid-two">
          <label>
            Slug
            <input
              value={form.slug}
              onChange={(e) => update("slug", slugify(e.target.value))}
              placeholder="how-to-build-a-syndication-workflow"
              required
            />
          </label>
          <label>
            Category
            <input
              list="category-options"
              value={categoryText}
              onChange={(e) => {
                const text = e.target.value;
                setCategoryText(text);
                const match = categories.find(
                  (c) => c.name.toLowerCase() === text.trim().toLowerCase(),
                );
                update("category_id", match?.id ?? null);
              }}
              placeholder="e.g. Technology"
            />
            <datalist id="category-options">
              {categories.map((cat) => (
                <option key={cat.id} value={cat.name} />
              ))}
            </datalist>
          </label>
        </div>
        <label>
          Excerpt
          <textarea
            value={form.excerpt}
            onChange={(e) => update("excerpt", e.target.value)}
            rows={3}
            placeholder="A short teaser used in lists and SEO descriptions."
          />
        </label>
        <label>
          Content
          <div className="article-editor__surface">
            <div className="article-editor__toolbar" role="toolbar" aria-label="Content formatting">
              <select
                className="article-editor__select"
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value as "p" | "h1" | "h2" | "h3" | "blockquote" | "";
                  if (value) {
                    applyBlock(value);
                    event.target.value = "";
                  }
                }}
              >
                <option value="">Paragraph style</option>
                <option value="p">Paragraph</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="blockquote">Quote</option>
              </select>
              <select
                className="article-editor__select"
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value as keyof typeof fontSizeMap | "";
                  if (value) {
                    applyFontSize(value);
                    event.target.value = "";
                  }
                }}
              >
                <option value="">Font size</option>
                <option value="sm">Small</option>
                <option value="base">Base</option>
                <option value="lg">Large</option>
                <option value="xl">XL</option>
                <option value="2xl">2XL</option>
              </select>
              <button type="button" className="button-secondary" onClick={() => applyEditorCommand("bold")}>
                Bold
              </button>
              <button type="button" className="button-secondary" onClick={() => applyEditorCommand("italic")}>
                Italic
              </button>
              <button type="button" className="button-secondary" onClick={() => applyEditorCommand("underline")}>
                Underline
              </button>
              <button type="button" className="button-secondary" onClick={() => applyEditorCommand("insertUnorderedList")}>
                Bullets
              </button>
              <button type="button" className="button-secondary" onClick={() => applyEditorCommand("insertOrderedList")}>
                Numbers
              </button>
              <button type="button" className="button-secondary" onClick={createLink}>
                Link
              </button>
              <label className="article-editor__color-control">
                <span>Text</span>
                <input type="color" defaultValue="#0f172a" onChange={(event) => applyEditorCommand("foreColor", event.target.value)} />
              </label>
              <label className="article-editor__color-control">
                <span>Highlight</span>
                <input type="color" defaultValue="#fef08a" onChange={(event) => applyEditorCommand("hiliteColor", event.target.value)} />
              </label>
              <button type="button" className="button-secondary" onClick={() => applyEditorCommand("removeFormat")}>
                Clear
              </button>
            </div>
            <div
              ref={editorRef}
              className="article-editor__content"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Write your article here with rich formatting."
              onInput={syncEditorContent}
              onBlur={syncEditorContent}
            />
          </div>
          <small className="article-editor__hint">Formatting is saved as rich HTML content.</small>
        </label>
      </section>

      <section className="panel stack">
        <div className="panel__title-row">
          <h2>Sites & Publishing</h2>
        </div>
        <div className="chip-grid">
          {sites.map((site) => (
            <label key={site.id} className={`chip ${selectedSites.has(site.id) ? "chip--selected" : ""}`}>
              <input
                type="checkbox"
                checked={selectedSites.has(site.id)}
                onChange={(e) => {
                  setForm((current) => ({
                    ...current,
                    site_ids: e.target.checked
                      ? [...current.site_ids, site.id]
                      : current.site_ids.filter((id) => id !== site.id),
                  }));
                }}
              />
              <span>{site.name}</span>
              <small>{site.slug}</small>
            </label>
          ))}
        </div>
        <div className="grid-two">
          <label>
            Cover image
            <input type="file" accept="image/*" onChange={handleFileChange} />
          </label>
          <label>
            Current image URL
            <input
              value={form.cover_image ?? ""}
              onChange={(e) => update("cover_image", e.target.value || null)}
              placeholder="https://..."
            />
          </label>
        </div>
        {uploading ? <p className="muted">Uploading image...</p> : null}
        {form.cover_image ? <img className="cover-preview" src={form.cover_image} alt="" /> : null}
      </section>

      <section className="panel stack">
        <div className="panel__title-row">
          <h2>SEO</h2>
        </div>
        <label>
          Meta title
          <input
            value={form.seo.meta_title}
            onChange={(e) => updateSeo("meta_title", e.target.value)}
            placeholder="SEO title"
          />
        </label>
        <label>
          Meta description
          <textarea
            value={form.seo.meta_description}
            onChange={(e) => updateSeo("meta_description", e.target.value)}
            rows={3}
          />
        </label>
        <div className="grid-two">
          <label>
            OG image upload
            <input type="file" accept="image/*" onChange={handleOgFileChange} />
          </label>
          <div />
        </div>
      </section>
    </form>
  );
}
