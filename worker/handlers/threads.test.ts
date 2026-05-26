import { describe, expect, it } from "vitest";
import { selectThreadsImageUrl } from "./threads";

describe("Threads media publishing", () => {
  it("uses the first URL from stored multi-image arrays", () => {
    expect(selectThreadsImageUrl(JSON.stringify([
      "https://example.com/first.jpg",
      "https://example.com/second.jpg",
    ]))).toBe("https://example.com/first.jpg");
  });

  it("ignores empty stored media arrays", () => {
    expect(selectThreadsImageUrl("[]")).toBeUndefined();
  });
});
