import { Injectable } from "@nestjs/common";
import { DashboardFinanceDto, DashboardPeriodFiguresDto, DashboardTopProductDto, debtDateKey, directionIdOfSale, DirectionPnlRowDto, LocationType, ProductType, ProfitAndLossDto } from "@bakery-os/shared";
import { loadDirectionContext } from "../directions/direction-context";
import { OWN_ITEMS } from "../common/own-sales";
import { PrismaService } from "../prisma/prisma.service";
import { FinanceService } from "../finance/finance.service";
import { CashAccountsService } from "../finance/cash-accounts.service";
import { DebtsService } from "../debts/debts.service";
import { CostingService } from "../costing/costing.service";
import { startOfZonedDay } from "../common/zoned-day";
import { startOfZonedMonth } from "../common/month-ranges";
import { round2 } from "../common/money";

// The money side of the main screen (ТЗ §8.4). Every figure is read from the
// module that already owns it — the P&L for revenue and gross profit, the cash
// accounts for money, the debts reports for receivables/payables, the costing
// service for what the shelf is worth — so the dashboard can never disagree
// with the report it summarises.
@Injectable()
export class DashboardFinanceService {
  constructor(
    private prisma: PrismaService,
    private finance: FinanceService,
    private accounts: CashAccountsService,
    private debts: DebtsService,
    private costing: CostingService,
  ) {}

  // With a direction (ТЗ §8.4 «фильтр по направлению») the sales figures — revenue, gross
  // profit, margin and the top products — are that direction's, read from «Прибыль по
  // направлениям» by the same rule; money, debts and the shelf belong to points, not to a
  // direction, and stay as they are for the chosen point.
  async figures(organizationId: string, locationId?: string, now = new Date(), directionId?: string): Promise<DashboardFinanceDto> {
    const todayFrom = startOfZonedDay(now);
    const weekFrom = startOfZonedDay(now, 6);
    const monthFrom = startOfZonedMonth(debtDateKey(now).slice(0, 7));

    const [today, week, month, accounts, receivables, payables, finishedGoods] = await Promise.all([
      this.finance.getProfitAndLoss(organizationId, todayFrom, now, locationId),
      this.finance.getProfitAndLoss(organizationId, weekFrom, now, locationId),
      this.finance.getProfitAndLoss(organizationId, monthFrom, now, locationId),
      this.accounts.findAll(organizationId),
      this.debts.receivables(organizationId),
      this.debts.payables(organizationId),
      this.finishedGoods(organizationId, locationId),
    ]);

    // With a point chosen: its own accounts (its drawer, and the bank account its card money goes to).
    let shown = accounts;
    if (locationId) {
      const nonCash = await this.prisma.location.findUnique({ where: { id: locationId }, select: { nonCashAccountId: true } });
      shown = accounts.filter((a) => a.locationId === locationId || a.id === nonCash?.nonCashAccountId);
    }

    let todayFigures = period(today);
    let weekFigures = period(week);
    let monthFigures = period(month);
    let topProducts: DashboardTopProductDto[] = month.byProduct
      .filter((p) => p.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((p) => ({
        productId: p.productId,
        productName: p.productName,
        quantitySold: p.quantitySold,
        revenue: p.revenue,
        grossProfit: p.grossProfit,
        marginPercent: p.marginPercent,
      }));
    if (directionId) {
      const [dToday, dWeek, dMonth] = await Promise.all([
        this.finance.getPnlByDirection(organizationId, todayFrom, now, locationId),
        this.finance.getPnlByDirection(organizationId, weekFrom, now, locationId),
        this.finance.getPnlByDirection(organizationId, monthFrom, now, locationId),
      ]);
      const pick = (d: { rows: DirectionPnlRowDto[] }) => directionFigures(d.rows.find((r) => r.directionId === directionId));
      todayFigures = pick(dToday);
      weekFigures = pick(dWeek);
      monthFigures = pick(dMonth);
      topProducts = await this.topProductsOfDirection(organizationId, monthFrom, now, locationId, directionId);
    }

    return {
      locationId: locationId ?? null,
      directionId: directionId ?? null,
      today: todayFigures,
      week: weekFigures,
      month: monthFigures,
      cashTotal: round2(shown.reduce((s, a) => s + a.currentBalance, 0)),
      cashAccounts: shown.map((a) => ({ id: a.id, name: a.name, balance: a.currentBalance })).sort((a, b) => b.balance - a.balance),
      payables: { total: payables.total, overdue: payables.overdue },
      receivables: { total: receivables.total, overdue: receivables.overdue },
      finishedGoods,
      topProducts,
    };
  }

  // The month's best sellers of one direction: own goods on its sales less its returns, at the cost stamped on
  // each line (the P&L's own source), ranked by revenue.
  private async topProductsOfDirection(organizationId: string, from: Date, to: Date, locationId: string | undefined, directionId: string) {
    const where = { organizationId, ...(locationId ? { locationId } : {}) };
    const [ctx, items, returnItems] = await Promise.all([
      loadDirectionContext(this.prisma, organizationId),
      this.prisma.saleItem.findMany({
        where: { ...OWN_ITEMS, sale: { ...where, soldAt: { gte: from, lte: to } } },
        select: { productId: true, quantity: true, subtotal: true, unitCost: true, product: { select: { name: true } }, sale: { select: { crmOrderId: true, customerId: true, locationId: true } } },
      }),
      this.prisma.saleReturnItem.findMany({
        where: { ...OWN_ITEMS, saleReturn: { ...where, returnedAt: { gte: from, lte: to } } },
        select: { productId: true, quantity: true, subtotal: true, unitCost: true, product: { select: { name: true } }, saleReturn: { select: { sale: { select: { crmOrderId: true, customerId: true, locationId: true } } } } },
      }),
    ]);
    // Like the P&L: the cost stamped on the line, today's cost only for a line without one.
    const unstamped = [...new Set([...items, ...returnItems].filter((i) => i.unitCost === null).map((i) => i.productId))];
    const today = unstamped.length > 0 ? await this.costing.currentUnitCosts(organizationId, this.prisma, unstamped) : new Map();
    const acc = new Map<string, { name: string; quantity: number; revenue: number; cost: number }>();
    const add = (productId: string, name: string, sign: number, quantity: number, revenue: number, stamped: number | null) => {
      const row = acc.get(productId) ?? { name, quantity: 0, revenue: 0, cost: 0 };
      const unitCost = stamped ?? today.get(productId)?.unitCost ?? 0;
      row.quantity += sign * quantity;
      row.revenue += sign * revenue;
      row.cost += sign * quantity * unitCost;
      acc.set(productId, row);
    };
    for (const i of items) {
      if (directionIdOfSale(i.sale, ctx) !== directionId) continue;
      add(i.productId, i.product.name, 1, i.quantity.toNumber(), i.subtotal.toNumber(), i.unitCost?.toNumber() ?? null);
    }
    for (const i of returnItems) {
      if (directionIdOfSale(i.saleReturn.sale, ctx) !== directionId) continue;
      add(i.productId, i.product.name, -1, i.quantity.toNumber(), i.subtotal.toNumber(), i.unitCost?.toNumber() ?? null);
    }
    return [...acc]
      .filter(([, r]) => r.revenue > 0)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([productId, r]) => {
        const gross = round2(r.revenue - r.cost);
        return {
          productId,
          productName: r.name,
          quantitySold: Math.round(r.quantity * 1000) / 1000,
          revenue: round2(r.revenue),
          grossProfit: gross,
          marginPercent: r.revenue > 0 ? round2((gross / r.revenue) * 100) : null,
        };
      });
  }

  // Our own finished goods on a shop's shelf, at cost and at the shop's price.
  private async finishedGoods(organizationId: string, locationId?: string) {
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        organizationId,
        quantity: { gt: 0 },
        product: { type: ProductType.FINISHED_GOOD, consignmentSupplierId: null },
        location: locationId ? { id: locationId } : { type: LocationType.STORE, isActive: true },
      },
      select: { locationId: true, productId: true, quantity: true, product: { select: { price: true } } },
    });
    const ids = [...new Set(levels.map((l) => l.productId))];
    const [costs, pointPrices] = await Promise.all([
      this.costing.currentUnitCosts(organizationId, this.prisma, ids),
      this.prisma.productLocationPrice.findMany({ where: { organizationId, productId: { in: ids } }, select: { productId: true, locationId: true, price: true } }),
    ]);
    const priceAt = new Map(pointPrices.map((p) => [`${p.locationId}:${p.productId}`, p.price.toNumber()]));
    let atCost = 0;
    let atSalePrice = 0;
    let unknownCostItems = 0;
    for (const l of levels) {
      const q = l.quantity.toNumber();
      const cost = costs.get(l.productId)?.unitCost;
      if (cost === undefined || cost === null) unknownCostItems += 1;
      else atCost += cost * q;
      atSalePrice += (priceAt.get(`${l.locationId}:${l.productId}`) ?? l.product.price.toNumber()) * q;
    }
    return { atCost: round2(atCost), atSalePrice: round2(atSalePrice), unknownCostItems };
  }
}

function period(p: ProfitAndLossDto): DashboardPeriodFiguresDto {
  return { netRevenue: p.netRevenue, grossProfit: p.grossProfit, grossMarginPercent: p.grossMarginPercent };
}

function directionFigures(row: DirectionPnlRowDto | undefined): DashboardPeriodFiguresDto {
  if (!row) return { netRevenue: 0, grossProfit: 0, grossMarginPercent: null };
  return { netRevenue: row.netRevenue, grossProfit: row.grossProfit, grossMarginPercent: row.grossMarginPercent };
}
