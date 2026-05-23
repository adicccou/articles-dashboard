import { useState } from "react";
import type { DashboardSurface } from "../lib/surface";

type LoginCardProps = {
  surface?: DashboardSurface;
  onSubmit: (username: string, password: string, remember: boolean) => Promise<void>;
};

export function LoginCard({ surface = "marketing", onSubmit }: LoginCardProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(username, password, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card">
      <p className="eyebrow">{surface === "trading" ? "Trading System" : "Marketing System"}</p>
      <h1>{surface === "trading" ? "Trading Dashboard" : "Marketing Dashboard"}</h1>
      <p className="muted">
        {surface === "trading"
          ? "Sign in to manage trading workers, AI settings, platform access, and agent sync."
          : "Sign in to manage articles, social agents, Studio campaigns, scheduling, and statistics."}
      </p>
      <form className="stack" onSubmit={handleSubmit}>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: "8px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Keep me signed in for 7 days
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
