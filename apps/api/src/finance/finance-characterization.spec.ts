import { CostBehavior, FinanceCategoryKind, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { resolveProductUnitCosts } from "../common/product-costs";
import { checkLedgerConsistency } from "./integrity/ledger-consistency";

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTERIZATION TESTS — they pin what the finance layer does TODAY.
//
// Every number below was worked out by hand from the fixture, and each test
// says whether it pins correct behaviour or a KNOWN DEFECT. A "KNOWN DEFECT"
// test is not an endorsement: it exists so that the phase that fixes the
// defect has to change the test on purpose, in the same commit, and so that no
// OTHER number can move unnoticed while it does. When a later phase changes a
// pinned figure deliberately, update the expectation and its comment together.
//
// Runs in its own throwaway organization; demo data is neither read nor changed.
// ─────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaService();
const services = buildServices(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let flourId: string;
let breadId: string;
let cakeId: string;
let mysteryId: string;
let customerId: string;
let supplierId: string;
let rentCategoryId: string;
let from: Date;
let to: Date;
let cashSaleId: string;

const DAY = 24 * 3600 * 1000;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "char");
  const { user, organizationId: orgId, storeId, cashAccountId, bankAccountId } = org;

  // ── products ─────────────────────────────────────────────────────────────
  const mk = (data: object) => prisma.product.create({ data: { organizationId: orgId, unit: Unit.PCS, ...data } as never });
  flourId = (await mk({ name: "Мука", sku: "ING-1", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 })).id;
  breadId = (await mk({ name: "Хлеб", sku: "PRD-1", type: ProductType.FINISHED_GOOD, price: 500 })).id;
  cakeId = (await mk({ name: "Торт", sku: "PRD-2", type: ProductType.FINISHED_GOOD, price: 1000 })).id;
  mysteryId = (await mk({ name: "Без расчёта", sku: "PRD-3", type: ProductType.FINISHED_GOOD, price: 200 })).id;

  // Bread: 2 kg of flour make 4 loaves → 200 / 4 = 50 per loaf. lossPercent is
  // set on purpose: the recipe screen divides by (1 − loss), the cost resolver
  // does not — see the KNOWN DEFECT test on resolveProductUnitCosts.
  await prisma.recipe.create({
    data: {
      organizationId: orgId,
      productId: breadId,
      yieldQuantity: 4,
      lossPercent: 10,
      items: { create: [{ ingredientProductId: flourId, quantity: 2 }] },
    },
  });

  supplierId = (await prisma.supplier.create({ data: { organizationId: orgId, name: "Поставщик" } })).id;
  customerId = (await prisma.customer.create({ data: { organizationId: orgId, name: "Оптовик" } })).id;
  rentCategoryId = (
    await prisma.financeCategory.create({
      data: { organizationId: orgId, name: "Аренда", kind: FinanceCategoryKind.EXPENSE, costBehavior: CostBehavior.FIXED },
    })
  ).id;

  // ── purchase history for the cake (no recipe → costed from purchases) ────
  // Three orders in three states. Today the average takes ALL of them.
  const po = (status: string, quantity: number, unitCost: number) =>
    prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        supplierId,
        locationId: storeId,
        status: status as never,
        totalCost: quantity * unitCost,
        createdById: user.id,
        items: { create: [{ productId: cakeId, quantity, unitCost, subtotal: quantity * unitCost }] },
      },
    });
  await po("RECEIVED", 10, 300);
  await po("PLACED", 10, 900);
  await po("CANCELLED", 10, 1500);

  // ── stock ────────────────────────────────────────────────────────────────
  for (const [productId, quantity] of [
    [flourId, 100],
    [breadId, 20],
    [cakeId, 20],
    [mysteryId, 20],
  ] as const) {
    await services.inventory.receive(user, { locationId: storeId, productId, quantity });
  }

  // ── money in the bank before the period under test ───────────────────────
  for (const [accountId, amount] of [
    [cashAccountId, 5000],
    [bankAccountId, 10000],
  ] as const) {
    const movement = await services.cash.recordMovement(prisma, {
      organizationId: orgId,
      accountId,
      type: "OPENING_BALANCE" as never,
      amount,
      reason: "Начальный остаток",
      createdById: user.id,
    });
    await prisma.cashMovement.update({ where: { id: movement.id }, data: { occurredAt: new Date(Date.now() - 30 * DAY) } });
  }

  // ── sales ────────────────────────────────────────────────────────────────
  const sale = (dto: object) => services.sales.create(user, { locationId: storeId, ...dto } as never);
  cashSaleId = (
    await sale({ paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 3, unitPrice: 500 }] })
  ).id; // 1500
  await sale({ paymentMethod: PaymentMethod.CARD, items: [{ productId: cakeId, quantity: 1, unitPrice: 1000 }] }); // 1000 → bank
  await sale({ paymentMethod: PaymentMethod.CASH, items: [{ productId: mysteryId, quantity: 2, unitPrice: 200 }] }); // 400, no cost data
  await sale({ customerId, amountPaid: 0, items: [{ productId: breadId, quantity: 2, unitPrice: 500 }] }); // 1000 on credit
  // Marked-down loaf: 500 → 250. Revenue is the 250 actually charged.
  await sale({
    paymentMethod: PaymentMethod.CASH,
    items: [{ productId: breadId, quantity: 1, unitPrice: 250, fullUnitPrice: 500 }],
  }); // 250

  // Two returns from the 1500 cash sale: one goes back on the shelf, one is
  // scrapped. Refunds: 500 + 500 out of the till.
  await services.returns.create(user, cashSaleId, { items: [{ productId: breadId, quantity: 1 }] });
  await services.returns.create(user, cashSaleId, { items: [{ productId: breadId, quantity: 1 }], restocked: false });

  // ── expenses ─────────────────────────────────────────────────────────────
  await services.finance.createExpense(user, {
    amount: 300,
    categoryId: rentCategoryId,
    paidImmediately: true,
    accountId: cashAccountId,
  }); // CONFIRMED, paid → EXPENSE_PAYMENT 300
  await services.finance.createExpense(user, { amount: 500, categoryId: rentCategoryId, paidImmediately: false }); // stays DRAFT
  const owed = await services.finance.createExpense(user, { amount: 200, categoryId: rentCategoryId, paidImmediately: false });
  await services.finance.confirmExpense(org.organizationId, owed.id, org.user.id); // CONFIRMED, unpaid 200
  const cancelled = await services.finance.createExpense(user, { amount: 700, categoryId: rentCategoryId, paidImmediately: false });
  await services.finance.cancelExpense(org.organizationId, cancelled.id, org.user.id); // CANCELLED

  // ── supplier invoices ────────────────────────────────────────────────────
  const invoice = (status: string, totalCost: number, number: string) =>
    prisma.invoice.create({
      data: {
        organizationId: orgId,
        locationId: storeId,
        supplierId,
        number,
        status: status as never,
        totalCost,
        createdById: user.id,
        items: { create: [{ productId: cakeId, quantity: 10, unitCost: totalCost / 10, subtotal: totalCost }] },
      },
    });
  const confirmed = await invoice("CONFIRMED", 1000, "I-1");
  await invoice("DRAFT", 500, "I-2");
  await services.invoices.recordPayment(user, confirmed.id, { accountId: bankAccountId, amount: 200 }); // SUPPLIER_PAYMENT 200

  // ── remaining cash operations ────────────────────────────────────────────
  await services.cash.transfer(user, { fromAccountId: cashAccountId, toAccountId: bankAccountId, amount: 300 });
  await services.cash.deposit(user, { accountId: bankAccountId, amount: 1000, reason: "Взнос" });
  await services.cash.withdraw(user, { accountId: bankAccountId, amount: 200, reason: "Снятие" });
  const cashNow = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: cashAccountId } })).currentBalance.toNumber();
  await services.cash.adjust(user, { accountId: cashAccountId, actualBalance: cashNow - 40, reason: "Недостача" });

  from = new Date(Date.now() - 3600_000);
  to = new Date(Date.now() + 3600_000);
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

describe("cost resolver (common/product-costs.ts)", () => {
  it("costs a baked product from its recipe: ingredients ÷ raw yield", async () => {
    const costs = await resolveProductUnitCosts(prisma, org.organizationId);
    expect(costs.get(breadId)).toBe(50);
  });

  it("KNOWN DEFECT (v2 §1, decision D1): ignores the recipe's lossPercent", async () => {
    // The recipe screen (recipes.service.ts) divides by (1 − loss/100) and would
    // give 200 / (4 × 0.9) = 55.56 for this loaf. The resolver P&L and inventory
    // valuation use gives 50. Two numbers for one loaf; which is right is a
    // business question, so this is pinned, not fixed.
    const costs = await resolveProductUnitCosts(prisma, org.organizationId);
    expect(costs.get(breadId)).not.toBeCloseTo(200 / (4 * 0.9), 2);
  });

  it("KNOWN DEFECT: the purchase-average fallback counts PLACED and CANCELLED orders too", async () => {
    // (3 000 received + 9 000 placed + 15 000 cancelled) ÷ 30 units = 900.
    // Only the received order is real; the honest average would be 300.
    const costs = await resolveProductUnitCosts(prisma, org.organizationId);
    expect(costs.get(cakeId)).toBe(900);
  });

  it("KNOWN DEFECT: supplier invoices never feed the purchase average", async () => {
    // A CONFIRMED invoice for the same cake at 100 per unit exists (fixture)
    // and does not move the 900 above.
    const invoiceItems = await prisma.invoiceItem.count({ where: { productId: cakeId, invoice: { status: "CONFIRMED" } } });
    expect(invoiceItems).toBe(1);
    const costs = await resolveProductUnitCosts(prisma, org.organizationId);
    expect(costs.get(cakeId)).toBe(900);
  });

  it("leaves a product with neither recipe nor purchases without a cost (unknown, never zero)", async () => {
    const costs = await resolveProductUnitCosts(prisma, org.organizationId);
    expect(costs.has(mysteryId)).toBe(false);
  });
});

describe("profit and loss", () => {
  it("adds up revenue, cost of goods, expenses and profit for the period", async () => {
    // INTENTIONAL CHANGE (Phase 3): returns now reduce revenue and (when restocked) cost of goods.
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    // Sold: 1 500 + 1 000 + 400 + 1 000 + 250 (the marked-down loaf at its charged price) = 4 150
    // Gross revenue is at price BEFORE the 250 markdown; returns refunded 2 × 500.
    expect(pnl.grossRevenue).toBe(4400);
    expect(pnl.discountsTotal).toBe(250);
    expect(pnl.returnsTotal).toBe(1000);
    expect(pnl.netRevenue).toBe(3150);
    expect(pnl.revenue).toBe(pnl.netRevenue);
    // bread: 6 × 50 = 300, cake 1 × 900 = 900, mystery: no cost → 0; the RESTOCKED
    // return gives one loaf's cost (50) back; the SCRAPPED one keeps its cost.
    expect(pnl.cogs).toBe(1150);
    expect(pnl.grossProfit).toBe(2000);
    expect(pnl.unknownCostLineItems).toBe(1);
    expect(pnl.inventoryLosses).toBe(0);
    // Only CONFIRMED expenses count: 300 paid + 200 owed. The DRAFT 500 and the CANCELLED 700 do not.
    expect(pnl.expensesTotal).toBe(500);
    expect(pnl.operatingProfit).toBe(1500);
    expect(pnl.profitBeforeTax).toBe(1500);
  });

  it("returns reduce revenue; only the restocked one gives cost of goods back; the scrapped one is not an inventory loss", async () => {
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    expect(pnl.returnsTotal).toBe(1000);
    const refunds = await prisma.cashMovement.aggregate({
      where: { organizationId: org.organizationId, type: "SALE_REFUND" },
      _sum: { amount: true },
    });
    expect(refunds._sum.amount?.toNumber()).toBe(1000);
    // Refunded money and reported returns agree, and the scrap marker (a
    // return-linked WRITE_OFF) is kept out of inventory losses.
    expect(pnl.inventoryLossLines).toEqual([]);
    expect(pnl.cogs).toBe(1150);
  });

  it("exposes the full P&L ladder and never calls operating profit the net profit", async () => {
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    for (const field of [
      "grossRevenue", "discountsTotal", "returnsTotal", "netRevenue", "inventoryLosses",
      "depreciation", "operatingProfit", "otherResult", "profitBeforeTax", "incomeTax", "netProfit",
      "netProfitStatus", "notConfigured", "costCoverage", "costingMethod",
    ]) {
      expect(pnl).toHaveProperty(field);
    }
    // Tax has no approved policy: unknown (null), not 0%, and the net profit is PRELIMINARY.
    expect(pnl.incomeTax).toBeNull();
    expect(pnl.netProfitStatus).toBe("PRELIMINARY");
    expect(pnl.notConfigured).toContain("INCOME_TAX");
    expect(pnl.costingMethod).toBe("текущий расчёт (политика не утверждена)");
  });

  it("the dashboard's net profit carries the same status as the P&L", async () => {
    const dashboard = await services.finance.getDashboard(org.organizationId, from, to);
    expect(dashboard.grossProfit).toBe(2000);
    expect(dashboard.operatingProfit).toBe(1500);
    expect(dashboard.netProfitStatus).toBe("PRELIMINARY");
    expect(dashboard.notConfigured).toContain("INCOME_TAX");
  });

  it("breaks revenue down per product at the price actually charged", async () => {
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    const bread = pnl.byProduct.find((p) => p.productId === breadId)!;
    // Net of the two returned loaves: 6 − 2 sold, 2 750 − 1 000, cost 300 − 50 (restocked one only).
    expect(bread).toMatchObject({ quantitySold: 4, revenue: 1750, cogs: 250, hasCostData: true });
    const mystery = pnl.byProduct.find((p) => p.productId === mysteryId)!;
    expect(mystery).toMatchObject({ revenue: 400, cogs: 0, hasCostData: false });
  });

  it("ignores expenses and sales outside the requested period", async () => {
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, new Date(Date.now() - 10 * DAY), new Date(Date.now() - 9 * DAY));
    expect(pnl.revenue).toBe(0);
    expect(pnl.expensesTotal).toBe(0);
  });
});

describe("cash flow (ДДС)", () => {
  it("derives the opening balance from movements before the period and reconciles to the closing balance", async () => {
    const flow = await services.finance.getCashFlow(org.organizationId, from, to);
    expect(flow.openingBalance).toBe(15000);
    // in: receipts 1500 + 1000 + 400 + 250, transfer-in 300, deposit 1000
    // out: refunds 1000, expense 300, supplier 200, transfer-out 300, withdrawal 200, adjustment 40
    expect(flow.totalInflow).toBe(4450);
    expect(flow.totalOutflow).toBe(2040);
    expect(flow.netFlow).toBe(2410);
    expect(flow.closingBalance).toBe(17410);
  });

  it("closes to exactly the sum of the account balances", async () => {
    const flow = await services.finance.getCashFlow(org.organizationId, from, to);
    const accounts = await prisma.cashAccount.findMany({ where: { organizationId: org.organizationId } });
    const total = accounts.reduce((sum, a) => sum + a.currentBalance.toNumber(), 0);
    expect(flow.closingBalance).toBe(total);
  });

  it("KNOWN DEFECT (v2 §14): internal transfers inflate BOTH gross lines (net is unaffected)", async () => {
    const flow = await services.finance.getCashFlow(org.organizationId, from, to);
    expect(flow.inflowByType.find((l) => l.type === "TRANSFER_IN")?.amount).toBe(300);
    expect(flow.outflowByType.find((l) => l.type === "TRANSFER_OUT")?.amount).toBe(300);
    // Without the transfer the gross figures would be 4 150 and 1 740.
  });

  it("KNOWN DEFECT (v2 §14): an opening balance inside the period is reported as an inflow", async () => {
    const flow = await services.finance.getCashFlow(org.organizationId, new Date(Date.now() - 40 * DAY), to);
    expect(flow.openingBalance).toBe(0);
    expect(flow.inflowByType.find((l) => l.type === "OPENING_BALANCE")?.amount).toBe(15000);
    expect(flow.totalInflow).toBe(4450 + 15000);
  });

  it("has no operating / investing / financing split and no unclassified bucket", async () => {
    const flow = await services.finance.getCashFlow(org.organizationId, from, to);
    for (const missing of ["activities", "operating", "investing", "financing", "unclassified", "internalTransfers"]) {
      expect(flow).not.toHaveProperty(missing);
    }
    // The only "unclassified" idea today is spending with no category.
    expect(flow.uncategorizedOutflow).toBeGreaterThan(0);
  });
});

describe("inventory valuation", () => {
  it("prices raw materials at Product.price and finished goods at resolved cost, excluding goods with no cost", async () => {
    const valuation = await services.finance.getInventoryValuation(org.organizationId);
    const line = (productId: string) => valuation.byProduct.find((l) => l.productId === productId)!;
    // flour 100 received − 0 written off = 100 × 100
    expect(line(flourId)).toMatchObject({ quantity: 100, unitCost: 100, value: 10000, hasCostData: true });
    // bread: 20 received − 6 sold + 1 restocked return = 15 × 50 (the scrapped return added nothing back)
    expect(line(breadId)).toMatchObject({ quantity: 15, unitCost: 50, value: 750 });
    // cake: 20 − 1 sold = 19 × 900 (the defective average above)
    expect(line(cakeId)).toMatchObject({ quantity: 19, unitCost: 900, value: 17100 });
    expect(line(mysteryId)).toMatchObject({ quantity: 18, unitCost: null, value: 0, hasCostData: false });
    expect(valuation.totalValue).toBe(10000 + 750 + 17100);
    expect(valuation.unknownValueLineItems).toBe(1);
  });
});

describe("receivables and payables", () => {
  it("counts only the unpaid part of customer sales as receivable", async () => {
    expect(await services.finance.getAccountsReceivable(org.organizationId)).toBe(1000);
  });

  it("payables = confirmed invoices unpaid + confirmed expenses unpaid (+ consignment)", async () => {
    // invoice I-1: 1 000 − 200 paid = 800; expense owed: 200; the DRAFT invoice and DRAFT/CANCELLED expenses are excluded.
    expect(await services.finance.getAccountsPayable(org.organizationId)).toBe(1000);
  });

  it("KNOWN DEFECT (v2 §17): a RECEIVED purchase order creates no payable", async () => {
    // The fixture holds a RECEIVED order worth 3 000. It appears nowhere above.
    const received = await prisma.purchaseOrder.findFirstOrThrow({
      where: { organizationId: org.organizationId, status: "RECEIVED" },
    });
    expect(received.totalCost.toNumber()).toBe(3000);
    expect(await services.finance.getAccountsPayable(org.organizationId)).toBe(1000);
  });
});

describe("what does NOT reach the profit and loss statement", () => {
  it("a write-off is an inventory loss at the cost stamped on the movement", async () => {
    const before = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    await services.inventory.writeOff(org.user, {
      locationId: org.storeId,
      productId: flourId,
      quantity: 5,
      reason: "Порча",
      writeOffReason: "DAMAGED" as never,
    });
    const after = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    // 5 kg of flour at 100.
    expect(after.inventoryLosses).toBe(500);
    expect(after.inventoryLossLines).toEqual([expect.objectContaining({ kind: "WRITE_OFF", amount: 500, count: 1 })]);
    expect(after.operatingProfit).toBe(before.operatingProfit - 500);
    expect(after.cogs).toBe(before.cogs);
  });

  it("a further restocked return reduces revenue and gives back the cost it was sold at", async () => {
    const before = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    await services.returns.create(org.user, cashSaleId, { items: [{ productId: breadId, quantity: 1 }] });
    const after = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    expect(after.revenue).toBe(before.revenue - 500);
    expect(after.cogs).toBe(before.cogs - 50);
  });
});

describe("history is remembered, not recomputed", () => {
  it("editing an ingredient price does NOT rewrite the cost of goods of sales already made", async () => {
    const before = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    expect(before.cogs).toBe(1100);
    await prisma.product.update({ where: { id: flourId }, data: { price: 200 } });
    try {
      const after = await services.finance.getProfitAndLoss(org.organizationId, from, to);
      expect(after.cogs).toBe(before.cogs);
      expect(after.grossProfit).toBe(before.grossProfit);
      // Every costed line came from a snapshot, none from today's price.
      expect(after.costCoverage.fallbackLines).toBe(0);
      expect(after.costCoverage.snapshotLines).toBeGreaterThan(0);
    } finally {
      await prisma.product.update({ where: { id: flourId }, data: { price: 100 } });
    }
  });

  it("legacy lines without a snapshot fall back to today's cost, and are counted as such", async () => {
    // Simulate a sale from before snapshots existed.
    await prisma.saleItem.updateMany({
      where: { sale: { organizationId: org.organizationId }, productId: breadId, unitCost: { not: null } },
      data: { unitCost: null, costBasis: null },
    });
    const before = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    expect(before.costCoverage.fallbackLines).toBeGreaterThan(0);
    await prisma.product.update({ where: { id: flourId }, data: { price: 200 } });
    try {
      const after = await services.finance.getProfitAndLoss(org.organizationId, from, to);
      expect(after.cogs).toBeGreaterThan(before.cogs);
    } finally {
      await prisma.product.update({ where: { id: flourId }, data: { price: 100 } });
    }
  });
});

describe("the whole scenario still leaves the ledgers and caches in agreement", () => {
  it("shows no drift", async () => {
    const report = await checkLedgerConsistency(prisma, org.organizationId);
    expect(report.stock.drifts).toEqual([]);
    expect(report.cash.drifts).toEqual([]);
  });
});
