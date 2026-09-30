import { ModelDriversDto, PaymentMethod, PlanMetric } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { FinancialPeriodsService } from "../finance/periods/periods.service";
import { FinancialEventProjector } from "../finance/events/projector";
import { monthOf, monthRange } from "../common/reporting-period";
import { PlanningService } from "./planning.service";
import { classifyAbc, classifyXyz, coefficientOfVariation } from "./abc-xyz";
import { planReplenishment } from "./replenishment";
import { forecast, validateDrivers } from "./forecast";

// Management layer: analytics, plan vs fact, deterministic forecast. It reads
// the books and writes only its own tables.

describe("ABC classification", () => {
  it("80 / 15 / 5 by cumulative revenue; the item that crosses a line stays in the class it started in", () => {
    const rows = classifyAbc([
      { id: "a", revenue: 6000 },
      { id: "b", revenue: 2500 },
      { id: "c", revenue: 1000 },
      { id: "d", revenue: 400 },
      { id: "e", revenue: 100 },
    ]);
    expect(rows.map((r) => [r.id, r.abcClass])).toEqual([["a", "A"], ["b", "A"], ["c", "B"], ["d", "C"], ["e", "C"]]);
    expect(rows[0]).toMatchObject({ share: 60, cumulativeShare: 60 });
    expect(rows[4].cumulativeShare).toBe(100);
  });

  it("is deterministic on ties and puts zero-revenue products in C", () => {
    const a = classifyAbc([{ id: "y", revenue: 100 }, { id: "x", revenue: 100 }, { id: "z", revenue: 0 }]);
    const b = classifyAbc([{ id: "z", revenue: 0 }, { id: "x", revenue: 100 }, { id: "y", revenue: 100 }]);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(a.find((r) => r.id === "z")?.abcClass).toBe("C");
  });
});

describe("XYZ classification", () => {
  it("measures instability including empty weeks; too little data is not classified", () => {
    expect(coefficientOfVariation([10, 10, 10, 10])).toBe(0);
    const bursty = coefficientOfVariation([40, 0, 0, 0, 40, 0, 0, 0])!;
    expect(bursty).toBeGreaterThan(25);
    expect(classifyXyz(0, 8)).toBe("X");
    expect(classifyXyz(18, 8)).toBe("Y");
    expect(classifyXyz(bursty, 2)).toBeNull(); // sold in only 2 weeks: not enough to judge
    expect(classifyXyz(60, 6)).toBe("Z");
    expect(coefficientOfVariation([0, 0, 0])).toBeNull();
  });
});

describe("min / max and reorder", () => {
  const p = { leadTimeDays: 2, safetyDays: 1, reviewDays: 7 };
  it("computes min, reorder point, max and the order from stated parameters", () => {
    // 10 a day: min 10, reorder 30, max 100
    expect(planReplenishment({ onHand: 25, onOrder: 0, averageDailyDemand: 10, currentMinQuantity: 0 }, p)).toEqual({
      daysOfCover: 2.5, suggestedMin: 10, reorderPoint: 30, suggestedMax: 100, suggestedOrder: 75, status: "REORDER",
    });
    expect(planReplenishment({ onHand: 8, onOrder: 0, averageDailyDemand: 10, currentMinQuantity: 0 }, p).status).toBe("BELOW_MIN");
    expect(planReplenishment({ onHand: 25, onOrder: 60, averageDailyDemand: 10, currentMinQuantity: 0 }, p)).toMatchObject({ status: "OK", suggestedOrder: 15 });
    expect(planReplenishment({ onHand: 500, onOrder: 0, averageDailyDemand: 10, currentMinQuantity: 0 }, p).suggestedOrder).toBe(0);
    expect(planReplenishment({ onHand: 5, onOrder: 0, averageDailyDemand: 0, currentMinQuantity: 0 }, p).status).toBe("NO_DEMAND");
  });
});

describe("forecast (pure)", () => {
  const baseline = {
    from: "2026-06-01", to: "2026-08-31", months: 3, averageMonthlyNetRevenue: 100_000, cogsPercentOfRevenue: 40,
    fixedExpensesPerMonth: 30_000, variableExpensePercentOfRevenue: 10, inventoryLossesPerMonth: 1_000, openingCash: 50_000, notes: [],
  };
  const drivers: ModelDriversDto = {
    months: 3, revenueGrowthPercentPerMonth: 10, cogsPercentOfRevenue: null, fixedExpensesPerMonth: null, variableExpensePercentOfRevenue: null,
    capexPerMonth: 5_000, ownerWithdrawalsPerMonth: 2_000, loanRepaymentPerMonth: 3_000, openingCash: null,
  };

  it("projects month by month from the baseline and the drivers, by hand-checkable arithmetic", () => {
    const f = forecast(baseline, drivers, { year: 2026, month: 10 }, () => 500);
    // month 1: revenue 110 000; cogs 44 000; variable 11 000; fixed 30 000; losses 1 000; depreciation 500
    expect(f.months[0]).toMatchObject({
      year: 2026, month: 10, netRevenue: 110_000, cogs: 44_000, grossProfit: 66_000, variableExpenses: 11_000,
      fixedExpenses: 30_000, inventoryLosses: 1_000, depreciation: 500, operatingProfit: 23_500,
      operatingCashFlow: 24_000, investingCashFlow: -5_000, financingCashFlow: -5_000, netCashFlow: 14_000, closingCash: 64_000,
    });
    expect(f.months[2].netRevenue).toBe(133_100); // 100 000 × 1.1³
    expect(f.months.map((m) => [m.year, m.month])).toEqual([[2026, 10], [2026, 11], [2026, 12]]);
    // break-even: (30 000 + 1 000 + 500) ÷ (1 − 0.4 − 0.1)
    expect(f.breakEvenMonthlyRevenue).toBe(63_000);
  });

  it("is deterministic: the same inputs give the identical forecast", () => {
    const a = JSON.stringify(forecast(baseline, drivers, { year: 2026, month: 10 }, () => 500));
    const b = JSON.stringify(forecast(baseline, drivers, { year: 2026, month: 10 }, () => 500));
    expect(a).toBe(b);
  });

  it("does not know a tax: net profit is preliminary, tax is null in every month and listed as not configured", () => {
    const f = forecast(baseline, drivers, { year: 2026, month: 10 }, () => 0);
    expect(f.months.every((m) => m.incomeTax === null && m.netProfit === m.operatingProfit)).toBe(true);
    expect(f.notConfigured).toContain("INCOME_TAX");
    expect(f.netProfitStatus).toBe("PRELIMINARY");
    expect(f.assumptions.join(" ")).toMatch(/Налоги не моделируются/);
  });

  it("an overriding driver replaces the baseline figure; no break-even when the margin cannot cover anything", () => {
    const f = forecast(baseline, { ...drivers, cogsPercentOfRevenue: 95, variableExpensePercentOfRevenue: 10 }, { year: 2026, month: 10 }, () => 0);
    expect(f.months[0].cogs).toBe(104_500);
    expect(f.breakEvenMonthlyRevenue).toBeNull();
  });

  it("rejects impossible drivers", () => {
    expect(validateDrivers({ ...drivers, months: 0 })).toMatch(/горизонт/i);
    expect(validateDrivers({ ...drivers, capexPerMonth: -1 })).toMatch(/отрицательн/);
    expect(validateDrivers({ ...drivers, cogsPercentOfRevenue: 2000 })).toMatch(/0 до 1000/);
    expect(validateDrivers(drivers)).toBeNull();
  });
});

// ── against the database ───────────────────────────────────────────────────

const prisma = new PrismaService();
const services = buildServices(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let planning: PlanningService;
let periods: FinancialPeriodsService;
let p1: string;
let p2: string;
let p3: string;
const DAY = 86400_000;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "planning");
  periods = new FinancialPeriodsService(prisma, services.finance, new FinancialEventProjector(prisma));
  planning = new PlanningService(prisma, services.finance, periods);
  const mk = (name: string, sku: string, price: number) =>
    prisma.product.create({ data: { organizationId: org.organizationId, name, sku, unit: "PCS", type: "FINISHED_GOOD", price } });
  p1 = (await mk("Хлеб", "PL-1", 100)).id;
  p2 = (await mk("Багет", "PL-2", 100)).id;
  p3 = (await mk("Пончик", "PL-3", 100)).id;
  for (const id of [p1, p2, p3]) await services.inventory.receive(org.user, { locationId: org.storeId, productId: id, quantity: 1000 });
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

// one sale, then dated `daysAgo`
const sellAt = async (productId: string, quantity: number, daysAgo: number) => {
  const sale = await services.sales.create(org.user, {
    locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId, quantity, unitPrice: 100 }],
  });
  const at = new Date(Date.now() - daysAgo * DAY);
  await prisma.sale.update({ where: { id: sale.id }, data: { soldAt: at } });
};

describe("ABC / XYZ over real sales", () => {
  beforeAll(async () => {
    // 8 weeks. Хлеб: 10 a week (stable, 80 % of revenue). Багет: erratic. Пончик: one small week.
    for (let w = 0; w < 8; w++) await sellAt(p1, 80 / 8 * 10, 3 + w * 7);
    await sellAt(p2, 60, 10);
    await sellAt(p2, 60, 45);
    await sellAt(p3, 10, 5);
  });

  it("classes products by revenue and by the stability of their weekly demand", async () => {
    const report = await planning.abcXyz(org.organizationId, new Date(Date.now() - 56 * DAY), new Date());
    const byName = Object.fromEntries(report.rows.map((r) => [r.productName, r]));
    expect(byName["Хлеб"]).toMatchObject({ abcClass: "A", xyzClass: "X" });
    expect(byName["Хлеб"].weeksWithSales).toBeGreaterThanOrEqual(7);
    expect(byName["Багет"].abcClass).toBe("B");
    expect(byName["Багет"].xyzClass).toBeNull(); // sold in only 2 weeks
    expect(byName["Пончик"].abcClass).toBe("C");
    expect(report.matrix["AX"]).toBe(1);
    expect(report.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100, 0);
    expect(report.weeks).toBeGreaterThanOrEqual(7);
  });
});

describe("replenishment over real stock", () => {
  it("uses the stated parameters, flags illustrative defaults, and counts orders already placed", async () => {
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "П" } });
    const stated = await planning.replenishment(org.organizationId, { lookbackDays: 28, leadTimeDays: 2, safetyDays: 1, reviewDays: 7 });
    expect(stated.assumptions.parametersAreDefaults).toBe(false);
    const defaults = await planning.replenishment(org.organizationId, {});
    expect(defaults.assumptions.parametersAreDefaults).toBe(true);
    const bread = stated.rows.find((r) => r.productName === "Хлеб")!;
    // sold 800 in the last 28 days? (weeks 0–3 → 4 sales × 100)
    expect(bread.averageDailyDemand).toBeCloseTo(400 / 28, 2);
    await services.procurement.create(org.user, { supplierId: supplier.id, locationId: org.storeId, items: [{ productId: p1, quantity: 50, unitCost: 10 }] } as never);
    const after = await planning.replenishment(org.organizationId, { lookbackDays: 28, leadTimeDays: 2, safetyDays: 1, reviewDays: 7 });
    expect(after.rows.find((r) => r.productName === "Хлеб")!.onOrder).toBe(50);
  });
});

describe("plan vs fact", () => {
  it("compares a planned month with the P&L's own figures; a cost above plan is unfavourable, revenue above plan is not", async () => {
    const now = monthOf(new Date());
    const range = monthRange(now.year, now.month);
    const inMonth = await prisma.sale.aggregate({ where: { organizationId: org.organizationId, soldAt: { gte: range.start, lte: range.end } }, _sum: { totalAmount: true } });
    const fact = inMonth._sum.totalAmount?.toNumber() ?? 0;
    const result = await planning.setPlan(org.user, {
      year: now.year, month: now.month,
      lines: [{ metric: PlanMetric.NET_REVENUE, amount: fact + 1000 }, { metric: PlanMetric.OPERATING_EXPENSES, amount: 0 }],
    });
    const revenue = result.rows.find((r) => r.metric === PlanMetric.NET_REVENUE)!;
    expect(revenue).toMatchObject({ plan: fact + 1000, fact, variance: -1000, unfavourable: true });
    const gross = result.rows.find((r) => r.metric === PlanMetric.GROSS_PROFIT)!;
    expect(gross.plan).toBeNull();
    expect(gross.variance).toBeNull();
    // Clearing a plan line removes it.
    const cleared = await planning.setPlan(org.user, { year: now.year, month: now.month, lines: [{ metric: PlanMetric.NET_REVENUE, amount: null }] });
    expect(cleared.rows.find((r) => r.metric === PlanMetric.NET_REVENUE)!.plan).toBeNull();
  });
});

describe("the financial model never writes accounting data", () => {
  const drivers: ModelDriversDto = {
    months: 6, revenueGrowthPercentPerMonth: 3, cogsPercentOfRevenue: null, fixedExpensesPerMonth: null, variableExpensePercentOfRevenue: null,
    capexPerMonth: 0, ownerWithdrawalsPerMonth: 0, loanRepaymentPerMonth: 0, openingCash: null,
  };
  const accountingCounts = async () => ({
    sale: await prisma.sale.count({ where: { organizationId: org.organizationId } }),
    saleItem: await prisma.saleItem.count({ where: { sale: { organizationId: org.organizationId } } }),
    cash: await prisma.cashMovement.count({ where: { organizationId: org.organizationId } }),
    stock: await prisma.stockMovement.count({ where: { organizationId: org.organizationId } }),
    stockLevel: await prisma.stockLevel.count({ where: { organizationId: org.organizationId } }),
    expense: await prisma.expense.count({ where: { organizationId: org.organizationId } }),
    category: await prisma.financeCategory.count({ where: { organizationId: org.organizationId } }),
    order: await prisma.purchaseOrder.count({ where: { organizationId: org.organizationId } }),
    invoice: await prisma.invoice.count({ where: { organizationId: org.organizationId } }),
    asset: await prisma.fixedAsset.count({ where: { organizationId: org.organizationId } }),
    depreciation: await prisma.depreciationEntry.count({ where: { organizationId: org.organizationId } }),
    snapshot: await prisma.periodSnapshot.count({ where: { organizationId: org.organizationId } }),
    audit: await prisma.auditLog.count({ where: { organizationId: org.organizationId } }),
    balances: (await prisma.cashAccount.findMany({ where: { organizationId: org.organizationId }, select: { currentBalance: true } })).map((a) => a.currentBalance.toNumber()),
  });

  it("baseline, run, compare and scenario CRUD leave every accounting table exactly as it was", async () => {
    const before = await accountingCounts();
    const baseline = await planning.baseline(org.organizationId, 3);
    const run = await planning.run(org.organizationId, drivers, 3);
    const saved = await planning.saveScenario(org.user, { name: "База", drivers });
    const updated = await planning.saveScenario(org.user, { name: "База+", drivers: { ...drivers, revenueGrowthPercentPerMonth: 5 } }, saved.id);
    const other = await planning.saveScenario(org.user, { name: "Рост", drivers: { ...drivers, revenueGrowthPercentPerMonth: 10 } });
    const comparison = await planning.compare(org.organizationId, [updated.id, other.id], 3);
    expect(comparison.rows).toHaveLength(2);
    expect(comparison.rows[0].totals.netRevenue).toBeLessThan(comparison.rows[1].totals.netRevenue);
    expect(await planning.listScenarios(org.organizationId)).toHaveLength(2);
    await planning.deleteScenario(org.organizationId, other.id);
    await planning.deleteScenario(org.organizationId, updated.id);
    expect(await accountingCounts()).toEqual(before);
    expect(baseline.openingCash).toBe(before.balances.reduce((s, v) => s + v, 0));
    expect(run.months).toHaveLength(6);
  });

  it("the same baseline and drivers give the identical forecast, twice", async () => {
    const baseline = await planning.baseline(org.organizationId, 3);
    const a = JSON.stringify(await planning.run(org.organizationId, drivers, 3, baseline));
    const b = JSON.stringify(await planning.run(org.organizationId, drivers, 3, baseline));
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(parsed.notConfigured).toContain("INCOME_TAX");
  });

  it("invalid drivers are refused before anything is stored", async () => {
    await expect(planning.saveScenario(org.user, { name: "Плохой", drivers: { ...drivers, months: 99 } })).rejects.toThrow();
    expect(await planning.listScenarios(org.organizationId)).toHaveLength(0);
  });
});
