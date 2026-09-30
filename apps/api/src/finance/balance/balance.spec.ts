import { BalanceStatus, DepreciationMethod, PaymentMethod } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../../test/support/isolated-org";
import { buildServices } from "../../../test/support/services";
import { FinancialEventProjector } from "../events/projector";
import { checkEventInvariants } from "../events/invariants";
import { pnlFromEvents } from "../events/pnl-from-events";
import { FinanceSetupService } from "../finance-setup.service";
import { BalanceService } from "./balance.service";
import { FinancialPeriodsService } from "../periods/periods.service";
import { FixedAssetsService } from "../../fixed-assets/fixed-assets.service";
import { monthOf, monthRange } from "../../common/reporting-period";

// The whole picture in one throwaway organization: an opening position declared
// at go-live, then a realistic run of business, then statements built from
// events and checked against the ledgers — with no plug anywhere.

const prisma = new PrismaService();
const services = buildServices(prisma);
const projector = new FinancialEventProjector(prisma);
const balance = new BalanceService(prisma, services.finance, projector);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let assets: FixedAssetsService;
let flourId: string;
let breadId: string;
let mysteryId: string;
let consignId: string;
let supplierId: string;
let customerId: string;
const cat: Record<string, string> = {};
let goLive: Date;

const DAY = 86400_000;
const now = monthOf(new Date());
const back = (n: number) => {
  let y = now.year;
  let m = now.month - n;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return { year: y, month: m };
};
const category = async (name: string, kind: "EXPENSE" | "INCOME", pnl: string, cash: string, bal: string) => {
  cat[name] = (await prisma.financeCategory.create({ data: { organizationId: org.organizationId, name, kind, pnlTreatment: pnl as never, cashActivity: cash as never, balanceTreatment: bal as never } })).id;
};
const sheet = () => balance.getBalanceSheet(org.organizationId);
const allEvents = () => projector.project(org.organizationId);

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "balance");
  assets = new FixedAssetsService(prisma, services.cash);
  const id = org.organizationId;
  const mk = (data: object) => prisma.product.create({ data: { organizationId: id, unit: "PCS", ...data } as never });
  flourId = (await mk({ name: "Мука", sku: "B-1", unit: "KG", type: "RAW_MATERIAL", price: 100 })).id;
  breadId = (await mk({ name: "Хлеб", sku: "B-2", type: "FINISHED_GOOD", price: 500 })).id;
  mysteryId = (await mk({ name: "Без цены", sku: "B-3", type: "FINISHED_GOOD", price: 200 })).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Мельница" } })).id;
  consignId = (await mk({ name: "Чужой торт", sku: "B-4", type: "FINISHED_GOOD", price: 900, consignmentSupplierId: supplierId, consignmentPrice: 600 })).id;
  customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Оптовик" } })).id;
  await prisma.recipe.create({ data: { organizationId: id, productId: breadId, yieldQuantity: 4, items: { create: [{ ingredientProductId: flourId, quantity: 2 }] } } });

  await category("Аренда", "EXPENSE", "OPERATING_EXPENSE", "OPERATING", "NONE");
  await category("Оборудование", "EXPENSE", "NOT_IN_PNL", "INVESTING", "FIXED_ASSET");
  await category("Проценты", "EXPENSE", "FINANCIAL_EXPENSE", "FINANCING", "NONE");
  await category("Налог", "EXPENSE", "INCOME_TAX", "OPERATING", "NONE");
  await category("Недостача", "EXPENSE", "OTHER_EXPENSE", "OPERATING", "NONE");
  await category("Взнос", "INCOME", "NOT_IN_PNL", "FINANCING", "OWNER_CONTRIBUTION");
  await category("Изъятие", "EXPENSE", "NOT_IN_PNL", "FINANCING", "OWNER_WITHDRAWAL");
  await category("Займ", "INCOME", "NOT_IN_PNL", "FINANCING", "LOAN_PROCEEDS");
  await category("Погашение", "EXPENSE", "NOT_IN_PNL", "FINANCING", "LOAN_REPAYMENT");
  await category("Прочий доход", "INCOME", "OTHER_INCOME", "OPERATING", "NONE");

  // ── before go-live: opening cash and opening stock ────────────────────
  for (const [accountId, amount] of [[org.cashAccountId, 5000], [org.bankAccountId, 10000]] as const) {
    await services.cash.recordMovement(prisma, { organizationId: id, accountId, type: "OPENING_BALANCE" as never, amount, reason: "Начальный остаток", createdById: org.user.id });
  }
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: flourId, quantity: 100 });
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 40 });
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: mysteryId, quantity: 10 });
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: consignId, quantity: 10 });
  await new FinanceSetupService(prisma, services.finance).complete(org.user);

  // Put the opening 100 days back so the business below sits clearly after it.
  goLive = new Date(Date.now() - 100 * DAY);
  await prisma.organization.update({ where: { id }, data: { financeInitializedAt: goLive } });
  await prisma.stockMovement.updateMany({ where: { organizationId: id }, data: { createdAt: new Date(goLive.getTime() - DAY) } });
  await prisma.cashMovement.updateMany({ where: { organizationId: id }, data: { occurredAt: new Date(goLive.getTime() - DAY) } });
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

describe("before any business: the declared opening", () => {
  it("balances on the opening alone, and the opening equity is exactly what was declared", async () => {
    const s = await sheet();
    // cash 15 000 + flour 100 × 100 + bread 40 × 50 + mystery (no cost → 0) + consignment goods (no cost → 0)
    expect(s.assets.total).toBe(15000 + 10000 + 2000);
    expect(s.equity.lines.find((l) => l.line === "OPENING_EQUITY")!.amount).toBe(27000);
    expect(s.status).toBe(BalanceStatus.BALANCED);
    expect(s.control.difference).toBe(0);
    expect(s.control.lines).toEqual([]);
  });
});

describe("a realistic run of business", () => {
  beforeAll(async () => {
    const u = org.user;
    const sell = (dto: object) => services.sales.create(u, { locationId: org.storeId, ...dto } as never);
    // cash and card sales, one on credit, one at a markdown, one unknown-cost, one consignment
    const cashSale = await sell({ paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 4, unitPrice: 500 }] });
    await sell({ paymentMethod: PaymentMethod.CARD, items: [{ productId: breadId, quantity: 2, unitPrice: 500 }] });
    await sell({ customerId, amountPaid: 300, items: [{ productId: breadId, quantity: 2, unitPrice: 500 }] });
    await sell({ paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 1, unitPrice: 250, fullUnitPrice: 500 }] });
    await sell({ paymentMethod: PaymentMethod.CASH, items: [{ productId: mysteryId, quantity: 1, unitPrice: 200 }] });
    await sell({ paymentMethod: PaymentMethod.CASH, items: [{ productId: consignId, quantity: 2, unitPrice: 900 }] });
    // a restocked and a scrapped return of the cash sale
    await services.returns.create(u, cashSale.id, { items: [{ productId: breadId, quantity: 1 }] });
    await services.returns.create(u, cashSale.id, { items: [{ productId: breadId, quantity: 1 }], restocked: false });
    // stock losses
    await services.inventory.writeOff(u, { locationId: org.storeId, productId: flourId, quantity: 3, reason: "Порча", writeOffReason: "DAMAGED" as never });
    const st = await services.stocktake.create(u, { locationId: org.storeId });
    const line = st.lines.find((l) => l.productId === flourId)!;
    await services.stocktake.updateLine(u, st.id, line.id, { countedQuantity: line.systemQuantity - 2 });
    await services.stocktake.submit(u, st.id);
    await services.stocktake.approve(u, st.id);
    // expenses: paid operating, capital, partly unpaid, tax
    await services.finance.createExpense(u, { amount: 2000, categoryId: cat["Аренда"], paidImmediately: true, accountId: org.bankAccountId });
    const owed = await services.finance.createExpense(u, { amount: 700, categoryId: cat["Аренда"], paidImmediately: false });
    await services.finance.confirmExpense(org.organizationId, owed.id, u.id);
    await services.finance.recordExpensePayment(u, owed.id, { accountId: org.bankAccountId, amount: 200 } as never);
    const equipment = await services.finance.createExpense(u, { amount: 12000, categoryId: cat["Оборудование"], paidImmediately: true, accountId: org.bankAccountId, description: "Печь" });
    await assets.register(u, { name: "Печь", sourceExpenseId: equipment.id });
    // owner / financing / other
    await services.cash.deposit(u, { accountId: org.bankAccountId, amount: 3000, categoryId: cat["Взнос"], reason: "Взнос" });
    await services.cash.deposit(u, { accountId: org.bankAccountId, amount: 6000, categoryId: cat["Займ"], reason: "Займ" });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 1000, categoryId: cat["Изъятие"], reason: "Изъятие" });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 500, categoryId: cat["Погашение"], reason: "Погашение" });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 150, categoryId: cat["Проценты"], reason: "Проценты" });
    await services.cash.deposit(u, { accountId: org.bankAccountId, amount: 400, categoryId: cat["Прочий доход"], reason: "Прочее" });
    await services.cash.transfer(u, { fromAccountId: org.bankAccountId, toAccountId: org.cashAccountId, amount: 800 });
    const cashNow = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.cashAccountId } })).currentBalance.toNumber();
    await services.cash.adjust(u, { accountId: org.cashAccountId, actualBalance: cashNow - 60, reason: "Недостача", categoryId: cat["Недостача"] });
    // purchasing after the cutover: receive and pay part
    await services.procurement.activateCutover(u);
    const po = await services.procurement.create(u, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 50, unitCost: 110 }] } as never);
    await services.procurement.receive(u, po.id);
    await services.procurement.recordPayment(u, po.id, { accountId: org.bankAccountId, amount: 2000 });
    // depreciation of the new oven: explicit terms, two elapsed months
    const oven = (await assets.list(org.organizationId))[0];
    const start = back(2);
    await assets.setTerms(u, oven.id, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 12, salvageValue: 0, startYear: start.year, startMonth: start.month });
    await assets.runDepreciation(u, back(1).year, back(1).month);
  });

  it("every classified event balances (I1), cash legs match (I2), keys are unique (I3), transfers net zero (I4)", async () => {
    const events = await allEvents();
    const report = checkEventInvariants(events);
    expect(report.violations).toEqual([]);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
    const types = new Set(events.map((e) => e.type));
    for (const t of ["OPENING_BALANCE", "OPENING_POSITION", "SALE", "SALE_COST", "SALE_RETURN", "SALE_RETURN_COST", "EXPENSE_ACCRUAL", "INVENTORY_LOSS", "PURCHASE_RECEIPT", "DEPRECIATION", "INTERNAL_TRANSFER", "OWNER_CONTRIBUTION", "LOAN_PROCEEDS"]) {
      expect(types.has(t as never)).toBe(true);
    }
  });

  it("the same sources always project the identical events (I5)", async () => {
    expect(JSON.stringify(await allEvents())).toBe(JSON.stringify(await allEvents()));
  });

  it("the P&L rebuilt from events equals the direct P&L, line by line", async () => {
    const from = new Date(goLive.getTime());
    const to = new Date(Date.now() + 3600_000);
    const direct = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    const viaEvents = pnlFromEvents(await allEvents(), from, to);
    expect(viaEvents.grossRevenue).toBe(direct.grossRevenue);
    expect(viaEvents.discounts).toBe(direct.discountsTotal);
    expect(viaEvents.returns).toBe(direct.returnsTotal);
    expect(viaEvents.netRevenue).toBe(direct.netRevenue);
    expect(viaEvents.cogs).toBe(direct.cogs);
    expect(viaEvents.inventoryLosses).toBe(direct.inventoryLosses);
    expect(viaEvents.operatingExpenses).toBe(direct.expensesTotal);
    expect(viaEvents.depreciation).toBe(direct.depreciation);
    expect(viaEvents.otherResult).toBe(direct.otherResult);
    expect(viaEvents.incomeTax).toBe(direct.incomeTax ?? 0);
    expect(viaEvents.operatingProfit).toBe(direct.operatingProfit);
    expect(viaEvents.netProfit).toBe(direct.netProfit);
  });

  it("return economics: revenue reverses on both, cost only on the restocked one", async () => {
    const events = await allEvents();
    const returns = events.filter((e) => e.type === "SALE_RETURN");
    expect(returns).toHaveLength(2);
    expect(returns.every((e) => e.pnl[0].amount === -500)).toBe(true);
    const costBack = events.filter((e) => e.type === "SALE_RETURN_COST");
    expect(costBack).toHaveLength(1);
    expect(costBack[0].pnl).toEqual([{ line: "COGS", amount: 50 }]);
    expect(costBack[0].balance).toEqual([{ line: "INVENTORY", delta: 50 }]);
  });

  it("a consignment sale creates a payable to the owner instead of drawing down our inventory", async () => {
    const events = await allEvents();
    const cost = events.find((e) => e.type === "SALE_COST" && e.balance.some((b) => b.line === "CONSIGNMENT_PAYABLES"))!;
    // 2 × 600
    expect(cost.balance).toEqual([{ line: "CONSIGNMENT_PAYABLES", delta: 1200 }]);
    expect(cost.pnl).toEqual([{ line: "COGS", amount: -1200 }]);
    expect(await services.finance.getConsignmentOwed(org.organizationId)).toBe(1200);
  });

  it("the cash-flow statement closes on the account ledgers", async () => {
    const flow = await services.finance.getCashFlow(org.organizationId, goLive, new Date(Date.now() + 3600_000));
    const accounts = await prisma.cashAccount.findMany({ where: { organizationId: org.organizationId } });
    expect(flow.closingBalance).toBe(round(accounts.reduce((s, a) => s + a.currentBalance.toNumber(), 0)));
    expect(flow.reconciliation).toMatchObject({ reconciles: true, difference: 0 });
  });
});

const round = (v: number) => Math.round(v * 100) / 100;

describe("the balance sheet after the business", () => {
  it("every line agrees with its ledger except ONE: the stock valuation basis, which CONTROL shows on its own", async () => {
    const s = await sheet();
    const amount = (lines: { line: string; amount: number }[], line: string) => lines.find((l) => l.line === line)!.amount;
    expect(amount(s.assets.lines, "CASH_AND_BANK")).toBe(11040);
    expect(amount(s.assets.lines, "RECEIVABLES")).toBe(700); // 1 000 on credit − 300 paid
    expect(amount(s.assets.lines, "FIXED_ASSETS")).toBe(10000); // 12 000 oven − 2 × 1 000 depreciation
    expect(amount(s.liabilities.lines, "SUPPLIER_PAYABLES")).toBe(3500); // 5 500 received − 2 000 paid
    expect(amount(s.liabilities.lines, "EXPENSE_PAYABLES")).toBe(500); // 700 − 200
    expect(amount(s.liabilities.lines, "CONSIGNMENT_PAYABLES")).toBe(1200);
    expect(amount(s.liabilities.lines, "LOANS")).toBe(5500); // 6 000 − 500 repaid
    expect(s.equity.lines.map((l) => l.amount)).toEqual([27000, 3000, -1000]);
    expect(s.equity.accumulatedResult).toBe(-1360);
    expect(s.equity.total).toBe(27640);
    // The 50 kg of flour was received at 110 but the costing service values raw
    // material at its price field (100): a genuine basis difference, in CONTROL,
    // added to nothing.
    expect(s.status).toBe(BalanceStatus.NOT_BALANCED);
    expect(s.control.difference).toBe(-500);
    expect(s.control.lines).toEqual([{ label: expect.stringMatching(/Запасы/), actual: 16100, projected: 16600, effect: -500 }]);
    expect(s.assets.total - s.liabilities.total).toBe(27140);
  });

  it("assets, liabilities and equity are built from their own sources", async () => {
    const s = await sheet();
    expect(s.assets.lines.map((l) => [l.line, l.source])).toEqual([
      ["CASH_AND_BANK", "LEDGER"], ["INVENTORY", "LEDGER"], ["RECEIVABLES", "DOCUMENTS"], ["FIXED_ASSETS", "REGISTER"],
    ]);
    expect(s.equity.lines.every((l) => l.source === "EVENTS")).toBe(true);
    expect(s.equity.accumulatedResult).not.toBe(0);
    expect(s.assets.total).toBe(round(s.assets.lines.reduce((a, l) => a + l.amount, 0)));
    expect(s.equity.total).toBe(round(s.equity.lines.reduce((a, l) => a + l.amount, 0) + s.equity.accumulatedResult));
    // The control section is separate: it is not a line of any side.
    for (const side of [s.assets, s.liabilities, s.equity]) {
      expect(side.lines.some((l) => /разниц|корректир|баланс/i.test(l.label))).toBe(false);
    }
  });

  it("every control line is a real comparison, and together they explain the difference exactly (no remainder line)", async () => {
    const s = await sheet();
    const explained = round(s.control.lines.reduce((a, l) => a + l.effect, 0));
    expect(explained).toBeCloseTo(s.control.difference, 1);
    expect(s.control.difference).toBe(round(s.assets.total - s.liabilities.total - s.equity.total));
  });
});

describe("no plug", () => {
  it("money that entered without a classification unbalances the statement and is shown in CONTROL, not folded into equity", async () => {
    const before = await sheet();
    await services.cash.deposit(org.user, { accountId: org.bankAccountId, amount: 777, reason: "Неизвестное поступление" });
    const after = await sheet();
    expect(after.status).toBe(BalanceStatus.NOT_BALANCED);
    // Assets rose by the cash; equity did NOT follow it.
    expect(round(after.assets.total - before.assets.total)).toBe(777);
    expect(after.equity.total).toBe(before.equity.total);
    expect(after.liabilities.total).toBe(before.liabilities.total);
    // The gap is exactly that money, listed on its own in CONTROL.
    expect(round(after.control.difference - before.control.difference)).toBe(777);
    const line = after.control.lines.find((l) => /без классификации/.test(l.label))!;
    expect(line.effect).toBe(777);
  });

  it("editing an asset behind the events' back moves Assets and the CONTROL line, never Equity", async () => {
    const before = await sheet();
    const level = await prisma.stockLevel.findFirstOrThrow({ where: { organizationId: org.organizationId, productId: flourId } });
    await prisma.stockLevel.update({ where: { id: level.id }, data: { quantity: { increment: 10 } } });
    const after = await sheet();
    expect(round(after.assets.total - before.assets.total)).toBe(1000); // 10 × 100
    expect(after.equity.total).toBe(before.equity.total);
    expect(after.control.lines.some((l) => /Запасы/.test(l.label))).toBe(true);
    await prisma.stockLevel.update({ where: { id: level.id }, data: { quantity: { decrement: 10 } } });
  });

  it("opening equity is the declared figure and does not move with later assets", async () => {
    const s = await sheet();
    expect(s.equity.lines.find((l) => l.line === "OPENING_EQUITY")!.amount).toBe(27000);
  });

  it("with no declared opening the balance is NOT_AVAILABLE and builds no equity", async () => {
    const other = await createIsolatedOrg(prisma, "balance-none");
    try {
      const s = await balance.getBalanceSheet(other.organizationId);
      expect(s.status).toBe(BalanceStatus.NOT_AVAILABLE);
      expect(s.equity.total).toBe(0);
      expect(s.control.notes[0]).toMatch(/не заявлено/);
    } finally {
      await destroyOrg(prisma, other.organizationId);
    }
  });
});

describe("credit-sale returns are representable", () => {
  it("a return against an unpaid balance shrinks the receivable before anything is paid; a refund settles what was paid", async () => {
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId, customerId, amountPaid: 0, items: [{ productId: breadId, quantity: 2, unitPrice: 500 }],
    } as never);
    // No refundable payment exists, so the service refuses; the document model still represents it.
    await expect(services.returns.create(org.user, sale.id, { items: [{ productId: breadId, quantity: 1 }] })).rejects.toThrow();
    const ret = await prisma.saleReturn.create({
      data: {
        organizationId: org.organizationId, saleId: sale.id, locationId: org.storeId, totalAmount: 500, restocked: true, createdById: org.user.id,
        items: { create: [{ productId: breadId, quantity: 1, unitPrice: 500, subtotal: 500 }] },
      },
    });
    const events = await allEvents();
    const forSale = events.filter((e) => e.sourceId === sale.id || e.sourceId === ret.id);
    const receivable = forSale.flatMap((e) => e.balance).filter((b) => b.line === "RECEIVABLES").reduce((s, b) => s + b.delta, 0);
    expect(receivable).toBe(1000 - 500); // sold 1 000, 500 of it taken back, nothing paid
    expect(checkEventInvariants(events).violations).toEqual([]);
    await prisma.saleReturn.delete({ where: { id: ret.id } });
  });
});

describe("inventory roll-forward", () => {
  it("explains the movement of stock by type and reconciles quantities with the ledger", async () => {
    const roll = await balance.getInventoryRollForward(org.organizationId, new Date(goLive.getTime()), new Date(Date.now() + 3600_000));
    expect(roll.reconciles).toBe(true);
    expect(roll.difference?.quantity).toBe(0);
    const keys = roll.movements.map((m) => m.key);
    for (const k of ["SALE", "SALE_RETURN", "WRITE_OFF", "ADJUSTMENT", "RECEIPT"]) expect(keys).toContain(k);
    expect(roll.closingComputed.quantity).toBe(round(roll.opening.quantity + roll.movements.reduce((s, m) => s + m.quantity, 0)));
    // The scrapped return's WRITE_OFF marker moves nothing.
    const writeOff = roll.movements.find((m) => m.key === "WRITE_OFF")!;
    expect(writeOff.quantity).toBe(-3); // only the real write-off of 3 kg
  });

  it("a stock level edited behind the ledger's back is reported as a difference, never absorbed", async () => {
    const level = await prisma.stockLevel.findFirstOrThrow({ where: { organizationId: org.organizationId, productId: breadId } });
    await prisma.stockLevel.update({ where: { id: level.id }, data: { quantity: { increment: 4 } } });
    const roll = await balance.getInventoryRollForward(org.organizationId, goLive, new Date(Date.now() + 3600_000));
    expect(roll.reconciles).toBe(false);
    expect(roll.difference?.quantity).toBe(4);
    expect(roll.closingComputed.quantity + 4).toBe(roll.closingActual?.quantity);
    await prisma.stockLevel.update({ where: { id: level.id }, data: { quantity: { decrement: 4 } } });
  });
});

describe("monthly report and frozen snapshots", () => {
  it("the monthly report assembles P&L, cash flow, balance and roll-forward for one month", async () => {
    const report = await balance.getMonthlyReport(org.organizationId, now.year, now.month);
    expect(report.pnl.netRevenue).toBeGreaterThan(0);
    expect(report.balance.asOf).toBeDefined();
    expect(report.inventory.movements.length).toBeGreaterThan(0);
    expect(report.previousPnl).not.toBeNull();
    expect(report.cashFlow.sections.length).toBe(4);
  });

  it("closing a period stores the balance and the inventory roll-forward with it, frozen", async () => {
    const periods = new FinancialPeriodsService(prisma, services.finance, projector);
    balance.registerWithPeriods(periods);
    const m = back(1);
    const snapshot = await periods.close(org.user, m.year, m.month);
    expect(snapshot.payload).toHaveProperty("balance");
    expect(snapshot.payload).toHaveProperty("inventory");
    expect(snapshot.diagnostics).toHaveProperty("pnlParityDifference");
    const frozen = (snapshot.payload as unknown as { balance: { asOf: string } }).balance.asOf;
    expect(new Date(frozen).getTime()).toBe(monthRange(m.year, m.month).end.getTime());
  });
});
