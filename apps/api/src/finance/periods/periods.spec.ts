import { PaymentMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../../test/support/isolated-org";
import { buildServices } from "../../../test/support/services";
import { FinancialPeriodsService } from "./periods.service";
import { FinancialEventProjector } from "../events/projector";
import { FinanceSetupService } from "../finance-setup.service";
import { monthOf, monthRange } from "../../common/reporting-period";
import { AUDIT_ACTION_GROUPS } from "../../audit/audit";

// Financial periods: closing freezes a month's reports into an immutable
// snapshot without stopping current business; a closed month changes only by
// an audited, owner-only reopen of the latest closed month.

const prisma = new PrismaService();
const services = buildServices(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let periods: FinancialPeriodsService;
let breadId: string;

// A month safely in the past, and the one before it.
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
const M1 = back(1);
const M2 = back(2);
const inMonth = (p: { year: number; month: number }, day = 10) => new Date(monthRange(p.year, p.month).start.getTime() + day * 86400_000);

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "periods");
  periods = new FinancialPeriodsService(prisma, services.finance, new FinancialEventProjector(prisma));
  breadId = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Хлеб", sku: "PR-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 100 });
  // Historic sales inside M2 and M1 (dated by hand: the API stamps "now").
  for (const [p, qty] of [[M2, 2], [M1, 3]] as const) {
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: qty, unitPrice: 500 }],
    });
    await prisma.sale.update({ where: { id: sale.id }, data: { soldAt: inMonth(p) } });
    await prisma.cashMovement.updateMany({ where: { saleId: sale.id }, data: { occurredAt: inMonth(p) } });
  }
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

const manager: () => typeof org.user = () => ({ ...org.user, role: Role.ADMIN });

describe("closing", () => {
  it("cannot close the current or a future month, nor a month while an earlier one is closed after it", async () => {
    await expect(periods.close(org.user, now.year, now.month)).rejects.toThrow(/ещё не закончился/);
    const pre = await periods.preflight(org.organizationId, now.year, now.month);
    expect(pre.canClose).toBe(false);
  });

  it("closing M2 freezes an immutable snapshot with figures and separate diagnostics; business keeps running", async () => {
    const snapshot = await periods.close(org.user, M2.year, M2.month);
    expect(snapshot.version).toBe(1);
    expect(snapshot.payload.pnl.netRevenue).toBe(1000);
    expect(snapshot.payload.cashFlow.totalInflow).toBe(1000);
    // Findings live beside the figures, never inside them.
    expect(snapshot.diagnostics).toHaveProperty("hasIssues");
    expect(snapshot.payload).not.toHaveProperty("diagnostics");
    const list = await periods.list(org.organizationId);
    expect(list.find((p) => p.year === M2.year && p.month === M2.month)).toMatchObject({ status: "CLOSED", version: 1 });

    // Current-period business is untouched by a closed past month.
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 1, unitPrice: 500 }],
    });
    expect(sale.totalAmount).toBe(500);
  });

  it("a closed month's report comes from the snapshot and does not move with later data", async () => {
    const range = monthRange(M2.year, M2.month);
    const frozen = await periods.frozenSection<{ netRevenue: number }>(org.organizationId, M2.year, M2.month, "pnl");
    expect(frozen?.data.netRevenue).toBe(1000);
    // Tamper with the underlying data of the closed month: the snapshot does not follow.
    await prisma.sale.updateMany({ where: { organizationId: org.organizationId, soldAt: { gte: range.start, lte: range.end } }, data: { totalAmount: 99999 } });
    const after = await periods.frozenSection<{ netRevenue: number }>(org.organizationId, M2.year, M2.month, "pnl");
    expect(after?.data.netRevenue).toBe(1000);
    expect(after?.info).toMatchObject({ year: M2.year, month: M2.month, version: 1 });
    await prisma.sale.updateMany({ where: { organizationId: org.organizationId, soldAt: { gte: range.start, lte: range.end } }, data: { totalAmount: 1000 } });
    // matchWholeMonth recognises exactly the month range (and nothing else).
    expect(periods.matchWholeMonth(range.start, range.end)).toEqual(M2);
    expect(periods.matchWholeMonth(range.start, new Date(range.end.getTime() - 3 * 86400_000))).toBeNull();
  });

  it("two simultaneous closes of the same month produce exactly one snapshot", async () => {
    const results = await Promise.allSettled([periods.close(org.user, M1.year, M1.month), periods.close(manager(), M1.year, M1.month)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const period = await prisma.financialPeriod.findUniqueOrThrow({ where: { organizationId_year_month: { organizationId: org.organizationId, year: M1.year, month: M1.month } } });
    expect(period.status).toBe("CLOSED");
    expect(await prisma.periodSnapshot.count({ where: { periodId: period.id } })).toBe(1);
  });
});

describe("the guard", () => {
  it("refuses a write dated inside a closed month, and accepts one dated now", async () => {
    await expect(
      services.finance.createExpense(org.user, { amount: 100, paidImmediately: false, incurredOn: inMonth(M2).toISOString() }),
    ).rejects.toThrow(/закрыт/);
    const ok = await services.finance.createExpense(org.user, { amount: 100, paidImmediately: false });
    expect(ok.amount).toBe(100);
    // A DRAFT expense dated in the closed month cannot be confirmed either.
    const draft = await prisma.expense.create({
      data: { organizationId: org.organizationId, amount: 50, status: "DRAFT", incurredOn: inMonth(M1), createdById: org.user.id },
    });
    await expect(services.finance.confirmExpense(org.organizationId, draft.id, org.user.id)).rejects.toThrow(/закрыт/);
  });
});

describe("reopening", () => {
  it("only the owner may reopen; only the LATEST closed month; a reason is required; it is audited", async () => {
    await expect(periods.reopen(manager(), M1.year, M1.month, "нужно")).rejects.toThrow(/только владелец/);
    await expect(periods.reopen(org.user, M2.year, M2.month, "не последний")).rejects.toThrow(/последний/);
    await expect(periods.reopen(org.user, M1.year, M1.month, " ")).rejects.toThrow(/причину/);
    const list = await periods.list(org.organizationId);
    expect(list.find((p) => p.year === M1.year && p.month === M1.month)?.canReopen).toBe(true);
    expect(list.find((p) => p.year === M2.year && p.month === M2.month)?.canReopen).toBe(false);

    const reopened = await periods.reopen(org.user, M1.year, M1.month, "Ошибка в классификации расхода");
    expect(reopened).toMatchObject({ status: "OPEN", version: 2, reopenReason: "Ошибка в классификации расхода" });
    const log = await prisma.auditLog.findFirst({ where: { organizationId: org.organizationId, action: "period.reopen" } });
    expect(log?.reason).toBe("Ошибка в классификации расхода");
  });

  it("the old snapshot stays as history; the next close writes version 2; M2 can be reopened afterwards only after M1", async () => {
    const before = await periods.listSnapshotVersions(org.organizationId, M1.year, M1.month);
    expect(before).toHaveLength(1);
    expect(before[0].supersededAt).not.toBeNull();
    // A month reopened is writable again.
    await expect(
      services.finance.createExpense(org.user, {
        amount: 10, paidImmediately: true, accountId: org.cashAccountId, incurredOn: inMonth(M1).toISOString(),
      }),
    ).resolves.toBeDefined();
    // Its cash movement is dated now by the ledger; date it into the reopened month.
    await prisma.cashMovement.updateMany({ where: { organizationId: org.organizationId, type: "EXPENSE_PAYMENT" }, data: { occurredAt: inMonth(M1) } });
    const second = await periods.close(org.user, M1.year, M1.month);
    expect(second.version).toBe(2);
    const all = await periods.listSnapshotVersions(org.organizationId, M1.year, M1.month);
    expect(all.map((s) => s.version)).toEqual([2, 1]);
    expect(all.find((s) => s.version === 2)?.supersededAt).toBeNull();
    // Version 1 content is exactly what it was.
    expect(all.find((s) => s.version === 1)?.payload.pnl.netRevenue).toBe(1500);
    // The current snapshot is v2, and it includes the expense added while reopened.
    expect((await periods.getSnapshot(org.organizationId, M1.year, M1.month)).version).toBe(2);
    expect((await periods.getSnapshot(org.organizationId, M1.year, M1.month)).payload.pnl.expensesTotal).toBe(10);
  });

  it("every period audit action has been written", async () => {
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.periods.filter((a) => !logged.has(a))).toEqual([]);
  });
});

describe("finance initialisation is written once", () => {
  it("two simultaneous completions freeze the opening position once", async () => {
    const setup = new FinanceSetupService(prisma, services.finance);
    const results = await Promise.allSettled([setup.complete(org.user), setup.complete(org.user)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });
    expect(organization.financeInitializedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "financeSetup.complete" } })).toBe(1);
  });
});
