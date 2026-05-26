import { describe, expect, it } from "vitest";
import { mediaUrls } from "./social-accounts";

describe("extra social media parsing", () => {
  it("keeps Instagram carousel image order from stored JSON arrays", () => {
    expect(mediaUrls(JSON.stringify([
      "https://example.com/one.png",
      "https://example.com/two.png",
      "https://example.com/three.png",
    ]))).toEqual([
      "https://example.com/one.png",
      "https://example.com/two.png",
      "https://example.com/three.png",
    ]);
  });

  it("parses pasted newline/comma media lists for official publishers", () => {
    expect(mediaUrls("https://example.com/one.png\nhttps://example.com/two.png, https://example.com/three.png")).toEqual([
      "https://example.com/one.png",
      "https://example.com/two.png",
      "https://example.com/three.png",
    ]);
  });
});
