import { addDaysKey, endOfZonedDay, firstOfMonthKey, startOfZonedDay, zonedDateKey } from "@/lib/reporting-period";

// The period a report is asked for: a quick preset, or any range of days
// written as «custom_YYYY-MM-DD_YYYY-MM-DD». A plain string on purpose — it
// goes straight into effect dependencies and file names, and two equal periods
// are equal strings.
export type PeriodPreset = "today" | "yesterday" | "7d" | "30d" | "month" | "prevMonth" | "90d" | "year";
export type PeriodValue = PeriodPreset | `custom_${string}_${string}`;

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  "7d": "7 дней",
  "30d": "30 дней",
  month: "Этот месяц",
  prevMonth: "Прошлый месяц",
  "90d": "3 месяца",
  year: "Год",
};

export const ALL_PERIOD_PRESETS = Object.keys(PERIOD_PRESET_LABELS) as PeriodPreset[];

export const customPeriod = (from: string, to: string): PeriodValue => `custom_${from}_${to}`;

export function parseCustom(value: PeriodValue): { from: string; to: string } | null {
  const match = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(value);
  return match ? { from: match[1], to: match[2] } : null;
}

// The days a period covers, as Almaty calendar keys (the server's days — see
// lib/reporting-period.ts). A running period ends today.
export function periodDays(value: PeriodValue): { from: string; to: string } {
  const custom = parseCustom(value);
  if (custom) return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  const today = zonedDateKey();
  switch (value as PeriodPreset) {
    case "yesterday": {
      const day = addDaysKey(today, -1);
      return { from: day, to: day };
    }
    case "7d":
      return { from: addDaysKey(today, -6), to: today };
    case "30d":
      return { from: addDaysKey(today, -29), to: today };
    case "month":
      return { from: firstOfMonthKey(today), to: today };
    case "prevMonth": {
      const lastDay = addDaysKey(firstOfMonthKey(today), -1);
      return { from: firstOfMonthKey(lastDay), to: lastDay };
    }
    case "90d":
      return { from: addDaysKey(today, -89), to: today };
    case "year":
      return { from: addDaysKey(today, -364), to: today };
    default:
      return { from: today, to: today };
  }
}

// The instants a report is asked for. A range that includes today ends now; a
// closed one ends at the end of its last day — so «Прошлый месяц» is exactly the
// month, and a closed month is served from its frozen snapshot.
export function periodRange(value: PeriodValue): { from: Date; to: Date } {
  const days = periodDays(value);
  const today = zonedDateKey();
  return {
    from: startOfZonedDay(days.from),
    to: days.to >= today ? new Date() : endOfZonedDay(days.to),
  };
}

const dayLabel = (key: string) => key.split("-").reverse().join(".");

// How a period reads in a heading: the preset's name, or the dates.
export function periodLabel(value: PeriodValue): string {
  const custom = parseCustom(value);
  if (!custom) return PERIOD_PRESET_LABELS[value as PeriodPreset];
  const { from, to } = periodDays(value);
  return from === to ? dayLabel(from) : `${dayLabel(from)} — ${dayLabel(to)}`;
}
