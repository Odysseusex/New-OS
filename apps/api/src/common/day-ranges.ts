import { BadRequestException } from "@nestjs/common";
import { CASH_FLOW_DAYS_MAX, CASH_FLOW_WEEKS_MAX, debtDateKey } from "@bakery-os/shared";
import { startOfZonedDay } from "./zoned-day";
import type { MonthRange } from "./month-ranges";

const KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const utc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (key: string, days: number) => new Date(utc(key) + days * 86_400_000).toISOString().slice(0, 10);

// Local midnight of a calendar day in Almaty (noon UTC of that date is the same date there).
export function startOfZonedDate(key: string): Date {
  if (!KEY.test(key)) throw new BadRequestException("Дата — в формате ГГГГ-ММ-ДД");
  return startOfZonedDay(new Date(utc(key) + 12 * 3_600_000));
}

function checkRange(fromKey: string, toKey: string, now: Date): string {
  if (!KEY.test(fromKey) || !KEY.test(toKey)) throw new BadRequestException("Дата — в формате ГГГГ-ММ-ДД");
  if (fromKey > toKey) throw new BadRequestException("Начальная дата позже конечной");
  const today = debtDateKey(now);
  if (toKey > today) throw new BadRequestException("Нельзя построить отчёт за будущие дни");
  return today;
}

// Each Almaty calendar day from `fromKey` to `toKey`; today stops at `now`.
export function dayRanges(fromKey: string, toKey: string, now = new Date(), max = CASH_FLOW_DAYS_MAX): MonthRange[] {
  const today = checkRange(fromKey, toKey, now);
  const ranges: MonthRange[] = [];
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    if (ranges.length >= max) throw new BadRequestException(`Не больше ${max} дней за раз`);
    const from = startOfZonedDate(key);
    ranges.push({ key, from, to: key === today ? now : new Date(startOfZonedDate(addDays(key, 1)).getTime() - 1) });
  }
  return ranges;
}

// Weeks Monday to Sunday, cut to the asked range at both ends; key = the
// week's first day inside the range. The current week stops at `now`.
export function weekRanges(fromKey: string, toKey: string, now = new Date(), max = CASH_FLOW_WEEKS_MAX): MonthRange[] {
  const today = checkRange(fromKey, toKey, now);
  const ranges: MonthRange[] = [];
  let key = fromKey;
  while (key <= toKey) {
    if (ranges.length >= max) throw new BadRequestException(`Не больше ${max} недель за раз`);
    const weekday = (new Date(utc(key)).getUTCDay() + 6) % 7; // Monday = 0
    let last = addDays(key, 6 - weekday);
    if (last > toKey) last = toKey;
    const from = startOfZonedDate(key);
    const to = last >= today ? now : new Date(startOfZonedDate(addDays(last, 1)).getTime() - 1);
    ranges.push({ key, from, to });
    key = addDays(last, 1);
  }
  return ranges;
}
