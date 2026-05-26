import { describe, expect, it } from "vitest";
import {
  buildRedditAuthorizationUrl,
  handleAuthorizeRequest,
  isRedditAuthConfigured,
  redditOAuthScopes,
  resolveRedditRedirectUri,
} from "./reddit-auth";
import type { Env } from "../lib/types";

describe("Reddit OAuth", () => {
  const env = {
    REDDIT_CLIENT_ID: "reddit-client-id",
    REDDIT_CLIENT_SECRET: "reddit-client-secret",
    REDDIT_REDIRECT_URI: "https://marketing-dashboard.adilet-melisov.workers.dev/api/reddit/auth/callback",
  } as Env;

  it("requests the scopes needed for identity, subreddit selection, and publishing", () => {
    const authUrl = new URL(buildRedditAuthorizationUrl(env, "https://marketing-dashboard.adilet-melisov.workers.dev/config", "state-123"));
    const scopes = authUrl.searchParams.get("scope")?.split(",") ?? [];

    expect(authUrl.origin).toBe("https://www.reddit.com");
    expect(authUrl.searchParams.get("client_id")).toBe(env.REDDIT_CLIENT_ID);
    expect(authUrl.searchParams.get("redirect_uri")).toBe(env.REDDIT_REDIRECT_URI);
    expect(authUrl.searchParams.get("duration")).toBe("permanent");
    expect(scopes).toEqual(["identity", "read", "mysubreddits", "submit", "edit"]);
  });

  it("can override scopes explicitly if Reddit changes an approval requirement", () => {
    expect(redditOAuthScopes({ ...env, REDDIT_SCOPES: "identity read submit" } as Env)).toBe("identity read submit");
  });

  it("falls back to the current Worker origin for local preview callbacks", () => {
    expect(resolveRedditRedirectUri({ ...env, REDDIT_REDIRECT_URI: "" } as Env, "http://localhost:5174/?view=config")).toBe(
      "http://localhost:5174/api/reddit/auth/callback",
    );
  });

  it("reports whether Reddit OAuth is configured", () => {
    expect(isRedditAuthConfigured(env)).toBe(true);
    expect(isRedditAuthConfigured({ ...env, REDDIT_CLIENT_SECRET: "" } as Env)).toBe(false);
  });

  it("returns an actionable error when OAuth credentials are missing", async () => {
    const response = await handleAuthorizeRequest(
      { ...env, REDDIT_CLIENT_SECRET: "" } as Env,
      new Request("https://marketing-dashboard.adilet-melisov.workers.dev/api/reddit/auth/authorize", {
        method: "POST",
        body: JSON.stringify({ account_name: "Reddit" }),
      }),
    );
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(500);
    expect(payload.error).toContain("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET");
    expect(payload.error).toContain("https://marketing-dashboard.adilet-melisov.workers.dev/api/reddit/auth/callback");
  });
});
