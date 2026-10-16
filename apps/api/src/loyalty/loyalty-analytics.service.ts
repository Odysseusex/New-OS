import { BadRequestException, Injectable } from "@nestjs/common";
import { DEFAULT_LOYALTY_CHURN_SETTINGS, LoyaltyAnalyticsDto, LoyaltyChurnSettings, LoyaltyMemberStatus } from "@bakery-os/shared";
import { ownAmount } from "../common/own-sales";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsMember, computeLoyaltyAnalytics, RFM_WINDOW_DAYS } from "./analytics";

const REPORTING_TIME_ZONE = "Asia/Almaty";
const dateKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const MAX_MERGE_HOPS = 10;

// Reads sales with an attached member and hands them to the pure calculation.
// Revenue here is ours only (consignment goods and returns taken off), like every
// other analytics figure in the app.
@Injectable()
export class LoyaltyAnalyticsService {
  constructor(private prisma: PrismaService) {}

  async analytics(organizationId: string, from: Date, to: Date, churn: Partial<LoyaltyChurnSettings>): Promise<LoyaltyAnalyticsDto> {
    if (!(from < to)) throw new BadRequestException("Неверный период");
    const settings = { ...DEFAULT_LOYALTY_CHURN_SETTINGS, ...Object.fromEntries(Object.entries(churn).filter(([, v]) => v !== undefined)) } as LoyaltyChurnSettings;
    for (const value of Object.values(settings)) {
      if (!Number.isInteger(value) || value < 1 || value > 730) throw new BadRequestException("Параметры радара — целые числа от 1 до 730");
    }
    // History far enough back for the year of RFM, the radar window and six monthly cohorts.
    const historyFrom = new Date(Math.min(from.getTime(), to.getTime() - Math.max(RFM_WINDOW_DAYS, settings.windowDays, 190) * 86_400_000));

    const [memberRows, memberSales, anonymousSales] = await Promise.all([
      this.prisma.loyaltyMember.findMany({
        where: { organizationId },
        select: { id: true, phone: true, name: true, status: true, mergedIntoId: true },
      }),
      this.prisma.sale.findMany({
        where: { organizationId, loyaltyMemberId: { not: null }, soldAt: { gte: historyFrom, lte: to } },
        select: {
          loyaltyMemberId: true,
          soldAt: true,
          totalAmount: true,
          consignmentAmount: true,
          returns: { select: { totalAmount: true, consignmentAmount: true } },
        },
      }),
      // Anonymous retail: no member and no wholesale customer.
      this.prisma.sale.findMany({
        where: { organizationId, loyaltyMemberId: null, customerId: null, soldAt: { gte: from, lte: to } },
        select: { totalAmount: true, consignmentAmount: true, returns: { select: { totalAmount: true, consignmentAmount: true } } },
      }),
    ]);

    // A merged duplicate's sales count for the record it was merged into.
    const byId = new Map(memberRows.map((m) => [m.id, m]));
    const finalId = (id: string) => {
      let current = id;
      for (let hop = 0; hop < MAX_MERGE_HOPS; hop += 1) {
        const next = byId.get(current)?.mergedIntoId;
        if (!next) break;
        current = next;
      }
      return current;
    };
    const members = new Map<string, AnalyticsMember>(
      memberRows
        .filter((m) => m.status !== LoyaltyMemberStatus.MERGED)
        .map((m) => [m.id, { id: m.id, phone: m.phone, name: m.name, contactable: m.status === LoyaltyMemberStatus.ACTIVE }]),
    );

    const net = (sale: { totalAmount: { toNumber(): number }; consignmentAmount: { toNumber(): number }; returns: { totalAmount: { toNumber(): number }; consignmentAmount: { toNumber(): number } }[] }) =>
      ownAmount(sale) - sale.returns.reduce((s, r) => s + ownAmount(r), 0);

    // A basket made only of consignment goods is not one of our sales.
    const visits = memberSales
      .filter((s) => ownAmount(s) > 0)
      .map((s) => ({ memberId: finalId(s.loyaltyMemberId as string), at: s.soldAt, amount: net(s) }));
    const anonymousOwn = anonymousSales.filter((s) => ownAmount(s) > 0);

    return computeLoyaltyAnalytics({
      from,
      to,
      visits,
      members,
      anonymous: { visits: anonymousOwn.length, revenue: anonymousOwn.reduce((s, sale) => s + net(sale), 0) },
      churn: settings,
      dateKey: (d) => dateKeyFormat.format(d),
    });
  }
}
