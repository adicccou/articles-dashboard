import { describe, expect, it } from "vitest";
import {
  createPkceS256Challenge,
  handleChatGptOAuthRequest,
} from "./chatgpt-oauth";
import type { Env } from "../lib/types";

describe("ChatGPT OAuth", () => {
  it("creates RFC 7636 S256 PKCE challenges", async () => {
    await expect(createPkceS256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("serves protected resource metadata for the MCP endpoint", async () => {
    const response = await handleChatGptOAuthRequest(
      new Request("https://oilor.app/.well-known/oauth-protected-resource"),
      {} as Env,
    );

    expect(response?.status).toBe(200);
    const payload = await response?.json() as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(payload.resource).toBe("https://oilor.app/mcp");
    expect(payload.authorization_servers).toEqual(["https://oilor.app"]);
    expect(payload.scopes_supported).toEqual(["posts.read", "posts.write", "posts.publish"]);
  });
});
