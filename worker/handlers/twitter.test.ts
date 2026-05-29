import { describe, expect, it } from "vitest";
import { extractImageUrls, formatTwitterOAuthStartError, normalizeTwitterSearchLimit } from "./twitter";

describe("Twitter OAuth errors", () => {
  it("turns X callback approval XML into an actionable message", () => {
    const message = formatTwitterOAuthStartError(
      "<?xml version='1.0' encoding='UTF-8'?><errors><error code='415'>Callback URL not approved for this client application. Approved callback URLs can be adjusted in your application settings</error></errors>",
      "https://oilor.app/api/twitter/auth/callback",
    );

    expect(message).toContain("Twitter/X rejected the callback URL");
    expect(message).toContain("https://oilor.app/api/twitter/auth/callback");
    expect(message).not.toContain("<errors>");
  });
});

describe("Twitter media parsing", () => {
  it("keeps carousel image order from stored JSON arrays", () => {
    expect(extractImageUrls(JSON.stringify([
      "https://example.com/first.png",
      "https://example.com/second.png",
      "https://example.com/third.png",
    ]))).toEqual([
      "https://example.com/first.png",
      "https://example.com/second.png",
      "https://example.com/third.png",
    ]);
  });

  it("parses pasted newline/comma media lists before upload", () => {
    expect(extractImageUrls("https://example.com/first.png\nhttps://example.com/second.png, https://example.com/third.png")).toEqual([
      "https://example.com/first.png",
      "https://example.com/second.png",
      "https://example.com/third.png",
    ]);
  });
});

describe("Twitter search limits", () => {
  it("keeps recent-search limits inside X API bounds", () => {
    expect(normalizeTwitterSearchLimit("1")).toBe(10);
    expect(normalizeTwitterSearchLimit("17")).toBe(17);
    expect(normalizeTwitterSearchLimit("500")).toBe(25);
    expect(normalizeTwitterSearchLimit(null)).toBe(10);
  });
});
