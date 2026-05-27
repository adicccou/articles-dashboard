import { describe, expect, it } from "vitest";
import { getDefaultView, isViewAllowedForSurface, normalizeStoredView } from "./surface";

describe("dashboard surface navigation", () => {
  it("defaults new marketing users to Planner", () => {
    expect(getDefaultView("marketing")).toBe("planner");
  });

  it("keeps the trading surface on the trading view by default", () => {
    expect(getDefaultView("trading")).toBe("trading");
  });

  it("accepts saved marketing nav tabs for returning users", () => {
    const storedView = normalizeStoredView("articles");

    expect(storedView).toBe("articles");
    expect(storedView && isViewAllowedForSurface(storedView, "marketing")).toBe(true);
  });
});
