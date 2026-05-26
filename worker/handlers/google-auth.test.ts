import { describe, expect, it } from "vitest";
import {
  allowedGoogleEmails,
  authorizeGoogleDashboardLogin,
  buildGoogleAuthorizationUrl,
  isGoogleAuthConfigured,
  isGoogleEmailAllowed,
  resolveGoogleRedirectUri,
} from "./google-auth";
import type { Env } from "../lib/types";

describe("Google dashboard auth", () => {
  const env = {
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GOOGLE_REDIRECT_URI: "https://marketing-dashboard.adilet-melisov.workers.dev/api/auth/google/callback",
    GOOGLE_ALLOWED_EMAILS: "adiccou@gmail.com, teammate@example.com",
    DASHBOARD_OWNER_EMAIL: "adiccou@gmail.com",
  } as Env;

  it("builds an authorization URL that always lets the user select the Google account", () => {
    const authUrl = new URL(buildGoogleAuthorizationUrl(env, "https://marketing-dashboard.adilet-melisov.workers.dev/", "state-123"));

    expect(authUrl.origin).toBe("https://accounts.google.com");
    expect(authUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(authUrl.searchParams.get("prompt")).toBe("select_account");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(env.GOOGLE_REDIRECT_URI);
    expect(authUrl.searchParams.get("state")).toBe("state-123");
  });

  it("keeps dashboard access restricted to configured Google emails", () => {
    expect(allowedGoogleEmails(env)).toEqual(["adiccou@gmail.com", "teammate@example.com"]);
    expect(isGoogleEmailAllowed(env, "Adiccou@Gmail.com")).toBe(true);
    expect(isGoogleEmailAllowed(env, "someone@example.com")).toBe(false);
  });

  it("falls back to the current Worker origin when no redirect env is set", () => {
    expect(resolveGoogleRedirectUri({ ...env, GOOGLE_REDIRECT_URI: "" } as Env, "https://example.com/config")).toBe(
      "https://example.com/api/auth/google/callback",
    );
  });

  it("reports whether Google OAuth is configured", () => {
    expect(isGoogleAuthConfigured(env)).toBe(true);
    expect(isGoogleAuthConfigured({ ...env, GOOGLE_CLIENT_SECRET: "" } as Env)).toBe(false);
  });

  it("redirects to the sign-in page instead of dumping JSON when OAuth secrets are missing", async () => {
    const response = await authorizeGoogleDashboardLogin(
      new Request("https://marketing-dashboard.adilet-melisov.workers.dev/api/auth/google/authorize"),
      { ...env, GOOGLE_CLIENT_SECRET: "" } as Env,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "https://marketing-dashboard.adilet-melisov.workers.dev/?auth_error=google_not_configured",
    );
  });
});
