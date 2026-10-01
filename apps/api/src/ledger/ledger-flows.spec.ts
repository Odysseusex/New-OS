import {
  AccountingEventStatus,
  CoverageStatus,
  FinanceCategoryKind,
  PaymentMethod,
  ProductType,
  SystemAccountKey as K,
  Unit,
  WriteOffReason,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { BalanceService } from "../finance/balance/balance.service";
import { LedgerDiagnosticsService } from "./ledger-diagnostics.service";
import { LedgerReportsService } from "./ledger-reports.service";
import { LedgerService } from "./ledger.service";

// The ledger across real business flows. One organization lives through a small
// bakery's day; every balance below was worked out by hand, and the book is then
// held up against the operational subledgers, the existing reports and itself.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balanceService = new BalanceService(prisma, services.finance);
const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, balanceService, reports, ledger);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
const DAY = 24 * 3600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let org: IsolatedOrg;
let flourId: string;
let breadId: string;
let cakeId: string;
let supplierId: string;
let customerId: string;
let breadRecipeId: string;
let startsAt: Date;
let mixedSaleId: string;
let creditSaleId: string;

const gl = (key: K) => glBalance(ledger, org, key);
const move = async (type: string) =>
  (await prisma.cashMovement.findMany({ where: { organizationId: org.organizationId, type: type as never }, orderBy: { createdAt: "asc" } })).map((m) => ({
    accountId: m.accountId,
    amount: m.amount.toNumber(),
  }));

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "ledger-flows");
  const { user, organizationId, storeId, cashAccountId, bankAccountId } = org;
  const mk = (data: object) => prisma.product.create({ data: { organizationId, unit: Unit.PCS, ...data } as never });
  flourId = (await mk({ name: "Мука", sku: "F-ING", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 })).id;
  breadId = (await mk({ name: "Хлеб", sku: "F-PRD1", type: ProductType.FINISHED_GOOD, price: 500 })).id;
  cakeId = (await mk({ name: "Торт", sku: "F-PRD2", type: ProductType.FINISHED_GOOD, price: 1000 })).id;
  breadRecipeId = (
    await prisma.recipe.create({
      data: { organizationId, productId: breadId, yieldQuantity: 4, items: { create: [{ ingredientProductId: flourId, quantity: 2 }] } },
    })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId, name: "Поставщик" } })).id;
  customerId = (await prisma.customer.create({ data: { organizationId, name: "Оптовик" } })).id;

  // ── history BEFORE the ledger: stock, opening cash and a past purchase ──
  await prisma.purchaseOrder.create({
    data: {
      organizationId,
      supplierId,
      locationId: storeId,
      status: "RECEIVED",
      totalCost: 3000,
      receivedTotal: 3000,
      receivedAt: new Date(Date.now() - 30 * DAY),
      createdById: user.id,
      items: { create: [{ productId: cakeId, quantity: 10, unitCost: 300, subtotal: 3000 }] },
    },
  });
  for (const [productId, quantity] of [[flourId, 100], [breadId, 20], [cakeId, 20]] as const) {
    await services.inventory.receive(user, { locationId: storeId, productId, quantity });
  }
  for (const [accountId, amount] of [[cashAccountId, 5000], [bankAccountId, 10000]] as const) {
    await services.cash.recordMovement(prisma, { organizationId, accountId, type: "OPENING_BALANCE" as never, amount, reason: "Начальный остаток", createdById: user.id });
  }

  // ── the ledger starts here; the position at this moment enters as ONE reviewed entry ──
  await sleep(30);
  await ledger.initializeSystemAccounts(user);
  startsAt = new Date();
  await ledger.enable(user, { startsAt: startsAt.toISOString() });
  await sleep(30);
  await ledger.postOpening(user, {
    lines: [
      { systemAccountKey: K.CASH_ON_HAND, amount: 5000 },
      { systemAccountKey: K.BANK, amount: 10000 },
      { systemAccountKey: K.INVENTORY, amount: 17000 }, // flour 100×100 + bread 20×50 + cake 20×300
      { systemAccountKey: K.OPENING_EQUITY, amount: 32000 },
    ],
  });
});

afterAll(async () => {
  if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
  else process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("the day's operations reach the ledger as they happen", () => {
  it("O. a cash sale: revenue, cash, and the cost of the loaves from the stamped cost", async () => {
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: breadId, quantity: 3, unitPrice: 500 }],
    } as never);
    // Traceable: the sale → its two accounting events → two entries.
    const events = await prisma.accountingEvent.findMany({ where: { organizationId: org.organizationId, sourceType: "Sale", sourceId: sale.id }, include: { journalEntry: { include: { lines: { include: { account: true } } } } } });
    expect(events.map((e) => e.eventKey).sort()).toEqual([`sale:${sale.id}`, `sale:${sale.id}:cost`]);
    expect(events.every((e) => e.status === AccountingEventStatus.POSTED && e.journalEntry)).toBe(true);
    const revenue = events.find((e) => e.eventKey === `sale:${sale.id}`)!.journalEntry!;
    expect(revenue.lines.map((l) => `${l.account.systemAccountKey} ${l.debit.toNumber() ? "Dr " + l.debit : "Cr " + l.credit}`).sort()).toEqual(["RECEIVABLES Dr 1500", "SALES_REVENUE Cr 1500"]);
    expect(revenue.lines.every((l) => l.locationId === org.storeId)).toBe(true); // dimension
    expect((await ledger.tracesForSource(org.organizationId, "Sale", sale.id)).map((e) => e.source?.eventKey).sort()).toEqual([`sale:${sale.id}`, `sale:${sale.id}:cost`]);
    // The money that came in is its own traced source: the cash movement.
    const receipt = await prisma.cashMovement.findFirstOrThrow({ where: { organizationId: org.organizationId, saleId: sale.id } });
    const receiptEntries = await ledger.tracesForSource(org.organizationId, "CashMovement", receipt.id);
    expect(receiptEntries).toHaveLength(1);
    expect(receiptEntries[0].lines.find((l) => l.cashAccountId)?.cashSection).toBe("OPERATING");
  });

  it("a card sale, a credit sale, a customer payment and a mixed sale", async () => {
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CARD, items: [{ productId: cakeId, quantity: 1, unitPrice: 1000 }] } as never);
    creditSaleId = (await services.sales.create(org.user, { locationId: org.storeId, customerId, amountPaid: 0, items: [{ productId: breadId, quantity: 2, unitPrice: 500 }] } as never)).id;
    await services.sales.recordPayment(org.user, creditSaleId, { amount: 400, accountId: org.cashAccountId });
    mixedSaleId = (
      await services.sales.create(org.user, {
        locationId: org.storeId,
        payments: [{ method: PaymentMethod.CASH, amount: 1200 }, { method: PaymentMethod.CARD, amount: 800 }],
        items: [{ productId: breadId, quantity: 4, unitPrice: 500 }],
      } as never)
    ).id;
    expect(await gl(K.RECEIVABLES)).toBe(600); // credit sale 1 000 − 400 paid
  });

  it("T. a refund on a mixed sale follows the original tenders: 60 % cash, 40 % card", async () => {
    await services.returns.create(org.user, mixedSaleId, { items: [{ productId: breadId, quantity: 1 }] }); // 500 restocked
    const refunds = await move("SALE_REFUND");
    expect(refunds).toEqual([
      { accountId: org.cashAccountId, amount: 300 },
      { accountId: org.bankAccountId, amount: 200 },
    ]);
    // Receivable: the return shrinks it by 500, the two refunds settle it back up by 500.
    expect(await gl(K.RECEIVABLES)).toBe(600);
  });

  it("P/M. a received purchase order after the cutover: inventory up, supplier payable up; paying it shrinks the payable", async () => {
    await services.procurement.activateCutover(org.user);
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: cakeId, quantity: 10, unitCost: 300 }] } as never);
    await services.procurement.receive(org.user, po.id);
    expect(await gl(K.SUPPLIER_PAYABLES)).toBe(3000);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: org.organizationId, accountingEvent: { eventKey: `purchaseOrder:${po.id}:receipt` } }, include: { lines: { include: { account: true } } } });
    expect(entry.lines.map((l) => l.account.systemAccountKey).sort()).toEqual(["INVENTORY", "SUPPLIER_PAYABLES"]);
    expect(entry.lines.every((l) => l.supplierId === supplierId)).toBe(true);
    await services.procurement.recordPayment(org.user, po.id, { accountId: org.bankAccountId, amount: 1000 });
    expect(await gl(K.SUPPLIER_PAYABLES)).toBe(2000);
  });

  it("expenses, and S: a card commission is an expense — revenue is not reduced", async () => {
    const opex = (name: string) =>
      prisma.financeCategory.create({
        data: { organizationId: org.organizationId, name, kind: FinanceCategoryKind.EXPENSE, pnlTreatment: "OPERATING_EXPENSE", cashActivity: "OPERATING", balanceTreatment: "NONE" },
      });
    const rent = await opex("Аренда");
    const acquiring = await opex("Эквайринг (комиссия за карты)");
    await services.finance.createExpense(org.user, { amount: 300, categoryId: rent.id, paidImmediately: true, accountId: org.cashAccountId } as never);
    await services.finance.createExpense(org.user, { amount: 200, categoryId: acquiring.id, paidImmediately: true, accountId: org.bankAccountId } as never);
    expect(await gl(K.OPERATING_EXPENSES)).toBe(500);
    expect(await gl(K.SALES_REVENUE)).toBe(5500); // untouched by the 200 commission
  });

  it("R. a write-off and a count correction are inventory losses at the stamped cost", async () => {
    await services.inventory.writeOff(org.user, { locationId: org.storeId, productId: breadId, quantity: 2, writeOffReason: WriteOffReason.EXPIRED } as never);
    const onHand = (await prisma.stockLevel.findFirstOrThrow({ where: { locationId: org.storeId, productId: breadId } })).quantity.toNumber();
    await services.inventory.adjust(org.user, { locationId: org.storeId, productId: breadId, actualQuantity: onHand - 1, reason: "Пересчёт" } as never);
    expect(await gl(K.INVENTORY_LOSSES)).toBe(150); // 2×50 + 1×50
  });

  it("Q. production: raw material becomes finished goods at cost — recorded, no ledger balance moves", async () => {
    const before = await gl(K.INVENTORY);
    const batch = await services.production.create(org.user, { recipeId: breadRecipeId, plannedQuantity: 4, locationId: org.storeId } as never);
    await services.production.start(org.user, batch.id);
    await services.production.complete(org.user, batch.id, { actualQuantity: 4 } as never);
    expect(await gl(K.INVENTORY)).toBe(before);
    const event = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, sourceId: batch.id } });
    expect(event.status).toBe(AccountingEventStatus.NO_GL_EFFECT);
    expect(event.eventType).toBe("PRODUCTION");
    expect(event.metadata).toMatchObject({ consumedValue: 200, outputValue: 200, outputQuantity: 4, costComponents: "INGREDIENT only (D6 not approved)" });
    expect(await prisma.journalEntry.count({ where: { organizationId: org.organizationId, accountingEvent: { sourceId: batch.id } } })).toBe(0);
  });

  it("transfers, owner contributions and capital purchases", async () => {
    await services.cash.transfer(org.user, { fromAccountId: org.cashAccountId, toAccountId: org.bankAccountId, amount: 300 });
    const contribution = await prisma.financeCategory.create({
      data: { organizationId: org.organizationId, name: "Взнос собственника", kind: FinanceCategoryKind.INCOME, pnlTreatment: "NOT_IN_PNL", cashActivity: "FINANCING", balanceTreatment: "OWNER_CONTRIBUTION" },
    });
    await services.cash.deposit(org.user, { accountId: org.bankAccountId, amount: 1000, reason: "Взнос", categoryId: contribution.id });
    const capital = await prisma.financeCategory.create({
      data: { organizationId: org.organizationId, name: "Оборудование", kind: FinanceCategoryKind.EXPENSE, pnlTreatment: "NOT_IN_PNL", cashActivity: "INVESTING", balanceTreatment: "FIXED_ASSET" },
    });
    const expense = await services.finance.createExpense(org.user, { amount: 2000, categoryId: capital.id, paidImmediately: true, accountId: org.bankAccountId } as never);
    await prisma.fixedAsset.create({
      data: { organizationId: org.organizationId, name: "Печь", acquisitionCost: 2000, acquiredAt: new Date(), sourceExpenseId: expense.id, createdById: org.user.id },
    });
    expect(await gl(K.OWNER_CONTRIBUTIONS)).toBe(1000);
    expect(await gl(K.FIXED_ASSETS)).toBe(2000);
  });

  it("a cancelled expense is cancelled in the book by a reversal, never by deleting its entry", async () => {
    const category = await prisma.financeCategory.findFirstOrThrow({ where: { organizationId: org.organizationId, name: "Аренда" } });
    const draft = await services.finance.createExpense(org.user, { amount: 700, categoryId: category.id, paidImmediately: false } as never);
    await services.finance.confirmExpense(org.organizationId, draft.id, org.user.id);
    expect(await gl(K.OPERATING_EXPENSES)).toBe(1200);
    await services.finance.cancelExpense(org.organizationId, draft.id, org.user.id);
    expect(await gl(K.OPERATING_EXPENSES)).toBe(500);
    expect(await gl(K.EXPENSE_PAYABLES)).toBe(0);
    const event = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventKey: `expense:${draft.id}:accrual` } });
    expect(event.status).toBe(AccountingEventStatus.REVERSED);
    expect(event.statusReason).toBe("SOURCE_CANCELLED");
    expect(await prisma.journalEntry.count({ where: { organizationId: org.organizationId, kind: "REVERSAL", reversalReason: "Источник операции отменён" } })).toBe(1);
  });
});

describe("the book, by hand", () => {
  it("every balance equals what the day's arithmetic says", async () => {
    expect({
      till: await gl(K.CASH_ON_HAND),
      bank: await gl(K.BANK),
      receivables: await gl(K.RECEIVABLES),
      inventory: await gl(K.INVENTORY),
      fixedAssets: await gl(K.FIXED_ASSETS),
      supplierPayables: await gl(K.SUPPLIER_PAYABLES),
      expensePayables: await gl(K.EXPENSE_PAYABLES),
      openingEquity: await gl(K.OPENING_EQUITY),
      owner: await gl(K.OWNER_CONTRIBUTIONS),
      revenue: await gl(K.SALES_REVENUE),
      returns: await gl(K.SALES_RETURNS),
      cogs: await gl(K.COST_OF_GOODS_SOLD),
      losses: await gl(K.INVENTORY_LOSSES),
      opex: await gl(K.OPERATING_EXPENSES),
    }).toEqual({
      till: 7200, // 5 000 +1 500 cash sale +400 payment +1 200 mixed −300 refund −300 rent −300 transfer
      bank: 9700, // 10 000 +1 000 card +800 mixed −200 refund −1 000 PO −200 commission +300 +1 000 owner −2 000 capital
      receivables: 600,
      inventory: 19150, // 17 000 −150 −300 −100 −200 +50 +3 000 −100 −50 (production moves nothing)
      fixedAssets: 2000,
      supplierPayables: 2000,
      expensePayables: 0,
      openingEquity: 32000,
      owner: 1000,
      revenue: 5500,
      returns: 500,
      cogs: 700,
      losses: 150,
      opex: 500,
    });
  });

  it("H. the trial balance balances, to the cent", async () => {
    const tb = await ledger.getTrialBalance(org.organizationId, {});
    expect(tb.totals.balanced).toBe(true);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
  });

  it("I. the P&L is read from the ledger and is what the day's arithmetic says", async () => {
    const pnl = await reports.getPnl(org.organizationId, startsAt, new Date(Date.now() + 1000));
    expect(pnl).toMatchObject({
      grossRevenue: 5500,
      discounts: 0,
      returns: 500,
      netRevenue: 5000,
      cogs: 700,
      grossProfit: 4300,
      inventoryLosses: 150,
      operatingExpenses: 500,
      depreciation: 0,
      operatingProfit: 3650,
      otherResult: 0,
      incomeTax: 0,
      netProfit: 3650,
    });
    // By location: everything happened at the one store.
    const store = await reports.getPnl(org.organizationId, startsAt, new Date(Date.now() + 1000), org.storeId);
    expect(store.grossRevenue).toBe(5500);
  });

  it("I. …and the existing P&L says the same, line by line — a reconciliation, not a hope", async () => {
    const rec = await reports.reconcilePnl(org.organizationId, startsAt, new Date(Date.now() + 1000));
    expect(rec.rows.filter((r) => r.difference !== 0)).toEqual([]);
    expect(rec.matches).toBe(true);
    expect(rec.unpostedEvents).toBe(0);
  });

  it("J. the balance sheet is read from the ledger and Assets = Liabilities + Equity without a plug", async () => {
    const sheet = await reports.getBalanceSheet(org.organizationId);
    expect(sheet.assets.total).toBe(38650);
    expect(sheet.liabilities.total).toBe(2000);
    expect(sheet.equity.accumulatedResult).toBe(3650);
    expect(sheet.equity.total).toBe(36650); // 32 000 + 1 000 + 3 650
    expect(sheet.difference).toBe(0);
    expect(sheet.balanced).toBe(true);
    expect(sheet.equity.currentPeriodResult + sheet.equity.retainedResult).toBe(3650);
  });

  it("K. the cash flow is read from the ledger, treats the opening position as a start, and closes on cash + bank", async () => {
    const flow = await reports.getCashFlow(org.organizationId, startsAt, new Date(Date.now() + 1000));
    expect(flow.openingBalance).toBe(15000);
    const section = (name: string) => flow.sections.find((s) => s.section === name)?.net;
    expect(section("OPERATING")).toBe(2900);
    expect(section("INVESTING")).toBe(-2000);
    expect(section("FINANCING")).toBe(1000);
    expect(flow.internalTransfers.net).toBe(0); // the 300 moved between own accounts is not an inflow
    expect(flow.internalTransfers.inflow).toBe(300);
    expect(flow.closingBalance).toBe(16900);
    expect(flow.closingBalance).toBe((await gl(K.CASH_ON_HAND)) + (await gl(K.BANK)));
    // …and agrees with the existing cash-flow statement.
    const legacy = await services.finance.getCashFlow(org.organizationId, startsAt, new Date(Date.now() + 1000));
    expect(legacy.closingBalance).toBe(16900);
  });
});

describe("the ledger against the operational subledgers (L, M, N, K)", () => {
  it("every reconciliation holds, and the whole diagnostic report is clean", async () => {
    const report = await diagnostics.run(org.organizationId);
    const failing = report.checks.filter((c) => c.status !== "PASS");
    expect(failing).toEqual([]);
    expect(report.checks.map((c) => c.check)).toEqual(
      expect.arrayContaining([
        "TB_BALANCED", "BALANCE_EQUATION", "INVENTORY_SUBLEDGER", "AP_SUBLEDGER", "AR_SUBLEDGER", "CASH_BANK_SUBLEDGER",
        "FIXED_ASSETS_SUBLEDGER", "PNL_EQUITY", "DDS_CASH", "ORPHAN_EVENTS", "ORPHAN_ENTRIES", "UNBALANCED_ENTRIES",
        "DUPLICATE_POSTING", "ENTRY_WITHOUT_PERIOD", "POSTING_INTO_CLOSED_PERIOD", "NEGATIVE_AMOUNTS", "INVALID_ACCOUNTS",
      ]),
    );
    const byCheck = Object.fromEntries(report.checks.map((c) => [c.check, c]));
    expect(byCheck.INVENTORY_SUBLEDGER).toMatchObject({ expected: 19150, actual: 19150, difference: 0 });
    expect(byCheck.AP_SUBLEDGER).toMatchObject({ expected: 2000, actual: 2000 });
    expect(byCheck.AR_SUBLEDGER).toMatchObject({ expected: 600, actual: 600 });
    expect(byCheck.CASH_BANK_SUBLEDGER).toMatchObject({ expected: 16900, actual: 16900 });
  });

  it("the diagnostics do not look away: a drifted cash balance, an orphan event and an empty entry are all reported", async () => {
    // 1. the cash subledger drifts by 5
    await prisma.cashAccount.update({ where: { id: org.cashAccountId }, data: { currentBalance: { increment: 5 } } });
    // 2. an event says POSTED but has no entry
    const orphan = await prisma.accountingEvent.create({
      data: { organizationId: org.organizationId, eventKey: "test:orphan", sourceType: "X", sourceId: "x", eventType: "SALE", eventDate: new Date(), status: "POSTED" },
    });
    // 3. an entry with no lines
    const period = await prisma.financialPeriod.findFirstOrThrow({ where: { organizationId: org.organizationId } });
    const empty = await prisma.journalEntry.create({
      data: { organizationId: org.organizationId, number: 8001, accountingPeriodId: period.id, entryDate: new Date(), description: "пустая", kind: "MANUAL", createdById: org.user.id, postedById: org.user.id },
    });
    try {
      const report = await diagnostics.run(org.organizationId);
      const by = Object.fromEntries(report.checks.map((c) => [c.check, c]));
      expect(by.CASH_BANK_SUBLEDGER).toMatchObject({ status: "FAIL", difference: -5, severity: "ERROR" }); // ledger − subledger
      expect(by.ORPHAN_EVENTS.status).toBe("FAIL");
      expect(by.UNBALANCED_ENTRIES.status).toBe("FAIL");
      // The made-up event is also a "posted" event whose source does not exist.
      expect(report.checks.filter((c) => c.status === "FAIL").map((c) => c.check).sort()).toEqual([
        "CASH_BANK_SUBLEDGER",
        "ORPHAN_EVENTS",
        "POSTED_SOURCE_VANISHED",
        "UNBALANCED_ENTRIES",
      ]);
    } finally {
      await prisma.cashAccount.update({ where: { id: org.cashAccountId }, data: { currentBalance: { decrement: 5 } } });
      await prisma.accountingEvent.delete({ where: { id: orphan.id } });
      await prisma.journalEntry.delete({ where: { id: empty.id } });
    }
    expect((await diagnostics.run(org.organizationId)).summary.fail).toBe(0);
  });
});

describe("coverage: what is in the book and what is not, said out loud", () => {
  it("shows every family with its state — nothing is faked to look complete", async () => {
    const coverage = await diagnostics.coverage(org.organizationId);
    const by = Object.fromEntries(coverage.rows.map((r) => [r.key, r]));
    expect(by.sales).toMatchObject({ status: CoverageStatus.GL_POSTED, notPosted: 0 });
    expect(by.returns.status).toBe(CoverageStatus.GL_POSTED);
    expect(by.purchases.status).toBe(CoverageStatus.GL_POSTED);
    expect(by.supplierPayments.status).toBe(CoverageStatus.GL_POSTED);
    expect(by.expenses.status).toBe(CoverageStatus.GL_POSTED);
    expect(by.stockLosses.status).toBe(CoverageStatus.GL_POSTED);
    expect(by.transfers.status).toBe(CoverageStatus.GL_POSTED);
    expect(by.owner.status).toBe(CoverageStatus.GL_POSTED);
    // History before the start is reported as not migrated — never silently converted.
    expect(by.manualReceipts.notMigrated).toBeGreaterThan(0);
    expect(by.manualReceipts.total).toBe(0);
    expect(by.opening.status).toBe(CoverageStatus.UNAPPROVED);
    expect(by.production.status).toBe(CoverageStatus.UNAPPROVED);
    expect(by.taxes.status).toBe(CoverageStatus.UNAPPROVED);
    expect(by.payroll.status).toBe(CoverageStatus.UNAPPROVED);
  });

  it("an operation whose other side is unknown stays out of the book, visibly, and nothing balances it", async () => {
    // Stock that simply appears (no purchase document): what paid for it is not recorded.
    const before = await gl(K.INVENTORY);
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: cakeId, quantity: 1 });
    expect(await gl(K.INVENTORY)).toBe(before);
    const held = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, status: "NOT_POSTED", statusReason: "UNCLASSIFIED" } });
    expect(held.sourceType).toBe("StockMovement");
    const coverage = await diagnostics.coverage(org.organizationId);
    expect(coverage.rows.find((r) => r.key === "manualReceipts")).toMatchObject({ status: CoverageStatus.NOT_POSTED, total: 1, notPosted: 1 });
    const report = await diagnostics.run(org.organizationId);
    // The inventory subledger now holds 300 more than the book — shown as a difference, not absorbed.
    expect(report.checks.find((c) => c.check === "INVENTORY_SUBLEDGER")).toMatchObject({ status: "FAIL", difference: -300 });
    expect(report.checks.find((c) => c.check === "UNPOSTED_OPERATIONS")?.status).toBe("WARNING");
    expect(report.checks.find((c) => c.check === "TB_BALANCED")?.status).toBe("PASS");
  });
});

describe("the declared opening position is offered, never applied", () => {
  it("proposes the declared figures from the finance setup, for a person to review", async () => {
    await prisma.organization.update({
      where: { id: org.organizationId },
      data: { financeInitializedAt: new Date(Date.now() - 2 * DAY), openingInventoryValue: 1000, openingReceivablesValue: 200, openingPayablesValue: 300 },
    });
    const proposal = await ledger.proposeOpening(org.organizationId);
    const by = Object.fromEntries(proposal.lines.map((l) => [l.systemAccountKey, l.amount]));
    expect(by).toMatchObject({ INVENTORY: 1000, RECEIVABLES: 200, SUPPLIER_PAYABLES: 300, CASH_ON_HAND: 5000, BANK: 10000 });
    expect(by.OPENING_EQUITY).toBe(5000 + 10000 + 1000 + 200 - 300);
    expect(proposal.notes.join(" ")).toMatch(/D3/);
    // Proposing changed nothing.
    expect(await gl(K.OPENING_EQUITY)).toBe(32000);
  });
});
