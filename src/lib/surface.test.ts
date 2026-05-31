import { describe, expect, it } from "vitest";
import { getDefaultView, isViewAllowedForSurface, normalizeStoredView } from "./surface";

describe("dashboard surface navigation", () => {
  it("defaults new marketing users to Planner", () => {
    expect(getDefaultView("marketing")).toBe("planner");
  });

  it("keeps the trading surface on the trading view by default", () => {
    expect(getDefaultView("trading")).toBe("trading");
  });

  it("keeps the articles surface on the articles view by default", () => {
    expect(getDefaultView("articles")).toBe("articles");
  });

  it("keeps articles out of the marketing surface", () => {
    const storedView = normalizeStoredView("articles");

    expect(storedView).toBe("articles");
    expect(storedView && isViewAllowedForSurface(storedView, "articles")).toBe(true);
    expect(storedView && isViewAllowedForSurface(storedView, "marketing")).toBe(false);
  });
});
