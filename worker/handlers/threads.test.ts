import { describe, expect, it } from "vitest";
import { selectThreadsImageUrl, selectThreadsImageUrls } from "./threads";

describe("Threads media publishing", () => {
  it("keeps every URL from stored multi-image arrays for carousel publishing", () => {
    expect(selectThreadsImageUrls(JSON.stringify([
      "https://example.com/first.jpg",
      "https://example.com/second.jpg",
    ]))).toEqual([
      "https://example.com/first.jpg",
      "https://example.com/second.jpg",
    ]);
    expect(selectThreadsImageUrl(JSON.stringify([
      "https://example.com/first.jpg",
      "https://example.com/second.jpg",
    ]))).toBe("https://example.com/first.jpg");
  });

  it("ignores empty stored media arrays", () => {
    expect(selectThreadsImageUrls("[]")).toEqual([]);
  });
});
