import { CashSection, DepreciationMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { FixedAssetsService } from "./fixed-assets.service";
import { depreciationCalculators, straightLine } from "./depreciation-calculators";
import { FinancialEventProjector } from "../finance/events/projector";
import { checkEventInvariants } from "../finance/events/invariants";
import { FinancialPeriodsService } from "../finance/periods/periods.service";
import { AccountingPolicyService } from "../finance/accounting-policy.service";
import { monthOf, monthRange } from "../common/reporting-period";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";

const prisma = new PrismaService();
const services = buildServices(prisma);
const projector = new FinancialEventProjector(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let assets: FixedAssetsService;
let periods: FinancialPeriodsService;
let capitalCategoryId: string;
let rentCategoryId: string;

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

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "assets");
  assets = new FixedAssetsService(prisma, services.cash);
  periods = new FinancialPeriodsService(prisma, services.finance, projector);
  capitalCategoryId = (
    await prisma.financeCategory.create({
      data: { organizationId: org.organizationId, name: "Оборудование", kind: "EXPENSE", pnlTreatment: "NOT_IN_PNL", cashActivity: "INVESTING", balanceTreatment: "FIXED_ASSET" },
    })
  ).id;
  rentCategoryId = (
    await prisma.financeCategory.create({
      data: { organizationId: org.organizationId, name: "Аренда", kind: "EXPENSE", pnlTreatment: "OPERATING_EXPENSE", cashActivity: "OPERATING", balanceTreatment: "NONE" },
    })
  ).id;
  const opening = await services.cash.recordMovement(prisma, {
    organizationId: org.organizationId, accountId: org.bankAccountId, type: "OPENING_BALANCE" as never, amount: 1_000_000, createdById: org.user.id,
  });
  await prisma.cashMovement.update({ where: { id: opening.id }, data: { occurredAt: new Date(Date.now() - 200 * 86400_000) } });
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

const buy = async (amount: number, categoryId = capitalCategoryId) => {
  const expense = await services.finance.createExpense(org.user, {
    amount, categoryId, paidImmediately: true, accountId: org.bankAccountId, description: "Покупка",
  });
  return expense.id;
};
const pnl = () => services.finance.getProfitAndLoss(org.organizationId, new Date(Date.now() - 400 * 86400_000), new Date(Date.now() + 3600_000));

describe("calculator registry", () => {
  it("straight-line: (cost − salvage) ÷ life, last month absorbs rounding, nothing outside the life", () => {
    const terms = { acquisitionCost: 1000, salvageValue: 0, usefulLifeMonths: 3, startYear: 2026, startMonth: 1 };
    const charges = [1, 2, 3].map((m, i) => straightLine.monthlyCharge(terms, { year: 2026, month: m, accumulated: [0, 333.33, 666.66][i] }));
    expect(charges).toEqual([333.33, 333.33, 333.34]);
    expect(straightLine.monthlyCharge(terms, { year: 2025, month: 12, accumulated: 0 })).toBe(0);
    expect(straightLine.monthlyCharge(terms, { year: 2026, month: 4, accumulated: 1000 })).toBe(0);
    // never charges past the depreciable base
    expect(straightLine.monthlyCharge({ ...terms, salvageValue: 1000 }, { year: 2026, month: 1, accumulated: 0 })).toBe(0);
  });

  it("is a registry: methods are looked up, NOT_DEPRECIATED and null have no calculator, new ones can be added", () => {
    expect(depreciationCalculators.get(DepreciationMethod.STRAIGHT_LINE)).toBe(straightLine);
    expect(depreciationCalculators.get(DepreciationMethod.NOT_DEPRECIATED)).toBeNull();
    expect(depreciationCalculators.get(null)).toBeNull();
    depreciationCalculators.register({ method: "TEST_METHOD" as never, monthlyCharge: () => 1 });
    expect(depreciationCalculators.get("TEST_METHOD" as never)).not.toBeNull();
  });
});

describe("capital purchases", () => {
  let expenseId: string;
  let assetId: string;

  it("are not P&L expenses, are investing cash flow, and wait unregistered until someone registers them", async () => {
    expenseId = await buy(120_000);
    await buy(3_000, rentCategoryId);
    const report = await pnl();
    expect(report.expensesTotal).toBe(3_000);
    expect(report.capitalizedExpensesTotal).toBe(120_000);
    const flow = await services.finance.getCashFlow(org.organizationId, new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000));
    const investing = flow.sections.find((s) => s.section === CashSection.INVESTING)!;
    expect(investing.outflow).toBe(120_000);
    const waiting = await assets.unregisteredCapitalExpenses(org.organizationId);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ expenseId, amount: 120_000, belowThreshold: false });
  });

  it("registering creates the asset at the expense's cost, once; a non-capital expense is refused", async () => {
    const asset = await assets.register(org.user, { name: "Печь", sourceExpenseId: expenseId });
    assetId = asset.id;
    expect(asset).toMatchObject({ acquisitionCost: 120_000, bookValue: 120_000, depreciationStatus: "NOT_CONFIGURED", status: "ACTIVE" });
    await expect(assets.register(org.user, { name: "Печь 2", sourceExpenseId: expenseId })).rejects.toThrow(/уже зарегистрирован/);
    const rentExpense = await prisma.expense.findFirstOrThrow({ where: { organizationId: org.organizationId, categoryId: rentCategoryId } });
    await expect(assets.register(org.user, { name: "Аренда", sourceExpenseId: rentExpense.id })).rejects.toThrow(/классифицируйте/);
    expect(await assets.unregisteredCapitalExpenses(org.organizationId)).toHaveLength(0);
  });

  it("a capitalisation threshold is informational only until approved, and never reclassifies anything", async () => {
    const small = await buy(500);
    let waiting = await assets.unregisteredCapitalExpenses(org.organizationId);
    expect(waiting.find((w) => w.expenseId === small)?.belowThreshold).toBe(false);
    await new AccountingPolicyService(prisma).update(org.user, { capitalizationThreshold: 10_000, reason: "тест" } as never);
    waiting = await assets.unregisteredCapitalExpenses(org.organizationId);
    expect(waiting.find((w) => w.expenseId === small)?.belowThreshold).toBe(true);
    // Still not an expense: the policy flags it, it does not move it into the P&L.
    expect((await pnl()).expensesTotal).toBe(3_000);
    await prisma.accountingPolicy.update({ where: { organizationId: org.organizationId }, data: { capitalizationThreshold: null, approvals: {} } });
  });

  it("does not depreciate without stated terms, and says the policy is undecided", async () => {
    const result = await assets.runDepreciation(org.user, back(1).year, back(1).month);
    expect(result).toMatchObject({ created: 0, notConfigured: 1 });
    const report = await pnl();
    expect(report.depreciation).toBe(0);
    expect(report.notConfigured).toContain("DEPRECIATION_POLICY");
  });

  it("straight-line needs every term stated: life, salvage and start month are never defaulted", async () => {
    await expect(assets.setTerms(org.user, assetId, { method: DepreciationMethod.STRAIGHT_LINE })).rejects.toThrow(/срок/);
    await expect(assets.setTerms(org.user, assetId, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 60 })).rejects.toThrow(/остаточную/);
    await expect(assets.setTerms(org.user, assetId, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 60, salvageValue: 0 })).rejects.toThrow(/месяц начала/);
    await expect(assets.setTerms(org.user, assetId, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 60, salvageValue: 999_999, startYear: 2026, startMonth: 1 })).rejects.toThrow(/остаточную/);
  });

  it("an approved policy METHOD alone is still not enough — salvage and start month must be on the asset", async () => {
    await new AccountingPolicyService(prisma).update(org.user, { depreciationMethod: "STRAIGHT_LINE", depreciationUsefulLifeMonths: 60, reason: "тест" } as never);
    const [asset] = await assets.list(org.organizationId);
    expect(asset.depreciationStatus).toBe("NOT_CONFIGURED");
    expect((await assets.runDepreciation(org.user, back(1).year, back(1).month)).created).toBe(0);
    await prisma.accountingPolicy.update({ where: { organizationId: org.organizationId }, data: { depreciationMethod: null, depreciationUsefulLifeMonths: null, approvals: {} } });
  });

  it("depreciates on stated terms: 120 000 over 3 months from three months ago = 40 000 a month, posted once", async () => {
    const start = back(3);
    await assets.setTerms(org.user, assetId, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 3, salvageValue: 0, startYear: start.year, startMonth: start.month });
    const target = back(1);
    const run = await assets.runDepreciation(org.user, target.year, target.month);
    expect(run.created).toBe(3);
    expect(run.months.map((m) => m.created)).toEqual([1, 1, 1]);
    const [asset] = await assets.list(org.organizationId);
    expect(asset).toMatchObject({ accumulatedDepreciation: 120_000, bookValue: 0, depreciationStatus: "FULLY_DEPRECIATED", monthlyDepreciation: 40_000 });
    // Running again — even simultaneously — charges nothing more.
    const again = await Promise.all([assets.runDepreciation(org.user, target.year, target.month), assets.runDepreciation(org.user, target.year, target.month)]);
    expect(again.every((r) => r.created === 0)).toBe(true);
    expect(await prisma.depreciationEntry.count({ where: { assetId } })).toBe(3);
  });

  it("depreciation is an expense line of its month, below gross profit and part of operating profit", async () => {
    const m = back(2);
    const range = monthRange(m.year, m.month);
    const report = await services.finance.getProfitAndLoss(org.organizationId, range.start, range.end);
    expect(report.depreciation).toBe(40_000);
    expect(report.operatingProfit).toBe(-40_000);
    expect(report.notConfigured).not.toContain("DEPRECIATION_POLICY");
  });

  it("terms cannot be changed to something else once depreciation has been posted", async () => {
    await expect(assets.setTerms(org.user, assetId, { method: DepreciationMethod.NOT_DEPRECIATED })).rejects.toThrow(/уже начислялась/);
    await expect(assets.setTerms(org.user, assetId, { method: null })).rejects.toThrow(/уже начислялась/);
  });
});

describe("events", () => {
  it("depreciation events balance and reduce the fixed-asset line", async () => {
    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    const dep = events.filter((e) => e.type === "DEPRECIATION");
    expect(dep).toHaveLength(3);
    expect(dep[0].balance).toEqual([{ line: "FIXED_ASSETS", delta: -40_000 }]);
    expect(dep[0].pnl).toEqual([{ line: "DEPRECIATION", amount: -40_000 }]);
  });
});

describe("closed periods", () => {
  it("depreciation cannot be added to a month whose report is frozen", async () => {
    const equipment = await buy(60_000);
    const asset = await assets.register(org.user, { name: "Миксер", sourceExpenseId: equipment });
    const start = back(2);
    await assets.setTerms(org.user, asset.id, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 12, salvageValue: 0, startYear: start.year, startMonth: start.month });
    // Close the older month first, then ask for depreciation that would land in it.
    await periods.close(org.user, start.year, start.month);
    await expect(assets.runDepreciation(org.user, back(1).year, back(1).month)).rejects.toThrow(/закрыт/);
    await periods.reopen(org.user, start.year, start.month, "Нужно начислить амортизацию");
    const ok = await assets.runDepreciation(org.user, back(1).year, back(1).month);
    expect(ok.created).toBe(2);
  });
});

describe("disposal", () => {
  let assetId: string;

  it("carries the book value out, records the gain or loss as an other result, and the proceeds as investing cash", async () => {
    const id = await buy(10_000);
    const asset = await assets.register(org.user, { name: "Весы", sourceExpenseId: id });
    assetId = asset.id;
    const start = back(2);
    await assets.setTerms(org.user, assetId, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 10, salvageValue: 0, startYear: start.year, startMonth: start.month });
    await assets.runDepreciation(org.user, back(1).year, back(1).month);
    // two months × 1 000 posted → book value 8 000
    const disposedAt = new Date();
    const cashBefore = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.bankAccountId } })).currentBalance.toNumber();
    const disposed = await assets.dispose(org.user, assetId, { disposedAt: disposedAt.toISOString(), proceeds: 5_000, accountId: org.bankAccountId });
    expect(disposed).toMatchObject({ status: "DISPOSED", disposalBookValue: 8_000, disposalProceeds: 5_000, disposalResult: -3_000, bookValue: 0 });
    expect((await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.bankAccountId } })).currentBalance.toNumber()).toBe(cashBefore + 5_000);
    const report = await services.finance.getProfitAndLoss(org.organizationId, new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000));
    expect(report.otherResult).toBe(-3_000);
    const flow = await services.finance.getCashFlow(org.organizationId, new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000));
    expect(flow.sections.find((s) => s.section === CashSection.INVESTING)!.inflow).toBe(5_000);
  });

  it("the asset leaves the books at its book value, with no amount counted twice (events balance)", async () => {
    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    const legs = events
      .filter((e) => e.sourceId === assetId || e.cash.length === 0 ? e.sourceId === assetId : false)
      .flatMap((e) => e.balance)
      .filter((b) => b.line === "FIXED_ASSETS");
    // proceeds cash event (−5 000) + disposal event (−(8 000 − 5 000)) = −8 000 = the book value
    const movement = await prisma.cashMovement.findFirstOrThrow({ where: { fixedAssetId: assetId } });
    const cashEvent = events.find((e) => e.key === `cash:${movement.id}`)!;
    const disposalEvent = events.find((e) => e.key === `fixedAsset:${assetId}:disposal`)!;
    const fixedAssetDelta = [...cashEvent.balance, ...disposalEvent.balance].filter((b) => b.line === "FIXED_ASSETS").reduce((s, b) => s + b.delta, 0);
    expect(fixedAssetDelta).toBe(-8_000);
    void legs;
  });

  it("cannot be disposed twice; simultaneous disposals record one; no further depreciation", async () => {
    await expect(assets.dispose(org.user, assetId, { disposedAt: new Date().toISOString() })).rejects.toThrow(/уже выбыло/);
    const id = await buy(2_000);
    const asset = await assets.register(org.user, { name: "Стол", sourceExpenseId: id });
    const results = await Promise.allSettled([
      assets.dispose(org.user, asset.id, { disposedAt: new Date().toISOString() }),
      assets.dispose(org.user, asset.id, { disposedAt: new Date().toISOString() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await assets.runDepreciation(org.user, back(1).year, back(1).month)).created).toBe(0);
  });

  it("proceeds need an account", async () => {
    const id = await buy(1_000);
    const asset = await assets.register(org.user, { name: "Полка", sourceExpenseId: id });
    await expect(assets.dispose(org.user, asset.id, { disposedAt: new Date().toISOString(), proceeds: 100 })).rejects.toThrow(/счёт/);
  });
});

describe("opening assets", () => {
  it("are allowed before go-live; after it only owner/admin with a reason", async () => {
    const before = await assets.register(org.user, { name: "Старая печь", opening: { acquisitionCost: 50_000, acquiredAt: new Date(Date.now() - 900 * 86400_000).toISOString() } });
    expect(before.isOpening).toBe(true);
    await services.finance.getDashboard(org.organizationId); // no-op read
    await prisma.organization.update({ where: { id: org.organizationId }, data: { financeInitializedAt: new Date() } });
    const accountant = { ...org.user, role: Role.ACCOUNTANT };
    await expect(assets.register(accountant, { name: "Ещё", opening: { acquisitionCost: 1_000, acquiredAt: new Date().toISOString() } })).rejects.toThrow(/владелец или администратор/);
    await expect(assets.register(org.user, { name: "Ещё", opening: { acquisitionCost: 1_000, acquiredAt: new Date().toISOString() } })).rejects.toThrow(/причину/);
    const ok = await assets.register(org.user, { name: "Ещё", opening: { acquisitionCost: 1_000, acquiredAt: new Date().toISOString(), reason: "Забыли внести" } });
    expect(ok.isOpening).toBe(true);
  });

  it("every fixed-asset audit action has been written", async () => {
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.fixedAssets.filter((a) => !logged.has(a))).toEqual([]);
  });
});
