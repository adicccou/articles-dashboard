import { describe, expect, it } from "vitest";
import { formatTwitterOAuthStartError } from "./twitter";

describe("Twitter OAuth errors", () => {
  it("turns X callback approval XML into an actionable message", () => {
    const message = formatTwitterOAuthStartError(
      "<?xml version='1.0' encoding='UTF-8'?><errors><error code='415'>Callback URL not approved for this client application. Approved callback URLs can be adjusted in your application settings</error></errors>",
      "https://marketing-dashboard.adilet-melisov.workers.dev/api/twitter/auth/callback",
    );

    expect(message).toContain("Twitter/X rejected the callback URL");
    expect(message).toContain("https://marketing-dashboard.adilet-melisov.workers.dev/api/twitter/auth/callback");
    expect(message).not.toContain("<errors>");
  });
});
