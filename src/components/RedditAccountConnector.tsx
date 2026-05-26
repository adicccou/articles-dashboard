import { useState } from "react";
import type { RedditAccount } from "../lib/types";

interface RedditAccountConnectorProps {
  onConnected: (account: RedditAccount) => Promise<void>;
  onCancel: () => void;
}

export const RedditAccountConnector: React.FC<RedditAccountConnectorProps> = ({
  onConnected,
  onCancel,
}) => {
  const [step, setStep] = useState<"info" | "connecting" | "error">("info");
  const [error, setError] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string>("");

  const handleConnect = async () => {
    if (!accountName.trim()) {
      setError("Please enter an account name");
      return;
    }

    setStep("connecting");
    setError(null);

    try {
      // Request OAuth authorization URL from backend
      const response = await fetch("/api/reddit/auth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_name: accountName }),
      });

      if (!response.ok) {
        throw new Error("Failed to start Reddit OAuth flow");
      }

      const data = (await response.json()) as { auth_url: string };

      // Redirect to Reddit OAuth
      window.location.href = data.auth_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setStep("error");
    }
  };

  if (step === "connecting") {
    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <div style={{ textAlign: "center", padding: "32px" }}>
            <p style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>
              Redirecting to Reddit...
            </p>
            <p style={{ color: "#6b7280", marginBottom: "24px" }}>
              Please log in with your Reddit account and authorize Oilor Studio.
            </p>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="panel stack" style={{ maxWidth: "400px" }}>
          <div className="panel__title-row">
            <h2>Connect Reddit Account</h2>
            <button
              onClick={onCancel}
              style={{
                background: "none",
                border: "none",
                fontSize: "20px",
                cursor: "pointer",
                color: "#6b7280",
              }}
            >
              ×
            </button>
          </div>

          {error && (
            <div
              style={{
                padding: "12px 16px",
                backgroundColor: "#fee2e2",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                color: "#dc2626",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginBottom: "16px" }}>
            <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "12px" }}>
              Give this connection a name so you can identify it later.
            </p>
            <label>
              Account Name
              <input
                type="text"
                value={accountName}
                onChange={(e) => {
                  setAccountName(e.target.value);
                  setError(null);
                }}
                placeholder="My Reddit Bot"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleConnect();
                  }
                }}
              />
            </label>
          </div>

          <div
            style={{
              padding: "12px",
              backgroundColor: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#166534",
              marginBottom: "16px",
            }}
          >
            <strong>What happens next:</strong>
            <ul style={{ margin: "8px 0 0 20px", paddingLeft: 0 }}>
              <li>You'll be redirected to Reddit to log in</li>
              <li>Grant Oilor Studio access to your account</li>
              <li>You'll be redirected back with your account connected</li>
            </ul>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={onCancel}
              className="button-secondary"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleConnect()}
              style={{ flex: 1 }}
              disabled={!accountName.trim()}
            >
              Connect with Reddit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
