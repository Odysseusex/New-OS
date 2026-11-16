import type { Prisma, PrismaClient } from "@prisma/client";
import type { LoyaltySettingsDto } from "@bakery-os/shared";
import { almatyDayKey, birthdayWindowEnd } from "./birthdays";

type Db = PrismaClient | Prisma.TransactionClient;

export interface MemberRedeemLimit {
  percent: number;
  // Last day (YYYY-MM-DD, Almaty) of the birthday days that raised it; null = the ordinary limit.
  birthdayUntil: string | null;
}

// The share of a check a member may pay with points right now: the ordinary
// limit, or the birthday one while any birthday on the card (the holder's or
// the family's) is within its days. One rule for the till, the sale and the app.
export async function memberRedeemLimit(db: Db, memberId: string, settings: LoyaltySettingsDto, now = new Date()): Promise<MemberRedeemLimit> {
  const base = { percent: settings.maxRedeemPercent, birthdayUntil: null };
  if (settings.birthdayRedeemPercent <= settings.maxRedeemPercent) return base;
  const rows = await db.loyaltyFamilyMember.findMany({
    where: { memberId, archivedAt: null },
    select: { birthMonth: true, birthDay: true, dateSetAt: true },
  });
  let until: Date | null = null;
  for (const row of rows) {
    const end = birthdayWindowEnd(now, row);
    if (end && (!until || end > until)) until = end;
  }
  return until ? { percent: settings.birthdayRedeemPercent, birthdayUntil: almatyDayKey(until) } : base;
}
