import { BalanceLine, BalanceStatus, DebtCounterpartyKind, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { BalanceService } from "./balance/balance.service";
import { FinanceSetupService } from "./finance-setup.service";
import { FinancialEventProjector } from "./events/projector";
import { checkEventInvariants } from "./events/invariants";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { LedgerService } from "../ledger/ledger.service";
import { DebtsService } from "../debts/debts.service";

// The financiers' own acceptance example (ТЗ §9.3), run end to end in a fresh
// organization with the general ledger ON:
//   flour received 10 kg × 400 ₸ and 10 kg × 500 ₸ → average 450 ₸;
//   a batch by a recipe with a 0.5 kg norm of flour → 225 ₸ a unit;
//   a sale to a customer on credit → a receivable;
//   the customer pays → receivable closed, the money in the ДДС;
//   ОПиУ, ДДС and the balance sheet agree.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balance = new BalanceService(prisma, services.finance);
const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, balance, reports, ledger);
const projector = new FinancialEventProjector(prisma);
const debts = new DebtsService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let flourId: string;
let cakeId: string;
let recipeId: string;
let supplierId: string;
let customerId: string;
let saleId: string;
let from: Date;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "acceptance");
  const id = org.organizationId;
  await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { isDefault: true } });
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "TZ-1", type: ProductType.RAW_MATERIAL, price: 400, unit: Unit.KG } })).id;
  cakeId = (await prisma.product.create({ data: { organizationId: id, name: "Изделие", sku: "TZ-2", type: ProductType.FINISHED_GOOD, price: 1000, unit: Unit.PCS } })).id;
  recipeId = (await prisma.recipe.create({ data: { organizationId: id, productId: cakeId, yieldQuantity: 1, items: { create: [{ ingredientProductId: flourId, quantity: 0.5 }] } } })).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Поставщик муки" } })).id;
  customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Покупатель", paymentTermDays: 1 } })).id;
  // A company starting from zero: opening declared (nothing), ledger and purchasing workflow on.
  from = new Date(Date.now() - 60_000);
  await new FinanceSetupService(prisma, services.finance).complete(org.user);
  await startLedger(ledger, org, 1);
  await services.procurement.activateCutover(org.user);
});
afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("ТЗ §9.3 — контрольный пример", () => {
  it("1. two receipts of flour give a weighted average of 450 ₸", async () => {
    for (const unitCost of [400, 500]) {
      const po = await services.procurement.create(org.user, {
        supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost }],
      } as never);
      await services.procurement.receive(org.user, po.id);
    }
    const flour = await prisma.product.findUniqueOrThrow({ where: { id: flourId } });
    expect(flour.averageUnitCost?.toNumber()).toBe(450);
    expect((await debts.payables(org.organizationId)).total).toBe(9000);
  });

  it("2. a batch by the recipe (0.5 kg of flour) costs 225 ₸ a unit", async () => {
    const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: 10 });
    await services.production.start(org.user, batch.id);
    await services.production.complete(org.user, batch.id, { actualQuantity: 10 });
    const cost = await prisma.productionBatchCost.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(cost.amount.toNumber()).toBe(2250);
    const output = await prisma.stockMovement.findFirstOrThrow({ where: { batchId: batch.id, type: "PRODUCTION_OUTPUT" } });
    expect(output.unitCost?.toNumber()).toBe(225);
    const flourLeft = await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: flourId } } });
    expect(flourLeft.quantity.toNumber()).toBe(15);
  });

  it("3. a sale on credit creates a receivable; the cost of the sale is 225 ₸ a unit", async () => {
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId, customerId, amountPaid: 0, paymentMethod: PaymentMethod.TRANSFER,
      items: [{ productId: cakeId, quantity: 4, unitPrice: 1000 }],
    } as never);
    saleId = sale.id;
    expect(sale.balanceDue).toBe(4000);
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId } });
    expect(line.unitCost?.toNumber()).toBe(225);
    expect(await services.finance.getAccountsReceivable(org.organizationId)).toBe(4000);
    expect((await debts.receivables(org.organizationId)).total).toBe(4000);
  });

  it("4. the payment closes the receivable and the money is in the ДДС", async () => {
    await services.sales.recordPayment(org.user, saleId, { amount: 4000, accountId: org.bankAccountId } as never);
    expect(await services.finance.getAccountsReceivable(org.organizationId)).toBe(0);
    const act = await debts.statement(org.organizationId, DebtCounterpartyKind.CUSTOMER, customerId);
    expect(act.closing).toBe(0);
  });

  it("5. ОПиУ, ДДС and the balance sheet agree", async () => {
    const to = new Date(Date.now() + 60_000);
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    expect(pnl).toMatchObject({ netRevenue: 4000, cogs: 900, grossProfit: 3100, operatingProfit: 3100, profitBeforeTax: 3100 });

    const flow = await services.finance.getCashFlow(org.organizationId, from, to);
    expect(flow).toMatchObject({ openingBalance: 0, totalInflow: 4000, totalOutflow: 0, closingBalance: 4000 });

    const sheet = await balance.getBalanceSheet(org.organizationId);
    const asset = (l: BalanceLine) => sheet.assets.lines.find((x) => x.line === l)?.amount;
    const liability = (l: BalanceLine) => sheet.liabilities.lines.find((x) => x.line === l)?.amount;
    expect(asset(BalanceLine.CASH_AND_BANK)).toBe(4000); // = ДДС closing balance
    // 15 kg flour × 450 + 6 units × 225
    expect(asset(BalanceLine.INVENTORY)).toBe(8100);
    expect(asset(BalanceLine.RECEIVABLES)).toBe(0);
    expect(liability(BalanceLine.SUPPLIER_PAYABLES)).toBe(9000);
    // Equity grew by exactly the period's result: 12 100 − 9 000 = 3 100.
    expect(sheet.assets.total).toBe(12100);
    expect(sheet.liabilities.total).toBe(9000);
    expect(sheet.equity.total).toBe(3100);
    expect(sheet.status).toBe(BalanceStatus.BALANCED);
    expect(sheet.control.lines).toEqual([]);

    expect(checkEventInvariants(await projector.project(org.organizationId)).violations).toEqual([]);
    const diag = await diagnostics.run(org.organizationId);
    expect(diag.checks.filter((c) => c.status !== "PASS")).toEqual([]);
  });

  it("6. the production reports show the output and its unit cost by month", async () => {
    const report = await services.production.output(org.user, from, new Date(Date.now() + 60_000));
    expect(report.rows).toEqual([
      expect.objectContaining({ productId: cakeId, batches: 1, quantity: 10, cost: 2250, unitCost: 225 }),
    ]);
    const trend = await services.production.unitCostTrend(org.user, cakeId, 3);
    expect(trend.months).toHaveLength(3);
    expect(trend.months.at(-1)).toMatchObject({ quantity: 10, cost: 2250, unitCost: 225 });
    expect(trend.months[0]).toMatchObject({ quantity: 0, unitCost: null });
  });

  it("7. finished goods are sold at their batches' average: a flour price change between baking and selling keeps the books balanced", async () => {
    // Flour gets dearer: 15 kg at 450 + 10 kg at 700 → 550.
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost: 700 }] } as never);
    await services.procurement.receive(org.user, po.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: flourId } })).averageUnitCost?.toNumber()).toBe(550);
    // The 6 loaves on the shelf were baked at 225 and stay at 225 — not today's recipe (0.5 × 550 = 275).
    expect((await prisma.product.findUniqueOrThrow({ where: { id: cakeId } })).averageUnitCost?.toNumber()).toBe(225);
    const first = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: cakeId, quantity: 2, unitPrice: 1000 }] } as never);
    expect((await prisma.saleItem.findFirstOrThrow({ where: { saleId: first.id } })).unitCost?.toNumber()).toBe(225);
    // A new batch at the new flour price: 275 a unit; the shelf averages 4 × 225 and 10 × 275.
    const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: 10 });
    await services.production.start(org.user, batch.id);
    await services.production.complete(org.user, batch.id, { actualQuantity: 10 });
    expect((await prisma.stockMovement.findFirstOrThrow({ where: { batchId: batch.id, type: "PRODUCTION_OUTPUT" } })).unitCost?.toNumber()).toBe(275);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: cakeId } })).averageUnitCost?.toNumber()).toBe(260.7143);
    const second = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: cakeId, quantity: 3, unitPrice: 1000 }] } as never);
    expect((await prisma.saleItem.findFirstOrThrow({ where: { saleId: second.id } })).unitCost?.toNumber()).toBe(260.7143);
    // A loaf of the first sale comes back onto the shelf at the 225 it was sold at: it joins the average.
    await services.returns.create(org.user, first.id, { items: [{ productId: cakeId, quantity: 1 }], restocked: true } as never);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: cakeId } })).averageUnitCost?.toNumber()).toBe(Math.round(((11 * 260.7143 + 225) / 12) * 10000) / 10000);

    const sheet = await balance.getBalanceSheet(org.organizationId);
    expect(sheet.control.lines).toEqual([]);
    expect(sheet.status).toBe(BalanceStatus.BALANCED);
    expect(checkEventInvariants(await projector.project(org.organizationId)).violations).toEqual([]);
    const diag = await diagnostics.run(org.organizationId);
    expect(diag.checks.filter((c) => c.status !== "PASS")).toEqual([]);
  });
});
