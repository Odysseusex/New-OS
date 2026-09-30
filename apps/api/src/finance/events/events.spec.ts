import {
  BalanceTreatment,
  CashActivity,
  CashSection,
  FinanceCategoryKind,
  PnlTreatment,
  validateClassification,
} from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../../test/support/isolated-org";
import { buildServices } from "../../../test/support/services";
import { FinancialEventProjector } from "./projector";
import { checkEventInvariants } from "./invariants";
import { AUDIT_ACTION_GROUPS } from "../../audit/audit";
import { FinanceCategoriesService } from "../finance-categories.service";

// Phase 4: category classification, the cash side of the event catalogue, and
// the cash-flow statement built from it. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const projector = new FinancialEventProjector(prisma);
const categories = new FinanceCategoriesService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
const cat: Record<string, string> = {};
let from: Date;
let to: Date;

async function mkCategory(name: string, kind: FinanceCategoryKind, pnl: PnlTreatment, cash: CashActivity, balance: BalanceTreatment) {
  const created = await prisma.financeCategory.create({
    data: { organizationId: org.organizationId, name, kind, pnlTreatment: pnl, cashActivity: cash, balanceTreatment: balance },
  });
  cat[name] = created.id;
  return created.id;
}

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "events");
  const E = FinanceCategoryKind.EXPENSE;
  const I = FinanceCategoryKind.INCOME;
  await mkCategory("Аренда", E, PnlTreatment.OPERATING_EXPENSE, CashActivity.OPERATING, BalanceTreatment.NONE);
  await mkCategory("Оборудование", E, PnlTreatment.NOT_IN_PNL, CashActivity.INVESTING, BalanceTreatment.FIXED_ASSET);
  await mkCategory("Изъятие", E, PnlTreatment.NOT_IN_PNL, CashActivity.FINANCING, BalanceTreatment.OWNER_WITHDRAWAL);
  await mkCategory("Погашение займа", E, PnlTreatment.NOT_IN_PNL, CashActivity.FINANCING, BalanceTreatment.LOAN_REPAYMENT);
  await mkCategory("Проценты", E, PnlTreatment.FINANCIAL_EXPENSE, CashActivity.FINANCING, BalanceTreatment.NONE);
  await mkCategory("Налог", E, PnlTreatment.INCOME_TAX, CashActivity.OPERATING, BalanceTreatment.NONE);
  await mkCategory("Недостача", E, PnlTreatment.OTHER_EXPENSE, CashActivity.OPERATING, BalanceTreatment.NONE);
  await mkCategory("Взнос", I, PnlTreatment.NOT_IN_PNL, CashActivity.FINANCING, BalanceTreatment.OWNER_CONTRIBUTION);
  await mkCategory("Займ", I, PnlTreatment.NOT_IN_PNL, CashActivity.FINANCING, BalanceTreatment.LOAN_PROCEEDS);
  await mkCategory("Прочий доход", I, PnlTreatment.OTHER_INCOME, CashActivity.OPERATING, BalanceTreatment.NONE);
  await mkCategory("Неразобранное", E, PnlTreatment.UNCLASSIFIED, CashActivity.UNCLASSIFIED, BalanceTreatment.UNCLASSIFIED);
  from = new Date(Date.now() - 3600_000);
  to = new Date(Date.now() + 3600_000);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

const openingFor = async (accountId: string, amount: number, daysAgo: number) => {
  const m = await services.cash.recordMovement(prisma, {
    organizationId: org.organizationId, accountId, type: "OPENING_BALANCE" as never, amount, reason: "Начальный остаток", createdById: org.user.id,
  });
  await prisma.cashMovement.update({ where: { id: m.id }, data: { occurredAt: new Date(Date.now() - daysAgo * 86400_000) } });
};

describe("classification rules", () => {
  const E = FinanceCategoryKind.EXPENSE;
  const I = FinanceCategoryKind.INCOME;
  const c = (p: PnlTreatment, a: CashActivity, b: BalanceTreatment) => ({ pnlTreatment: p, cashActivity: a, balanceTreatment: b });

  it("accepts coherent combinations and refuses incoherent or partial ones", () => {
    expect(validateClassification(E, c(PnlTreatment.OPERATING_EXPENSE, CashActivity.OPERATING, BalanceTreatment.NONE))).toBeNull();
    expect(validateClassification(E, c(PnlTreatment.NOT_IN_PNL, CashActivity.INVESTING, BalanceTreatment.FIXED_ASSET))).toBeNull();
    expect(validateClassification(I, c(PnlTreatment.NOT_IN_PNL, CashActivity.FINANCING, BalanceTreatment.OWNER_CONTRIBUTION))).toBeNull();
    expect(validateClassification(E, c(PnlTreatment.UNCLASSIFIED, CashActivity.UNCLASSIFIED, BalanceTreatment.UNCLASSIFIED))).toBeNull();
    // partial
    expect(validateClassification(E, c(PnlTreatment.OPERATING_EXPENSE, CashActivity.UNCLASSIFIED, BalanceTreatment.NONE))).not.toBeNull();
    // a capital purchase is not operating
    expect(validateClassification(E, c(PnlTreatment.NOT_IN_PNL, CashActivity.OPERATING, BalanceTreatment.FIXED_ASSET))).not.toBeNull();
    // an income category cannot be an expense line
    expect(validateClassification(I, c(PnlTreatment.OPERATING_EXPENSE, CashActivity.OPERATING, BalanceTreatment.NONE))).not.toBeNull();
    // a result line cannot carry a balance meaning
    expect(validateClassification(E, c(PnlTreatment.OPERATING_EXPENSE, CashActivity.OPERATING, BalanceTreatment.FIXED_ASSET))).not.toBeNull();
    // owner flows are financing
    expect(validateClassification(E, c(PnlTreatment.NOT_IN_PNL, CashActivity.OPERATING, BalanceTreatment.OWNER_WITHDRAWAL))).not.toBeNull();
  });

  it("setClassification stores a valid triple, audits it, and rejects an invalid one", async () => {
    const id = (await prisma.financeCategory.create({ data: { organizationId: org.organizationId, name: "Тест", kind: "EXPENSE" } })).id;
    await expect(
      categories.setClassification(org.organizationId, id, c(PnlTreatment.NOT_IN_PNL, CashActivity.OPERATING, BalanceTreatment.FIXED_ASSET), org.user.id),
    ).rejects.toThrow();
    const saved = await categories.setClassification(
      org.organizationId, id, c(PnlTreatment.OPERATING_EXPENSE, CashActivity.OPERATING, BalanceTreatment.NONE), org.user.id, "проверка",
    );
    expect(saved).toMatchObject({ pnlTreatment: "OPERATING_EXPENSE", cashActivity: "OPERATING", balanceTreatment: "NONE" });
    const log = await prisma.auditLog.findFirst({ where: { organizationId: org.organizationId, action: "financeCategory.classification" } });
    expect(log?.reason).toBe("проверка");
    expect(AUDIT_ACTION_GROUPS.classification).toContain("financeCategory.classification");
  });
});

describe("cash adjustment carries a classification", () => {
  it("is refused without a fully classified category of the right kind, and never defaults to other result", async () => {
    await openingFor(org.cashAccountId, 1000, 30);
    await expect(
      services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 900, reason: "x", categoryId: cat["Неразобранное"] }),
    ).rejects.toThrow(/классификаци/);
    // an overage needs an INCOME-kind category
    await expect(
      services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 1100, reason: "x", categoryId: cat["Недостача"] }),
    ).rejects.toThrow(/доходов/);
    const ok = await services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 900, reason: "Недостача", categoryId: cat["Недостача"] });
    expect(ok.amount).toBe(-100);
    expect(ok.categoryId).toBe(cat["Недостача"]);
  });

  it("two simultaneous adjustments to the same true balance record exactly one difference", async () => {
    const attempts = await Promise.allSettled([
      services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 850, reason: "a", categoryId: cat["Недостача"] }),
      services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 850, reason: "b", categoryId: cat["Недостача"] }),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const account = await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.cashAccountId } });
    expect(account.currentBalance.toNumber()).toBe(850);
  });

  it("two simultaneous transfers cannot overdraw the source account together", async () => {
    await openingFor(org.bankAccountId, 500, 30);
    const attempts = await Promise.allSettled([
      services.cash.transfer(org.user, { fromAccountId: org.bankAccountId, toAccountId: org.cashAccountId, amount: 400 }),
      services.cash.transfer(org.user, { fromAccountId: org.bankAccountId, toAccountId: org.cashAccountId, amount: 400 }),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const bank = await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.bankAccountId } });
    expect(bank.currentBalance.toNumber()).toBe(100);
  });
});

describe("events and the cash-flow statement", () => {
  beforeAll(async () => {
    const u = org.user;
    await services.cash.deposit(u, { accountId: org.bankAccountId, amount: 5000, reason: "Взнос", categoryId: cat["Взнос"] });
    await services.cash.deposit(u, { accountId: org.bankAccountId, amount: 2000, reason: "Кредит", categoryId: cat["Займ"] });
    await services.cash.deposit(u, { accountId: org.bankAccountId, amount: 300, reason: "Прочее", categoryId: cat["Прочий доход"] });
    await services.cash.deposit(u, { accountId: org.bankAccountId, amount: 700, reason: "Без категории" });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 400, reason: "Изъятие", categoryId: cat["Изъятие"] });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 250, reason: "Погашение", categoryId: cat["Погашение займа"] });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 120, reason: "Проценты", categoryId: cat["Проценты"] });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 90, reason: "Налог", categoryId: cat["Налог"] });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 800, reason: "Станок", categoryId: cat["Оборудование"] });
    await services.cash.withdraw(u, { accountId: org.bankAccountId, amount: 60, reason: "Не разобрано" });
    // expenses: operating (paid), capital (paid), unclassified (paid)
    await services.finance.createExpense(u, { amount: 1000, categoryId: cat["Аренда"], paidImmediately: true, accountId: org.bankAccountId });
    await services.finance.createExpense(u, { amount: 300, categoryId: cat["Неразобранное"], paidImmediately: true, accountId: org.bankAccountId });
  });

  it("every classified event balances by itself; transfers net to zero; keys are unique", async () => {
    const events = await projector.project(org.organizationId);
    const report = checkEventInvariants(events);
    expect(report.violations).toEqual([]);
    expect(report.eventCount).toBeGreaterThan(10);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
    const transfer = events.find((e) => e.type === "INTERNAL_TRANSFER")!;
    expect(transfer.cash.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(transfer.pnl).toEqual([]);
  });

  it("unclassified money is visible and marked incomplete, never given an invented counter-side", async () => {
    const events = await projector.project(org.organizationId);
    const bare = events.filter((e) => e.unclassified);
    expect(bare.length).toBeGreaterThanOrEqual(2);
    for (const e of bare) {
      expect(e.pnl).toEqual([]);
      expect(e.balance.every((b) => b.line === "CASH_AND_BANK")).toBe(true);
    }
    expect(checkEventInvariants(events).incompleteEvents).toBe(bare.length);
  });

  it("replaying the same sources gives byte-identical events (I5)", async () => {
    const a = JSON.stringify(await projector.project(org.organizationId));
    const b = JSON.stringify(await projector.project(org.organizationId));
    expect(a).toBe(b);
  });

  it("puts each flow in its own section, opening never an inflow, and reconciles with the account ledgers", async () => {
    const flow = await services.finance.getCashFlow(org.organizationId, from, to);
    const section = (name: CashSection) => flow.sections.find((s) => s.section === name)!;
    const line = (name: CashSection, label: string) => section(name).lines.find((l) => l.label === label);

    expect(line(CashSection.FINANCING, "Взнос")).toMatchObject({ inflow: 5000 });
    expect(line(CashSection.FINANCING, "Займ")).toMatchObject({ inflow: 2000 });
    expect(line(CashSection.FINANCING, "Изъятие")).toMatchObject({ outflow: 400 });
    expect(line(CashSection.FINANCING, "Погашение займа")).toMatchObject({ outflow: 250 });
    expect(line(CashSection.FINANCING, "Проценты")).toMatchObject({ outflow: 120 });
    expect(line(CashSection.INVESTING, "Оборудование")).toMatchObject({ outflow: 800 });
    expect(line(CashSection.OPERATING, "Аренда")).toMatchObject({ outflow: 1000 });
    expect(line(CashSection.OPERATING, "Прочий доход")).toMatchObject({ inflow: 300 });
    expect(line(CashSection.OPERATING, "Налог")).toMatchObject({ outflow: 90 });

    // Unclassified: the bare deposit (700), the bare withdrawal (60) and the expense payment (300).
    expect(section(CashSection.UNCLASSIFIED)).toMatchObject({ inflow: 700, outflow: 360 });

    expect(flow.openingBalance).toBe(1500);
    expect(flow.openingDeclaredInPeriod).toBe(0);
    expect(flow.internalTransfers.net).toBe(0);
    expect(flow.internalTransfers.amount).toBe(400);
    // Nothing disappears: sections sum to the net flow, and the statement closes on the ledgers.
    expect(flow.sections.reduce((s, x) => s + x.net, 0)).toBeCloseTo(flow.netFlow, 2);
    expect(flow.reconciliation).toMatchObject({ difference: 0, reconciles: true });
  });
});

describe("P&L follows the classification", () => {
  it("capital purchases are not expenses; financial expense and recorded tax sit below operating profit", async () => {
    // Accrue a capital expense document and a tax expense document.
    const u = org.user;
    await services.finance.createExpense(u, { amount: 4000, categoryId: cat["Оборудование"], paidImmediately: true, accountId: org.bankAccountId });
    await services.finance.createExpense(u, { amount: 70, categoryId: cat["Налог"], paidImmediately: true, accountId: org.bankAccountId });
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    // operating: rent 1000 + the unclassified 300 (kept as operating, and flagged)
    expect(pnl.expensesTotal).toBe(1300);
    expect(pnl.unclassifiedExpensesTotal).toBe(300);
    expect(pnl.capitalizedExpensesTotal).toBe(4000);
    // direct movements: other income +300, interest −120, shortages −100 and −50 (the two adjustments), tax 90 + 70
    expect(pnl.otherResult).toBe(300 - 120 - 100 - 50);
    expect(pnl.incomeTax).toBe(160);
    expect(pnl.netProfit).toBe(pnl.profitBeforeTax - 160);
    expect(pnl.netProfitStatus).toBe("PRELIMINARY");
  });

  it("break-even ignores capital and non-operating expenses", async () => {
    const be = await services.finance.getBreakEven(org.organizationId, from, to);
    // only rent (1000) and the unclassified 300 are operating; capital 4000 is not in there
    expect(be.fixedExpensesTotal + be.variableExpensesTotal + be.unclassifiedExpensesTotal).toBe(1300);
  });
});
