import { BadRequestException } from "@nestjs/common";
import { CASH_FLOW_MONTHS_MAX, debtDateKey } from "@bakery-os/shared";
import { startOfZonedDay } from "./zoned-day";

export interface MonthRange {
  key: string; // "YYYY-MM"
  from: Date;
  to: Date;
}

const KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

// Local midnight of the 1st of a month in Almaty. Noon UTC of that date is
// 17:00 in Almaty, the same date, so the day is never mistaken.
export function startOfZonedMonth(key: string): Date {
  const m = KEY.exec(key);
  if (!m) throw new BadRequestException("Месяц — в формате ГГГГ-ММ");
  return startOfZonedDay(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1, 12)));
}

export function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

// The calendar months from `fromKey` to `toKey` inclusive, each as an Almaty
// range. The current month stops at `now`; a month in the future is refused.
export function monthRanges(fromKey: string, toKey: string, now = new Date(), max = CASH_FLOW_MONTHS_MAX): MonthRange[] {
  if (!KEY.test(fromKey) || !KEY.test(toKey)) throw new BadRequestException("Месяц — в формате ГГГГ-ММ");
  if (fromKey > toKey) throw new BadRequestException("Начальный месяц позже конечного");
  const currentKey = debtDateKey(now).slice(0, 7);
  if (toKey > currentKey) throw new BadRequestException("Нельзя построить отчёт за будущий месяц");
  const ranges: MonthRange[] = [];
  for (let key = fromKey; key <= toKey; key = nextMonthKey(key)) {
    if (ranges.length >= max) throw new BadRequestException(`Не больше ${max} месяцев за раз`);
    const from = startOfZonedMonth(key);
    const end = new Date(startOfZonedMonth(nextMonthKey(key)).getTime() - 1);
    ranges.push({ key, from, to: key === currentKey ? now : end });
  }
  return ranges;
}
