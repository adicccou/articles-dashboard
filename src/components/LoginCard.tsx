import { useState } from "react";
import { FcGoogle } from "react-icons/fc";
import logoMark from "../assets/my-logo.svg";
import type { DashboardSurface } from "../lib/surface";

type LoginCardProps = {
  surface?: DashboardSurface;
  mode?: "google" | "fallback";
  googleAuthConfigured?: boolean;
  notice?: string | null;
  onSubmit: (username: string, password: string, remember: boolean) => Promise<void>;
};

export function LoginCard({
  surface = "marketing",
  mode = "google",
  googleAuthConfigured = true,
  notice,
  onSubmit,
}: LoginCardProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFallbackMode = mode === "fallback";
  const dashboardLabel = surface === "trading" ? "Trading Dashboard" : "Marketing Dashboard";

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

  function handleGoogleLogin() {
    window.location.href = "/api/auth/google/authorize";
  }

  return (
    <div className={`login-card login-card--${isFallbackMode ? "fallback" : "google"}`}>
      <div className="login-card__brand">
        <img src={logoMark} alt="Oilor Studio" />
        <div>
          <strong>Oilor Studio</strong>
          <span>{dashboardLabel}</span>
        </div>
      </div>
      <div className="login-card__header">
        <p className="login-card__kicker">Secure workspace</p>
        <h1>{isFallbackMode ? "Password fallback" : "Welcome back"}</h1>
        <p className="muted">
          {isFallbackMode
            ? "Use the backup dashboard credentials."
            : "Sign in with Google to continue."}
        </p>
      </div>

      {isFallbackMode ? (
        <>
          <form className="stack login-card__fallback-form" onSubmit={handleSubmit}>
            <label>
              Username
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="login-card__remember">
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
          <a className="login-card__fallback-link" href="/">
            Back to Google sign in
          </a>
        </>
      ) : (
        <>
          {notice ? <p className="login-card__notice">{notice}</p> : null}
          {!googleAuthConfigured ? (
            <p className="login-card__notice">
              Google sign-in needs OAuth credentials before it can be used.
            </p>
          ) : null}
          <button
            className="login-card__google"
            type="button"
            onClick={handleGoogleLogin}
            disabled={busy || !googleAuthConfigured}
          >
            <FcGoogle aria-hidden="true" />
            {googleAuthConfigured ? "Continue with Google" : "Google sign-in not configured"}
          </button>
          <a className="login-card__fallback-link" href="/fallbacksign">
            Use password fallback
          </a>
        </>
      )}
    </div>
  );
}
