// Calendar days in reports are the owner's days — the same rule the API states
// in sales.service.ts and buckets every report by. The frontend has to agree
// with it, because the frontend is what decides the from/to a report is asked
// for: computing "вчера" from the browser's own clock and then having the
// server slice it by Almaty days makes the two disagree, and «Вчера» comes back
// spanning two days. Invisible on the monoblock, which sits in Almaty; wrong
// the moment the owner opens the same report from anywhere else.
export const REPORTING_TIME_ZONE = "Asia/Almaty";

// "YYYY-MM-DD" as it reads on a wall clock in the reporting zone. en-CA formats
// as ISO, and Intl resolves the zone's real offset rather than hardcoding +5,
// so this stays correct if the rules ever change.
export function zonedDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// How far the reporting zone is from UTC at a given instant, in milliseconds.
// Derived by formatting the instant in that zone and reading the result back as
// if it were UTC — the difference IS the offset, without hardcoding it.
function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORTING_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asIfUtc - instant.getTime();
}

// The instant at which a given calendar date begins in the reporting zone.
// The offset is applied twice on purpose: the first pass is a guess made with
// the offset in effect at the wrong moment, the second uses the offset actually
// in effect at the start of that day. Redundant for Almaty, which has had a
// fixed offset since 2005, but it is what makes this correct rather than
// correct-by-coincidence.
export function startOfZonedDay(dateKey: string): Date {
  const naiveUtc = Date.parse(`${dateKey}T00:00:00Z`);
  const guess = new Date(naiveUtc - zoneOffsetMs(new Date(naiveUtc)));
  return new Date(naiveUtc - zoneOffsetMs(guess));
}

export function endOfZonedDay(dateKey: string): Date {
  return new Date(startOfZonedDay(addDaysKey(dateKey, 1)).getTime() - 1);
}

// Calendar arithmetic on the date key itself, stepped in UTC on a plain date so
// a day can be neither skipped nor repeated around an offset change.
export function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

export function firstOfMonthKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

// A specific wall-clock time ("18:00") on a specific day, both read as they
// stand in the reporting zone — e.g. "продажи до 18:00" on a given date.
// Adding the minutes straight onto the day's start instant is safe (not just
// convenient) because Asia/Almaty has had a fixed offset since 2005, per
// startOfZonedDay's own comment above — there is no DST edge to land on
// between midnight and any HH:mm the same day.
export function zonedDateTime(dateKey: string, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(startOfZonedDay(dateKey).getTime() + (hours * 60 + minutes) * 60_000);
}
