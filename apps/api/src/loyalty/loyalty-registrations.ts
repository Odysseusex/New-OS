import { LoyaltyConsentPurpose, LoyaltyConsentSource, LoyaltyMemberStatus } from "@prisma/client";
import type {
  LoyaltyRegistrationCashierDto,
  LoyaltyRegistrationCountsDto,
  LoyaltyRegistrationDayDto,
  LoyaltyRegistrationsDto,
} from "@bakery-os/shared";
import type { PrismaService } from "../prisma/prisma.service";

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" });
const almatyDay = (d: Date) => dayFormat.format(d);

const NO_PURCHASE = "none";
const OTHER = "other";

const empty = (): LoyaltyRegistrationCountsDto => ({ total: 0, viaApp: 0, atTill: 0, withAppNow: 0 });

// New members of the period and who brought them. Read-only.
export async function loyaltyRegistrations(
  prisma: PrismaService,
  organizationId: string,
  from: Date,
  to: Date,
): Promise<LoyaltyRegistrationsDto> {
  const members = await prisma.loyaltyMember.findMany({
    where: { organizationId, createdAt: { gte: from, lte: to }, status: { not: LoyaltyMemberStatus.MERGED } },
    select: {
      id: true,
      createdAt: true,
      createdById: true,
      consents: {
        where: { purpose: LoyaltyConsentPurpose.PERSONAL_DATA },
        orderBy: { recordedAt: "asc" },
        take: 1,
        select: { source: true },
      },
    },
  });
  const ids = members.map((m) => m.id);

  const [firstSales, sessions] = ids.length
    ? await Promise.all([
        prisma.sale.findMany({
          where: { organizationId, loyaltyMemberId: { in: ids } },
          orderBy: { soldAt: "asc" },
          distinct: ["loyaltyMemberId"],
          select: { loyaltyMemberId: true, createdById: true },
        }),
        prisma.clubLoginRequest.findMany({
          where: { memberId: { in: ids }, status: { in: ["USED", "REVOKED"] } },
          distinct: ["memberId"],
          select: { memberId: true },
        }),
      ])
    : [[], []];
  const firstCashier = new Map<string, string>(firstSales.map((s) => [s.loyaltyMemberId as string, s.createdById] as const));
  const inApp = new Set(sessions.map((s) => s.memberId as string));

  const byCashier = new Map<string, LoyaltyRegistrationCountsDto>();
  const byDay = new Map<string, LoyaltyRegistrationCountsDto>();
  const totals = empty();
  const add = (map: Map<string, LoyaltyRegistrationCountsDto>, key: string) => {
    const row = map.get(key) ?? empty();
    map.set(key, row);
    return row;
  };

  for (const m of members) {
    const source = m.consents[0]?.source ?? null;
    const viaApp = source === LoyaltyConsentSource.CUSTOMER_APP;
    const atTill = source === LoyaltyConsentSource.AT_TILL;
    const key = viaApp ? (firstCashier.get(m.id) ?? NO_PURCHASE) : atTill && m.createdById ? m.createdById : OTHER;
    for (const row of [totals, add(byCashier, key), add(byDay, almatyDay(m.createdAt))]) {
      row.total += 1;
      if (viaApp) row.viaApp += 1;
      if (atTill) row.atTill += 1;
      if (inApp.has(m.id)) row.withAppNow += 1;
    }
  }

  const userIds = [...byCashier.keys()].filter((k) => k !== NO_PURCHASE && k !== OTHER);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  const cashiers: LoyaltyRegistrationCashierDto[] = [...byCashier.entries()]
    .map(([key, row]) => ({
      key,
      name: key === NO_PURCHASE ? "Ещё без покупки" : key === OTHER ? "Другое (вручную, импорт)" : (names.get(key) ?? "Сотрудник удалён"),
      ...row,
    }))
    .sort((a, b) => Number(a.key === NO_PURCHASE || a.key === OTHER) - Number(b.key === NO_PURCHASE || b.key === OTHER) || b.total - a.total);
  const days: LoyaltyRegistrationDayDto[] = [...byDay.entries()]
    .map(([day, row]) => ({ day, ...row }))
    .sort((a, b) => b.day.localeCompare(a.day));

  return { from: from.toISOString(), to: to.toISOString(), totals, cashiers, days };
}
