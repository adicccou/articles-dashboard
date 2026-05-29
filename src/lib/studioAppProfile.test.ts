import { describe, expect, it } from "vitest";
import {
  formatStudioAppProfile,
  normalizeStudioAppProfile,
  splitStudioAppProfileList,
  summarizeStudioAppProfile,
} from "./studioAppProfile";

describe("studio app profile helpers", () => {
  it("normalizes list fields from strings and arrays", () => {
    const profile = normalizeStudioAppProfile({
      category: "Trading journal",
      competitors: "Notion\nSpreadsheet\nNotion",
      content_angles: ["Founder lessons", "Workflow demos", "Founder lessons"],
    });

    expect(profile.category).toBe("Trading journal");
    expect(profile.competitors).toEqual(["Notion", "Spreadsheet"]);
    expect(profile.content_angles).toEqual(["Founder lessons", "Workflow demos"]);
  });

  it("splits profile lists by line", () => {
    expect(splitStudioAppProfileList("One\nTwo\nTwo")).toEqual(["One", "Two"]);
  });

  it("formats the profile into an AI-friendly knowledge block", () => {
    const formatted = formatStudioAppProfile(normalizeStudioAppProfile({
      category: "Trading journal",
      target_users: "Solo traders",
      problem_before: "Their notes are scattered.",
      main_promise: "A calmer way to review trades.",
      target_posts: ["People asking how to review trades consistently"],
    }));

    expect(formatted).toContain("BASIC IDENTITY");
    expect(formatted).toContain("Target users: Solo traders");
    expect(formatted).toContain("Main promise: A calmer way to review trades.");
    expect(formatted).toContain("Posts and comments to target");
  });

  it("builds a compact summary for search planning", () => {
    const summary = summarizeStudioAppProfile(normalizeStudioAppProfile({
      category: "Marketing tool",
      target_users: "Solo founders",
      main_differentiation: "Studio-first workflow",
    }));

    expect(summary).toContain("Category: Marketing tool");
    expect(summary).toContain("Target users: Solo founders");
    expect(summary).toContain("Differentiation: Studio-first workflow");
  });
});
