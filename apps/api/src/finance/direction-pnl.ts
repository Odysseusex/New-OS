import {
  ExpenseStatus,
  PnlLine,
  BUSINESS_DIRECTION_ORDER,
  BusinessDirection,
  businessDirectionOf,
  DirectionPnlDto,
  DirectionPnlRowDto,
  ProfitAndLossDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { round2 } from "../common/money";
import { CostingService } from "../costing/costing.service";
import { cogsDeltaOf, correctionsInRange } from "./cost-correction/stored";
import { expenseAccrualEffect } from "./events/rules";

type Weights = Map<BusinessDirection, number>;

// Splits `total` across directions in proportion to `weights` (non-negative),
// to the тиын, so the parts always add up to exactly the total: the rounding
// remainder goes to the direction with the largest weight.
export function allocate(total: number, weights: Weights): Map<BusinessDirection, number> {
  const out = new Map<BusinessDirection, number>(BUSINESS_DIRECTION_ORDER.map((d) => [d, 0]));
  const sum = BUSINESS_DIRECTION_ORDER.reduce((s, d) => s + Math.max(weights.get(d) ?? 0, 0), 0);
  if (!(sum > 0) || total === 0) return out;
  let given = 0;
  let largest = BUSINESS_DIRECTION_ORDER[0];
  for (const d of BUSINESS_DIRECTION_ORDER) {
    const w = Math.max(weights.get(d) ?? 0, 0);
    if (w > Math.max(weights.get(largest) ?? 0, 0)) largest = d;
    const part = round2((total * w) / sum);
    out.set(d, part);
    given += part;
  }
  out.set(largest, round2((out.get(largest) ?? 0) + total - given));
  return out;
}

// P&L by business direction (опт / розница / заказы). Revenue and cost of goods
// are each direction's own, read from its sales and returns exactly the way the
// P&L reads them, and so is an expense booked to a direction (Expense.direction) (own goods only, the cost stamped on the line, today's cost
// only for a line without one). A month-end cost correction moves a product's
// cost of goods in proportion to how much of it each direction sold. Everything
// the business spends in common — inventory losses, operating expenses,
// depreciation, the other result and the recorded income tax — is allocated by
// each direction's share of net revenue (the owner's decision). The totals are
// the period's P&L itself, so the directions always add up to it.
export async function buildDirectionPnl(
  prisma: PrismaService,
  costing: CostingService,
  pnl: ProfitAndLossDto,
  organizationId: string,
  from: Date,
  to: Date,
  locationId?: string,
): Promise<DirectionPnlDto> {
  const where = { organizationId, ...(locationId ? { locationId } : {}) };
  const [sales, returns, currentCosts, corrections, directExpenses] = await Promise.all([
    prisma.sale.findMany({
      where: { ...where, soldAt: { gte: from, lte: to } },
      select: {
        customerId: true,
        crmOrderId: true,
        totalAmount: true,
        consignmentAmount: true,
        items: { select: { productId: true, quantity: true, unitCost: true, consignmentUnitCost: true, consignmentSupplierId: true } },
      },
    }),
    prisma.saleReturn.findMany({
      where: { ...where, returnedAt: { gte: from, lte: to } },
      select: {
        restocked: true,
        totalAmount: true,
        consignmentAmount: true,
        sale: { select: { customerId: true, crmOrderId: true } },
        items: { select: { productId: true, quantity: true, unitCost: true, consignmentUnitCost: true, consignmentSupplierId: true } },
      },
    }),
    costing.currentUnitCosts(organizationId),
    locationId ? Promise.resolve([]) : correctionsInRange(prisma, organizationId, from, to),
    // Expenses booked wholly to one direction — chosen exactly like the P&L's own.
    prisma.expense.findMany({
      where: {
        organizationId,
        status: ExpenseStatus.CONFIRMED,
        incurredOn: { gte: from, lte: to },
        direction: { not: null },
        ...(locationId ? { OR: [{ locationId }, { locationId: null }] } : {}),
      },
      select: { amount: true, direction: true, categoryRef: true },
    }),
  ]);

  const costOf = (snapshot: { toNumber: () => number } | null, consignment: { toNumber: () => number } | null, productId: string) =>
    snapshot ? snapshot.toNumber() : consignment ? consignment.toNumber() : (currentCosts.get(productId)?.unitCost ?? null);

  const acc = new Map(BUSINESS_DIRECTION_ORDER.map((d) => [d, { checks: 0, revenue: 0, cogs: 0 }]));
  // Net quantity of each product sold per direction, for the cost correction.
  const soldQty = new Map<string, Map<BusinessDirection, number>>();
  const addQty = (productId: string, d: BusinessDirection, q: number) => {
    let m = soldQty.get(productId);
    if (!m) soldQty.set(productId, (m = new Map()));
    m.set(d, (m.get(d) ?? 0) + q);
  };

  for (const sale of sales) {
    const d = businessDirectionOf(sale);
    const a = acc.get(d)!;
    const own = sale.totalAmount.toNumber() - sale.consignmentAmount.toNumber();
    a.revenue += own;
    // A basket of somebody else's goods only is not one of our sales.
    if (own > 0) a.checks += 1;
    for (const item of sale.items) {
      if (item.consignmentSupplierId) continue;
      const q = item.quantity.toNumber();
      const unit = costOf(item.unitCost, item.consignmentUnitCost, item.productId);
      if (unit !== null) a.cogs += round2(unit * q);
      addQty(item.productId, d, q);
    }
  }
  for (const ret of returns) {
    const d = businessDirectionOf(ret.sale);
    const a = acc.get(d)!;
    a.revenue -= ret.totalAmount.toNumber() - ret.consignmentAmount.toNumber();
    for (const item of ret.items) {
      if (item.consignmentSupplierId) continue;
      const q = item.quantity.toNumber();
      addQty(item.productId, d, -q);
      if (!ret.restocked) continue;
      const unit = costOf(item.unitCost, item.consignmentUnitCost, item.productId);
      if (unit !== null) a.cogs -= round2(unit * q);
    }
  }

  // Cost corrections: by each direction's share of the product sold, else by
  // its share of cost of goods.
  const cogsWeights: Weights = new Map(BUSINESS_DIRECTION_ORDER.map((d) => [d, acc.get(d)!.cogs]));
  for (const correction of corrections) {
    for (const line of correction.lines) {
      const delta = cogsDeltaOf(line);
      if (delta === 0) continue;
      const qty = soldQty.get(line.productId);
      const byQty: Weights = new Map(BUSINESS_DIRECTION_ORDER.map((d) => [d, qty?.get(d) ?? 0]));
      const hasQty = BUSINESS_DIRECTION_ORDER.some((d) => (byQty.get(d) ?? 0) > 0);
      for (const [d, part] of allocate(delta, hasQty ? byQty : cogsWeights)) acc.get(d)!.cogs += part;
    }
  }

  // The directions' own figures, made to add up to the P&L to the тиын.
  const revenueParts = exactParts(pnl.netRevenue, new Map(BUSINESS_DIRECTION_ORDER.map((d) => [d, acc.get(d)!.revenue])));
  const cogsParts = exactParts(pnl.cogs, new Map(BUSINESS_DIRECTION_ORDER.map((d) => [d, acc.get(d)!.cogs])));

  // Direct costs: an operating expense goes to operating expenses, an other or
  // financial expense to the other result — the same place the P&L puts it.
  const directOp = new Map<BusinessDirection, number>(BUSINESS_DIRECTION_ORDER.map((d) => [d, 0]));
  const directOther = new Map<BusinessDirection, number>(BUSINESS_DIRECTION_ORDER.map((d) => [d, 0]));
  for (const e of directExpenses) {
    const d = e.direction as BusinessDirection;
    const amount = e.amount.toNumber();
    const line = expenseAccrualEffect(e.categoryRef).pnlLine;
    if (line === PnlLine.OPERATING_EXPENSE) directOp.set(d, round2(directOp.get(d)! + amount));
    else if (line === PnlLine.OTHER_EXPENSE || line === PnlLine.FINANCIAL_EXPENSE) directOther.set(d, round2(directOther.get(d)! - amount));
  }
  const sumOf = (m: Map<BusinessDirection, number>) => round2(BUSINESS_DIRECTION_ORDER.reduce((s, d) => s + m.get(d)!, 0));

  const share: Weights = new Map(BUSINESS_DIRECTION_ORDER.map((d) => [d, Math.max(revenueParts.get(d)!, 0)]));
  const shareBase = BUSINESS_DIRECTION_ORDER.reduce((s, d) => s + share.get(d)!, 0);
  const allocated = shareBase > 0;
  const losses = allocate(pnl.inventoryLosses, share);
  const expenses = allocate(round2(pnl.expensesTotal - sumOf(directOp)), share);
  const depreciation = allocate(pnl.depreciation, share);
  const other = allocate(round2(pnl.otherResult - sumOf(directOther)), share);
  const tax = pnl.incomeTax === null ? null : allocate(pnl.incomeTax, share);

  const rows: DirectionPnlRowDto[] = BUSINESS_DIRECTION_ORDER.map((d) => {
    const netRevenue = revenueParts.get(d)!;
    const cogs = cogsParts.get(d)!;
    const grossProfit = round2(netRevenue - cogs);
    const inventoryLosses = losses.get(d)!;
    const exp = round2(expenses.get(d)! + directOp.get(d)!);
    const dep = depreciation.get(d)!;
    const operatingProfit = round2(grossProfit - inventoryLosses - exp - dep);
    const otherResult = round2(other.get(d)! + directOther.get(d)!);
    const incomeTax = tax ? tax.get(d)! : null;
    return {
      direction: d,
      checks: acc.get(d)!.checks,
      netRevenue,
      cogs,
      grossProfit,
      grossMarginPercent: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : null,
      revenueSharePercent: allocated ? (share.get(d)! / shareBase) * 100 : null,
      inventoryLosses,
      expenses: exp,
      directExpenses: directOp.get(d)!,
      depreciation: dep,
      operatingProfit,
      otherResult,
      incomeTax,
      netProfit: round2(operatingProfit + otherResult - (incomeTax ?? 0)),
    };
  });

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    total: {
      checks: rows.reduce((s, r) => s + r.checks, 0),
      netRevenue: pnl.netRevenue,
      cogs: pnl.cogs,
      grossProfit: pnl.grossProfit,
      grossMarginPercent: pnl.grossMarginPercent,
      inventoryLosses: pnl.inventoryLosses,
      expenses: pnl.expensesTotal,
      directExpenses: sumOf(directOp),
      depreciation: pnl.depreciation,
      operatingProfit: pnl.operatingProfit,
      otherResult: pnl.otherResult,
      incomeTax: pnl.incomeTax,
      netProfit: pnl.netProfit,
    },
    allocated,
    netProfitStatus: pnl.netProfitStatus,
  };
}

// Each direction's own amount rounded, with the rounding difference against the
// P&L's total (a few тиын at most) put on the largest one.
function exactParts(total: number, raw: Weights): Map<BusinessDirection, number> {
  const out = new Map<BusinessDirection, number>();
  let sum = 0;
  let largest = BUSINESS_DIRECTION_ORDER[0];
  for (const d of BUSINESS_DIRECTION_ORDER) {
    const v = round2(raw.get(d) ?? 0);
    out.set(d, v);
    sum += v;
    if (Math.abs(v) > Math.abs(out.get(largest)!)) largest = d;
  }
  out.set(largest, round2(out.get(largest)! + total - sum));
  return out;
}
