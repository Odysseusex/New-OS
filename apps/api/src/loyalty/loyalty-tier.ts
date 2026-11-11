import { Prisma } from "@prisma/client";
import { loyaltyTierBySpend, loyaltyTierDto, LoyaltySettingsDto, LoyaltyTier, LoyaltyTierDto, resolveLoyaltyTier } from "@bakery-os/shared";
import { ownAmount } from "../common/own-sales";

// A member's level (Базовый / Серебро / Золото). Nothing about it is typed in:
// the spend is read from the member's own sales over the last `tierWindowDays`
// days (our goods only, returns taken off; records merged into the member count
// as theirs), and only the level reached + how long it is kept are remembered
// on the member row. Worked out whenever the member is looked at or buys, so
// there is no nightly job to miss.

type Db = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
const MAX_MERGE_DEPTH = 10;

async function withMerged(db: Pick<Db, "loyaltyMember">, memberId: string): Promise<string[]> {
  const ids = [memberId];
  let frontier = [memberId];
  for (let depth = 0; depth < MAX_MERGE_DEPTH && frontier.length > 0; depth += 1) {
    const children = await db.loyaltyMember.findMany({ where: { mergedIntoId: { in: frontier } }, select: { id: true } });
    frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

export async function memberTierSpend(
  db: Pick<Db, "loyaltyMember" | "sale">,
  memberId: string,
  settings: LoyaltySettingsDto,
  now: Date,
  excludeSaleId?: string,
): Promise<number> {
  const ids = await withMerged(db, memberId);
  const sales = await db.sale.findMany({
    where: {
      loyaltyMemberId: { in: ids },
      soldAt: { gte: new Date(now.getTime() - settings.tierWindowDays * DAY_MS), lte: now },
      ...(excludeSaleId ? { id: { not: excludeSaleId } } : {}),
    },
    select: { totalAmount: true, consignmentAmount: true, returns: { select: { totalAmount: true, consignmentAmount: true } } },
  });
  const spend = sales.reduce((sum, s) => sum + ownAmount(s) - s.returns.reduce((r, x) => r + ownAmount(x), 0), 0);
  return Math.max(0, Math.round(spend * 100) / 100);
}

// The member's level now; remembers it when it changed. Null while levels are off.
// `excludeSaleId`: the level the member came to the till with (the sale being
// recorded does not count toward its own percent).
export async function memberTier(
  db: Pick<Db, "loyaltyMember" | "sale">,
  memberId: string,
  settings: LoyaltySettingsDto,
  now: Date = new Date(),
  excludeSaleId?: string,
): Promise<LoyaltyTierDto | null> {
  if (!settings.tiersEnabled) return null;
  const member = await db.loyaltyMember.findUnique({ where: { id: memberId }, select: { tier: true, tierHeldUntil: true } });
  if (!member) return null;
  const spend = await memberTierSpend(db, memberId, settings, now, excludeSaleId);
  const stored = member.tier as LoyaltyTier;
  const next = resolveLoyaltyTier({ earned: loyaltyTierBySpend(spend, settings), stored, heldUntil: member.tierHeldUntil, now, holdDays: settings.tierHoldDays });
  if (next.tier !== stored || (next.heldUntil?.getTime() ?? null) !== (member.tierHeldUntil?.getTime() ?? null)) {
    await db.loyaltyMember.update({ where: { id: memberId }, data: { tier: next.tier, tierHeldUntil: next.heldUntil } });
  }
  return loyaltyTierDto({ tier: next.tier, heldUntil: next.heldUntil, spend, settings });
}
