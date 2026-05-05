import { useEffect, useState } from "react";
import type { SocialAccount, SocialPost, AppSettings } from "../lib/types";
import { api } from "../lib/api";
import { asArray } from "../lib/collections";

type Tab = "posts" | "accounts" | "credentials";

function CredentialRow({ label, saved, onSave }: { label: string; saved: boolean; onSave: (v: string) => void }) {
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
      <div style={{ width: 180, fontSize: 13, color: "var(--text-soft)", flexShrink: 0 }}>{label}</div>
      <input
        type="password"
        placeholder={saved ? "••••••••  (saved)" : "Enter value…"}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, background: "var(--surface)" }}
      />
      <button
        disabled={!val.trim() || saving}
        onClick={async () => {
          setSaving(true);
          try { onSave(val.trim()); setVal(""); } finally { setSaving(false); }
        }}
        style={{ padding: "6px 14px", fontSize: 13 }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {saved && <span style={{ fontSize: 12, color: "#16a34a" }}>✓</span>}
    </div>
  );
}

export function TwitterAgentPage() {
  const [tab, setTab] = useState<Tab>("posts");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [newPost, setNewPost] = useState("");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [postsData, accountsData, settingsData] = await Promise.all([
        api.listSocialPosts("twitter"),
        api.listTwitterAccounts(),
        api.getSettings(),
      ]);
      setPosts(asArray<SocialPost>(postsData));
      setAccounts(asArray<SocialAccount>(accountsData));
      setSettings(settingsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const isConnected = Boolean(settings?.twitter_api_key_saved && settings?.twitter_access_token_saved);

  const TABS: { id: Tab; label: string }[] = [
    { id: "posts", label: "Post Queue" },
    { id: "accounts", label: `Accounts (${accounts.length})` },
    { id: "credentials", label: "Credentials" },
  ];

  return (
    <div className="stack">
      {error && <p className="error panel">{error}</p>}

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: "none",
              border: "none",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === t.id ? "var(--accent)" : "var(--text-soft)",
              cursor: "pointer",
              borderRadius: 0,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Connection status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: isConnected ? "#22c55e" : "#f59e0b", display: "inline-block" }} />
        <span style={{ fontSize: 13, color: "var(--text-soft)" }}>
          {isConnected ? "Twitter/X connected — ready to post" : "API credentials not configured — see Credentials tab"}
        </span>
      </div>

      {/* POST QUEUE TAB */}
      {tab === "posts" && (
        <section className="panel">
          <div className="panel__title-row">
            <h2>𝕏 Post Queue</h2>
          </div>

          {/* New post */}
          <div style={{ marginBottom: 20 }}>
            <textarea
              placeholder="Write a tweet… (max 280 chars)"
              value={newPost}
              onChange={(e) => setNewPost(e.target.value.slice(0, 280))}
              rows={3}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, resize: "vertical", background: "var(--surface)" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <span style={{ fontSize: 12, color: newPost.length > 260 ? "#ef4444" : "var(--text-soft)" }}>
                {newPost.length}/280
              </span>
              <button
                disabled={!newPost.trim() || adding}
                onClick={async () => {
                  setAdding(true);
                  try {
                    await api.createSocialPost("twitter", newPost.trim());
                    setNewPost("");
                    await load();
                  } finally { setAdding(false); }
                }}
              >
                {adding ? "Adding…" : "Add to Queue"}
              </button>
            </div>
          </div>

          {loading ? (
            <p style={{ color: "var(--text-soft)", padding: 16 }}>Loading…</p>
          ) : posts.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--text-soft)" }}>
              <p>No posts yet.</p>
              <p style={{ fontSize: 13, marginTop: 8 }}>
                Write a tweet above, or plan posts via your Telegram bot.
              </p>
            </div>
          ) : (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Content</span>
                <span>Status</span>
                <span>Scheduled</span>
                <span>Actions</span>
              </div>
              {posts.map((post) => (
                <div className="table__row" key={post.id}>
                  <span className="truncate" style={{ maxWidth: 300 }}>{post.content}</span>
                  <span>
                    <span style={{
                      padding: "3px 8px", borderRadius: 4, fontSize: 12,
                      background: post.status === "posted" ? "#dcfce7" : post.status === "scheduled" ? "#dbeafe" : "#f3f4f6",
                      color: post.status === "posted" ? "#166534" : post.status === "scheduled" ? "#1d4ed8" : "#6b7280",
                    }}>
                      {post.status}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-soft)" }}>
                    {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : "—"}
                  </span>
                  <span>
                    <button
                      onClick={async () => {
                        await api.deleteSocialPost(post.id);
                        await load();
                      }}
                      style={{ fontSize: 12, padding: "3px 8px", background: "none", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 4, cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ACCOUNTS TAB */}
      {tab === "accounts" && (
        <section className="panel">
          <div className="panel__title-row">
            <h2>𝕏 Connected Accounts</h2>
          </div>
          {accounts.length === 0 ? (
            <p style={{ color: "var(--text-soft)", padding: 16 }}>
              No accounts added. Connect your Twitter credentials in the Credentials tab.
            </p>
          ) : (
            <div className="table">
              <div className="table__row table__row--header">
                <span>Username</span>
                <span>Status</span>
                <span>Added</span>
                <span>Actions</span>
              </div>
              {accounts.map((acc) => (
                <div className="table__row" key={acc.id}>
                  <span>@{acc.username}</span>
                  <span>
                    <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 12, background: "#dcfce7", color: "#166534" }}>
                      {acc.status}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-soft)" }}>
                    {new Date(acc.created_at).toLocaleDateString()}
                  </span>
                  <span>
                    <button
                      onClick={async () => { await api.deleteTwitterAccount(acc.id); await load(); }}
                      style={{ fontSize: 12, padding: "3px 8px", background: "none", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 4, cursor: "pointer" }}
                    >
                      Remove
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* CREDENTIALS TAB */}
      {tab === "credentials" && (
        <section className="panel">
          <div className="panel__title-row">
            <h2>𝕏 API Credentials</h2>
          </div>
          <p style={{ color: "var(--text-soft)", fontSize: 13, marginBottom: 20 }}>
            Enter your Twitter/X API credentials. You need a developer account at{" "}
            <a href="https://developer.twitter.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              developer.twitter.com
            </a>
            . Basic tier (~$100/month) or Free tier works for limited posting.
          </p>
          <CredentialRow
            label="API Key"
            saved={Boolean(settings?.twitter_api_key_saved)}
            onSave={(v) => api.updateSettings({ twitter_api_key: v }).then(load)}
          />
          <CredentialRow
            label="API Secret"
            saved={Boolean(settings?.twitter_api_secret_saved)}
            onSave={(v) => api.updateSettings({ twitter_api_secret: v }).then(load)}
          />
          <CredentialRow
            label="Access Token"
            saved={Boolean(settings?.twitter_access_token_saved)}
            onSave={(v) => api.updateSettings({ twitter_access_token: v }).then(load)}
          />
          <CredentialRow
            label="Access Secret"
            saved={Boolean(settings?.twitter_access_secret_saved)}
            onSave={(v) => api.updateSettings({ twitter_access_secret: v }).then(load)}
          />
          <div style={{ marginTop: 16, padding: 12, background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, color: "var(--text-soft)" }}>
            💡 The trading agent on your DigitalOcean droplet uses these credentials to post tweets automatically after your Telegram approval.
          </div>
        </section>
      )}
    </div>
  );
}
