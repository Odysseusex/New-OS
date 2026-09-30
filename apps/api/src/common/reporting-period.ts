// Calendar months in the owner's time zone. Kazakhstan is on a fixed UTC+5
// (no daylight saving), the same zone every day-by-day report already buckets
// in, so a "month" here is the same month the owner sees everywhere else.
export const REPORTING_UTC_OFFSET_HOURS = 5;
const HOUR = 3600_000;

export interface MonthRange {
  year: number;
  month: number; // 1–12
  start: Date; // first instant of the month
  end: Date; // last millisecond of the month (used with `lte`)
}

export function monthRange(year: number, month: number): MonthRange {
  const start = new Date(Date.UTC(year, month - 1, 1) - REPORTING_UTC_OFFSET_HOURS * HOUR);
  const nextStart = new Date(Date.UTC(year, month, 1) - REPORTING_UTC_OFFSET_HOURS * HOUR);
  return { year, month, start, end: new Date(nextStart.getTime() - 1) };
}

export function monthOf(date: Date): { year: number; month: number } {
  const shifted = new Date(date.getTime() + REPORTING_UTC_OFFSET_HOURS * HOUR);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`;

// Ordering key: later months compare greater.
export const monthOrdinal = (year: number, month: number): number => year * 12 + month;
