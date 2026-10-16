// Where a day starts for the business: midnight on the wall clock in Almaty,
// not on the server's clock (UTC on Render). With `setHours(0, 0, 0, 0)` on a
// UTC server, «today» began at 05:00 local time, so a sale rung up at 03:00
// belonged to the day before.

export const BUSINESS_TIME_ZONE = "Asia/Almaty";

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// The zone's offset from UTC at that instant, in ms (Intl resolves the real
// rules, so a future change of Kazakhstan's offset needs no code change).
function offsetMs(at: Date): number {
  const parts = Object.fromEntries(partsFormat.formatToParts(at).map((p) => [p.type, p.value]));
  const wallAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// Local midnight of the day `at` falls on, moved back `daysBack` calendar days.
export function startOfZonedDay(at: Date, daysBack = 0): Date {
  const parts = Object.fromEntries(partsFormat.formatToParts(at).map((p) => [p.type, p.value]));
  const midnightAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - daysBack);
  const guess = new Date(midnightAsUtc - offsetMs(new Date(midnightAsUtc)));
  return new Date(midnightAsUtc - offsetMs(guess));
}
