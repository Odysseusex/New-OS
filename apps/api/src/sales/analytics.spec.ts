import { PaymentMethod, ProductType, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CashMovementsService } from "../finance/cash-movements.service";
import { FinanceService } from "../finance/finance.service";
import { FiscalService } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { FakeFiscalProvider } from "../fiscal/fake-fiscal.provider";
import { SalesService } from "./sales.service";
import { AuthenticatedUser } from "../auth/auth.types";

// Runs against the real database like the other money specs, and shares the
// demo org with them — see the maxWorkers note in sales-fiscal.spec.ts. Every
// assertion here is about THIS spec's own fixture rows, never an org-wide
// count, so a neighbouring suite's fixtures cannot move these numbers.
const prisma = new PrismaService();

const ORG = "demo-org";
let user: AuthenticatedUser;
let locationId: string;
// Three products with deliberately different economics, so ABC has something
// real to separate: a big earner, a middling one, and a high-turnover product
// that barely makes anything.
let earnerId: string;
let middleId: string;
let thinId: string;
// A product with neither recipe nor purchase history — must be excluded from
// the totals rather than costed at zero.
let uncostableId: string;
const saleIds: string[] = [];
const productIds: string[] = [];
const stamp = Date.now();

function services() {
  const cash = new CashMovementsService(prisma);
  const fiscal = new FiscalService(prisma, new FakeFiscalProvider(), new FiscalSettings());
  return {
    sales: new SalesService(prisma, cash, fiscal, new FiscalSettings()),
    finance: new FinanceService(prisma, cash),
  };
}

// Gives a product a cost by way of a purchase order, which is the fallback
// path in resolveProductUnitCosts — cheaper to set up here than a recipe, and
// it exercises the branch a bought-in good actually takes.
async function giveCost(productId: string, unitCost: number, supplierId: string) {
  const po = await prisma.purchaseOrder.create({
    data: {
      organizationId: ORG,
      supplierId,
      locationId,
      totalCost: unitCost * 10,
      createdById: user.id,
    },
  });
  await prisma.purchaseOrderItem.create({
    data: {
      purchaseOrderId: po.id,
      productId,
      quantity: 10,
      unitCost,
      subtotal: unitCost * 10,
    },
  });
  return po.id;
}

const poIds: string[] = [];
let supplierId: string;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;

  const location = await prisma.location.findFirst({ where: { organizationId: ORG, lat: { not: null } } });
  const owner = await prisma.user.findFirst({ where: { organizationId: ORG, role: Role.OWNER } });
  if (!location || !owner) throw new Error("Demo data missing — seed the local database first");
  locationId = location.id;
  user = { id: owner.id, organizationId: ORG, role: owner.role, locationId: null } as AuthenticatedUser;

  const supplier = await prisma.supplier.create({
    data: { organizationId: ORG, name: `Аналитика тест ${stamp}` },
  });
  supplierId = supplier.id;

  const makeProduct = async (name: string, price: number) => {
    const p = await prisma.product.create({
      data: {
        organizationId: ORG,
        name: `${name} ${stamp}`,
        sku: `ANALYTICS-${name}-${stamp}`,
        unit: Unit.PCS,
        type: ProductType.FINISHED_GOOD,
        price,
        trackInventory: false,
      },
    });
    productIds.push(p.id);
    return p.id;
  };

  // Sells 1000, costs 200 → margin 800/unit.
  earnerId = await makeProduct("Крупный", 1000);
  // Sells 500, costs 300 → margin 200/unit.
  middleId = await makeProduct("Средний", 500);
  // Sells 100, costs 95 → margin 5/unit, even though it moves in volume.
  thinId = await makeProduct("Тонкий", 100);
  // No cost data at all.
  uncostableId = await makeProduct("Безсебеса", 700);

  poIds.push(await giveCost(earnerId, 200, supplierId));
  poIds.push(await giveCost(middleId, 300, supplierId));
  poIds.push(await giveCost(thinId, 95, supplierId));
});

afterAll(async () => {
  // Cleanup in `finally`-style order so a failed assertion above still leaves
  // the demo org as it was found.
  try {
    await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.cashMovement.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
    await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
  } finally {
    await prisma.$disconnect();
  }
});

async function sell(lines: { productId: string; quantity: number; unitPrice: number; fullUnitPrice?: number }[]) {
  const sale = await services().sales.create(user, {
    locationId,
    paymentMethod: PaymentMethod.CASH,
    items: lines,
  });
  saleIds.push(sale.id);
  return sale;
}

describe("product profitability", () => {
  let from: Date;
  let to: Date;

  beforeAll(async () => {
    from = new Date(Date.now() - 60_000);
    // One of each earner, four of the thin product — so the thin one leads on
    // units sold and still cannot lead on money earned.
    await sell([
      { productId: earnerId, quantity: 1, unitPrice: 1000 },
      { productId: middleId, quantity: 1, unitPrice: 500 },
      { productId: thinId, quantity: 4, unitPrice: 100 },
      { productId: uncostableId, quantity: 1, unitPrice: 700 },
    ]);
    to = new Date(Date.now() + 60_000);
  });

  const rowsOfMine = async () => {
    const report = await services().sales.productProfitability(user, from, to);
    const mine = new Set([earnerId, middleId, thinId, uncostableId]);
    return { report, rows: report.rows.filter((r) => mine.has(r.productId)) };
  };

  it("computes margin per product from the same cost the P&L charges", async () => {
    const { rows } = await rowsOfMine();
    const earner = rows.find((r) => r.productId === earnerId)!;
    expect(earner.revenue).toBe(1000);
    expect(earner.cost).toBe(200);
    expect(earner.margin).toBe(800);
    expect(earner.marginPercent).toBe(80);

    const thin = rows.find((r) => r.productId === thinId)!;
    expect(thin.quantity).toBe(4);
    expect(thin.revenue).toBe(400);
    expect(thin.cost).toBe(380);
    expect(thin.margin).toBe(20);
    expect(thin.marginPercent).toBe(5);
  });

  it("ranks by margin, so volume alone does not put a product on top", async () => {
    const { rows } = await rowsOfMine();
    // The thin product sold the most units of the four; it must still rank
    // below both of the products that actually earned more money.
    expect(rows.map((r) => r.productId).indexOf(earnerId)).toBeLessThan(
      rows.map((r) => r.productId).indexOf(thinId),
    );
    expect(rows.map((r) => r.productId).indexOf(middleId)).toBeLessThan(
      rows.map((r) => r.productId).indexOf(thinId),
    );
  });

  it("puts the biggest earners in class A and the trailing ones in C", async () => {
    const { rows } = await rowsOfMine();
    expect(rows.find((r) => r.productId === earnerId)!.abcClass).toBe("A");
    // 20 out of the 1020 my fixtures earned is well past the 95% line.
    expect(rows.find((r) => r.productId === thinId)!.abcClass).toBe("C");
  });

  it("keeps the product that carries the total past 80% in class A", async () => {
    const { rows } = await rowsOfMine();
    // The middle product earns ~20% of my fixtures' margin, arriving second.
    // Classified on the cumulative total AFTER adding it, it would be past
    // 95% and land in C — which is the off-by-one this asserts against, and
    // the reason a product earning a fifth of the money was being filed as
    // negligible.
    expect(rows.find((r) => r.productId === middleId)!.abcClass).toBe("A");
  });

  it("excludes a product it cannot cost instead of calling its cost zero", async () => {
    const { report, rows } = await rowsOfMine();
    const uncostable = rows.find((r) => r.productId === uncostableId)!;
    expect(uncostable.hasCostData).toBe(false);
    expect(uncostable.margin).toBe(0);
    // The tell that it was excluded rather than treated as free money: a zero
    // cost would have made this a 100% margin and given it an ABC class.
    expect(uncostable.marginPercent).toBeNull();
    expect(uncostable.abcClass).toBeNull();
    expect(report.revenueWithoutCostData).toBeGreaterThanOrEqual(700);
    expect(report.productsWithoutCostData).toBeGreaterThanOrEqual(1);
  });

  it("reports the markdown a product was sold at as margin given away", async () => {
    // Its own product rather than a narrow time window: the other fixtures
    // are seconds old, and a window tight enough to exclude them is tight
    // enough to be flaky.
    const marked = await prisma.product.create({
      data: {
        organizationId: ORG,
        name: `Уценённый ${stamp}`,
        sku: `ANALYTICS-MARKDOWN-${stamp}`,
        unit: Unit.PCS,
        type: ProductType.FINISHED_GOOD,
        price: 1000,
        trackInventory: false,
      },
    });
    productIds.push(marked.id);
    poIds.push(await giveCost(marked.id, 200, supplierId));

    await sell([{ productId: marked.id, quantity: 1, unitPrice: 600, fullUnitPrice: 1000 }]);
    const report = await services().sales.productProfitability(user, from, new Date(Date.now() + 60_000));
    const row = report.rows.find((r) => r.productId === marked.id)!;
    expect(row.markdownQuantity).toBe(1);
    expect(row.markdownLoss).toBe(400);
    // Margin follows what was actually taken, not the list price.
    expect(row.revenue).toBe(600);
    expect(row.margin).toBe(400);
  });
});

describe("sales dynamics", () => {
  it("fills every calendar day in range, so a quiet day reads as zero", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);
    const result = await services().sales.dynamics(user, from, to);
    expect(result.points).toHaveLength(7);
    expect(result.points.every((p) => typeof p.revenue === "number")).toBe(true);
    // A day with no sales has no average ticket — an average of nothing is
    // not zero, and charting it as zero would be a lie.
    for (const point of result.points) {
      if (point.salesCount === 0) expect(point.averageTicket).toBeNull();
    }
  });

  it("buckets by hour and weekday without losing or inventing sales", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);
    const result = await services().sales.dynamics(user, from, to);
    const hourTotal = result.byHour.reduce((sum, h) => sum + h.salesCount, 0);
    const weekdayTotal = result.byWeekday.reduce((sum, d) => sum + d.salesCount, 0);
    const pointTotal = result.points.reduce((sum, p) => sum + p.salesCount, 0);
    expect(hourTotal).toBe(result.totalSalesCount);
    expect(weekdayTotal).toBe(result.totalSalesCount);
    expect(pointTotal).toBe(result.totalSalesCount);
    expect(result.byHour).toHaveLength(24);
    expect(result.byWeekday).toHaveLength(7);
    expect(result.byWeekday.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("counts how many times each weekday fell in the period", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 13 * 86_400_000);
    const result = await services().sales.dynamics(user, from, to);
    // Fourteen days is exactly two of each weekday, so no weekday can look
    // better than another purely by occurring more often.
    expect(result.byWeekday.every((d) => d.occurrences === 2)).toBe(true);
  });
});

describe("cash flow (ДДС)", () => {
  it("reconciles: opening + inflow − outflow equals closing", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const flow = await services().finance.getCashFlow(ORG, from, to);
    expect(flow.closingBalance).toBeCloseTo(flow.openingBalance + flow.totalInflow - flow.totalOutflow, 2);
    expect(flow.netFlow).toBeCloseTo(flow.totalInflow - flow.totalOutflow, 2);
  });

  it("sees a sale of mine as an inflow of exactly that amount", async () => {
    const from = new Date(Date.now() - 1000);
    const before = await services().finance.getCashFlow(ORG, from, new Date());
    await sell([{ productId: earnerId, quantity: 1, unitPrice: 1000 }]);
    const after = await services().finance.getCashFlow(ORG, from, new Date(Date.now() + 60_000));
    expect(after.totalInflow - before.totalInflow).toBeCloseTo(1000, 2);
  });

  it("splits inflow and outflow into named types that add back up to the totals", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const flow = await services().finance.getCashFlow(ORG, from, to);
    const inflowSum = flow.inflowByType.reduce((sum, l) => sum + l.amount, 0);
    const outflowSum = flow.outflowByType.reduce((sum, l) => sum + l.amount, 0);
    expect(inflowSum).toBeCloseTo(flow.totalInflow, 2);
    expect(outflowSum).toBeCloseTo(flow.totalOutflow, 2);
    expect(flow.inflowByType.every((l) => l.label.length > 0)).toBe(true);
  });

  it("never reports today's balance for a period that ended in the past", async () => {
    // A window entirely before this spec's own sales: its closing balance must
    // not have moved just because money arrived afterwards.
    const to = new Date(Date.now() - 10 * 86_400_000);
    const from = new Date(to.getTime() - 86_400_000);
    const first = await services().finance.getCashFlow(ORG, from, to);
    await sell([{ productId: earnerId, quantity: 1, unitPrice: 1000 }]);
    const second = await services().finance.getCashFlow(ORG, from, to);
    expect(second.closingBalance).toBeCloseTo(first.closingBalance, 2);
  });
});
