import { Injectable } from "@nestjs/common";
import { DashboardFinanceDto, DashboardPeriodFiguresDto, debtDateKey, LocationType, ProductType, ProfitAndLossDto } from "@bakery-os/shared";
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

  async figures(organizationId: string, locationId?: string, now = new Date()): Promise<DashboardFinanceDto> {
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

    return {
      locationId: locationId ?? null,
      today: period(today),
      week: period(week),
      month: period(month),
      cashTotal: round2(shown.reduce((s, a) => s + a.currentBalance, 0)),
      cashAccounts: shown.map((a) => ({ id: a.id, name: a.name, balance: a.currentBalance })).sort((a, b) => b.balance - a.balance),
      payables: { total: payables.total, overdue: payables.overdue },
      receivables: { total: receivables.total, overdue: receivables.overdue },
      finishedGoods,
      topProducts: month.byProduct
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
        })),
    };
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
