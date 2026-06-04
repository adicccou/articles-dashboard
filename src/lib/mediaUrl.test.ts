import { afterEach, describe, expect, it } from "vitest";
import { normalizeDashboardMediaUrl } from "./mediaUrl";

function setWindowOrigin(origin: string) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin } },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("normalizeDashboardMediaUrl", () => {
  it("rewrites old dashboard media hosts to the current dashboard host", () => {
    setWindowOrigin("https://articles-dashboard.adilet-melisov.workers.dev");

    expect(
      normalizeDashboardMediaUrl("https://dashboard.adilet-melisov.workers.dev/api/media/uploads/example.jpg"),
    ).toBe("https://articles-dashboard.adilet-melisov.workers.dev/api/media/uploads/example.jpg?source=dashboard-media");
  });

  it("adds a cache marker to relative dashboard media URLs", () => {
    setWindowOrigin("https://articles-dashboard.adilet-melisov.workers.dev");

    expect(normalizeDashboardMediaUrl("/api/media/uploads/example.jpg")).toBe(
      "https://articles-dashboard.adilet-melisov.workers.dev/api/media/uploads/example.jpg?source=dashboard-media",
    );
  });

  it("keeps dashboard media on the hosted origin during local development", () => {
    setWindowOrigin("http://127.0.0.1:5190");

    expect(normalizeDashboardMediaUrl("/api/media/uploads/example.jpg")).toBe(
      "https://articles-dashboard.adilet-melisov.workers.dev/api/media/uploads/example.jpg?source=dashboard-media",
    );

    expect(
      normalizeDashboardMediaUrl("https://marketing-dashboard.adilet-melisov.workers.dev/api/media/uploads/example.jpg"),
    ).toBe("https://articles-dashboard.adilet-melisov.workers.dev/api/media/uploads/example.jpg?source=dashboard-media");
  });

  it("leaves external and data URLs untouched", () => {
    setWindowOrigin("https://articles-dashboard.adilet-melisov.workers.dev");

    expect(normalizeDashboardMediaUrl("https://cdn.example.com/image.jpg")).toBe("https://cdn.example.com/image.jpg");
    expect(normalizeDashboardMediaUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });
});
