import { describe, expect, it, vi } from "vitest";
import { chooseAutoSchedule, collectActiveScheduledSocialSlots } from "./socialSchedule";

describe("social autoschedule", () => {
  it("counts active Instagram planner posts as occupied social slots", () => {
    const slots = collectActiveScheduledSocialSlots([
      {
        id: 1,
        item_type: "post",
        platform: "instagram",
        status: "planned",
        scheduled_for: "2026-05-16T10:00:00+08:00",
      },
      {
        id: 2,
        item_type: "post",
        platform: "threads",
        status: "published",
        scheduled_for: "2026-05-17T10:00:00+08:00",
      },
      {
        id: 3,
        item_type: "campaign",
        platform: "instagram",
        status: "planned",
        scheduled_for: "2026-05-18T10:00:00+08:00",
      },
    ]);

    expect(slots).toEqual(["2026-05-16T10:00:00+08:00"]);
  });

  it("can check occupied slots per platform", () => {
    const slots = collectActiveScheduledSocialSlots(
      [
        {
          id: 1,
          item_type: "post",
          platform: "threads",
          status: "planned",
          scheduled_for: "2026-05-16T10:00:00+08:00",
        },
        {
          id: 2,
          item_type: "post",
          platform: "instagram",
          status: "planned",
          scheduled_for: "2026-05-16T13:00:00+08:00",
        },
      ],
      undefined,
      { platform: "instagram" },
    );

    expect(slots).toEqual(["2026-05-16T13:00:00+08:00"]);
  });

  it("chooses the next free day when Instagram already occupies today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T09:00:00+08:00"));

    const scheduled = chooseAutoSchedule(["2026-05-16T10:00:00+08:00"]);

    expect(scheduled.toISOString()).toBe(new Date("2026-05-17T10:00:00+08:00").toISOString());
    vi.useRealTimers();
  });
});
