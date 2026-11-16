import {
  birthdayInYear,
  LOYALTY_BIRTHDAY_NOTICE_DAYS,
  LOYALTY_BIRTHDAY_REDEEM_AFTER_DAYS,
  LOYALTY_BIRTHDAY_REDEEM_BEFORE_DAYS,
  LoyaltyFamilyMemberDto,
} from "@bakery-os/shared";
import { startOfZonedDay } from "../common/zoned-day";

// Pure date maths for birthdays on a loyalty card. Kept free of services so the
// member service can use toFamilyDto without an import cycle through the bot.

export const DAY = 86_400_000;
// A gift missed while the server slept is still granted up to this many days late.
export const CATCH_UP_DAYS = 7;
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" });

// Almaty midnight of a calendar date.
export function localMidnight(year: number, month: number, day: number): Date {
  return startOfZonedDay(new Date(Date.UTC(year, month - 1, day, 12)));
}

function todayParts(now: Date) {
  const [y, m, d] = dayKey.format(now).split("-").map(Number);
  return { y, m, d };
}

// The birthday that is "current" at `now`: today, or up to CATCH_UP_DAYS ago
// (the previous year's when it fell just before New Year).
export function currentBirthday(now: Date, month: number, day: number): { year: number; at: Date } | null {
  const { y } = todayParts(now);
  for (const year of [y, y - 1]) {
    const b = birthdayInYear(year, month, day);
    const at = localMidnight(year, b.month, b.day);
    if (at.getTime() <= now.getTime() && now.getTime() - at.getTime() < (CATCH_UP_DAYS + 1) * DAY) return { year, at };
  }
  return null;
}

export function nextBirthday(now: Date, month: number, day: number): { year: number; at: Date } {
  const { y } = todayParts(now);
  const today = startOfZonedDay(now);
  for (const year of [y, y + 1]) {
    const b = birthdayInYear(year, month, day);
    const at = localMidnight(year, b.month, b.day);
    if (at.getTime() >= today.getTime()) return { year, at };
  }
  const b = birthdayInYear(y + 1, month, day);
  return { year: y + 1, at: localMidnight(y + 1, b.month, b.day) };
}

export const giftEligible = (dateSetAt: Date, birthdayAt: Date) =>
  dateSetAt.getTime() <= birthdayAt.getTime() - LOYALTY_BIRTHDAY_NOTICE_DAYS * DAY;

// The birthday days around `now` (a week before to a week after): the last day
// of that window, or null when `now` is outside it. A date put on the card too
// late (the gift's 30-day rule) opens no window either.
export function birthdayWindowEnd(now: Date, row: { birthMonth: number; birthDay: number; dateSetAt: Date }): Date | null {
  const { y } = todayParts(now);
  for (const year of [y - 1, y, y + 1]) {
    const b = birthdayInYear(year, row.birthMonth, row.birthDay);
    const at = localMidnight(year, b.month, b.day);
    const from = at.getTime() - LOYALTY_BIRTHDAY_REDEEM_BEFORE_DAYS * DAY;
    const end = at.getTime() + (LOYALTY_BIRTHDAY_REDEEM_AFTER_DAYS + 1) * DAY;
    if (now.getTime() >= from && now.getTime() < end && giftEligible(row.dateSetAt, at)) return new Date(end - 1);
  }
  return null;
}

export const almatyDayKey = (at: Date) => dayKey.format(at);

export function toFamilyDto(
  row: { id: string; name: string; relation: string | null; birthDay: number; birthMonth: number; birthYear: number | null; dateSetAt: Date; grants: { year: number }[] },
  now = new Date(),
): LoyaltyFamilyMemberDto {
  const next = nextBirthday(now, row.birthMonth, row.birthDay);
  return {
    id: row.id,
    name: row.name,
    relation: row.relation,
    birthDay: row.birthDay,
    birthMonth: row.birthMonth,
    birthYear: row.birthYear,
    nextBirthday: dayKey.format(next.at),
    giftEligibleNext: giftEligible(row.dateSetAt, next.at),
    lastGiftYear: row.grants.length ? Math.max(...row.grants.map((g) => g.year)) : null,
  };
}
