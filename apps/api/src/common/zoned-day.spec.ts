import { startOfZonedDay } from "./zoned-day";
import { currentAndPreviousPeriod } from "./period-range";

// The business day starts at midnight in Almaty (UTC+5), whatever the server's clock.
describe("startOfZonedDay", () => {
  it("a sale at 03:00 Almaty belongs to that day, not the one before", () => {
    // 2026-10-16 22:00 UTC = 2026-10-17 03:00 in Almaty.
    expect(startOfZonedDay(new Date("2026-10-16T22:00:00Z")).toISOString()).toBe("2026-10-16T19:00:00.000Z");
  });

  it("late evening in Almaty is still the same day", () => {
    // 2026-10-17 18:30 UTC = 23:30 in Almaty on the 17th.
    expect(startOfZonedDay(new Date("2026-10-17T18:30:00Z")).toISOString()).toBe("2026-10-16T19:00:00.000Z");
  });

  it("goes back whole calendar days, across a month boundary", () => {
    expect(startOfZonedDay(new Date("2026-10-02T06:00:00Z"), 7).toISOString()).toBe("2026-09-24T19:00:00.000Z");
  });

  it("rolling periods start at local midnight", () => {
    const { current, previous } = currentAndPreviousPeriod(7, new Date("2026-10-16T22:00:00Z"));
    expect(current.from.toISOString()).toBe("2026-10-10T19:00:00.000Z");
    expect(previous.from.toISOString()).toBe("2026-10-03T19:00:00.000Z");
  });
});
