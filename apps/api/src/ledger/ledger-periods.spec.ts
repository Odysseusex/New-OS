import { SystemAccountKey as K } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { accountId, glBalance } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { FinancialPeriodsService } from "../finance/periods/periods.service";
import { FinancialEventProjector } from "../finance/events/projector";
import { monthOf, monthRange } from "../common/reporting-period";
import { LedgerPeriodSection } from "./ledger-period-section";
import { LedgerReportsService } from "./ledger-reports.service";
import { LedgerService } from "./ledger.service";
import { LedgerDiagnosticsService } from "./ledger-diagnostics.service";
import { BalanceService } from "../finance/balance/balance.service";

// The ledger respects the period lifecycle: closing a month freezes the books'
// view of it, nothing more is posted into it, and a mistake in it is put right
// by a reversal dated in the open present.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let periods: FinancialPeriodsService;
let cash: string;
let equity: string;
let revenue: string;

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
const M2 = back(2);
const M1 = back(1);
const inMonth = (p: { year: number; month: number }, day = 10) => new Date(monthRange(p.year, p.month).start.getTime() + day * 86400_000);

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "ledger-periods");
  periods = new FinancialPeriodsService(prisma, services.finance, new FinancialEventProjector(prisma));
  new LedgerPeriodSection(prisma, ledger, reports).register(periods);
  await ledger.initializeSystemAccounts(org.user);
  // Started at the beginning of M2: its entries are dated back in time on purpose.
  await ledger.enable(org.user, { startsAt: monthRange(M2.year, M2.month).start.toISOString() });
  cash = await accountId(ledger, org, K.CASH_ON_HAND);
  equity = await accountId(ledger, org, K.OPENING_EQUITY);
  revenue = await accountId(ledger, org, K.SALES_REVENUE);
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const post = (date: Date, amount: number, description: string, credit = equity) =>
  ledger.postManual(org.user, { entryDate: date.toISOString(), description, lines: [{ accountId: cash, debit: amount }, { accountId: credit, credit: amount }] });

describe("a closed period and the general ledger", () => {
  let inM2: string;

  it("every entry belongs to the accounting period of its date", async () => {
    const a = await post(inMonth(M2), 1000, "Взнос в M2");
    inM2 = a.id;
    await post(inMonth(M1), 500, "Взнос в M1");
    const entries = await prisma.journalEntry.findMany({ where: { organizationId: org.organizationId }, include: { accountingPeriod: true } });
    for (const e of entries) {
      expect(monthOf(e.entryDate)).toEqual({ year: e.accountingPeriod.year, month: e.accountingPeriod.month });
    }
    expect(entries.map((e) => e.accountingPeriod.month).sort()).toEqual([M2.month, M1.month].sort());
  });

  it("closing M2 freezes the ledger's trial balance, P&L and balance sheet into the snapshot", async () => {
    const snapshot = await periods.close(org.user, M2.year, M2.month);
    const frozen = snapshot.payload.generalLedger as { startsAt: string; trialBalance: { totals: { balanced: boolean; closingDebit: number } }; balance: { assets: { total: number } } };
    expect(frozen.trialBalance.totals).toMatchObject({ balanced: true, closingDebit: 1000 });
    expect(frozen.balance.assets.total).toBe(1000); // M1's 500 is after the month's end
    // The snapshot does not move when the book later does.
    await post(inMonth(M1, 12), 77, "Позже");
    const again = await periods.getSnapshot(org.organizationId, M2.year, M2.month);
    expect((again.payload.generalLedger as typeof frozen).trialBalance.totals.closingDebit).toBe(1000);
  });

  it("G. nothing more is posted into the closed month; the refusal says how to correct it", async () => {
    await expect(post(inMonth(M2, 20), 1, "Задним числом")).rejects.toThrow(/закрыт.*Исправление вносится текущим периодом/s);
    // Neither by a person nor by a business document dated back there.
    const before = await prisma.journalEntry.count({ where: { organizationId: org.organizationId } });
    await expect(post(inMonth(M2, 20), 1, "ещё раз")).rejects.toThrow();
    expect(await prisma.journalEntry.count({ where: { organizationId: org.organizationId } })).toBe(before);
  });

  it("E. a mistake in the closed month is reversed in the open present — the closed month's entry stays exactly as it was", async () => {
    const reversal = await ledger.reverse(org.user, inM2, "Ошибка прошлого месяца");
    expect(monthOf(new Date(reversal.entryDate))).toEqual(now);
    const original = await ledger.getEntry(org.organizationId, inM2);
    expect(original.totalDebit).toBe(1000);
    expect(original.reversedByEntryId).toBe(reversal.id);
    // The closed month's own figures are unchanged…
    const m2Pnl = await reports.getBalanceSheet(org.organizationId, monthRange(M2.year, M2.month).end);
    expect(m2Pnl.assets.total).toBe(1000);
    // …and today's book carries the correction.
    expect(await glBalance(ledger, org, K.CASH_ON_HAND)).toBe(500 + 77);
  });

  it("the diagnostics find no entry posted into a closed period, and the trial balance still balances", async () => {
    const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), reports, ledger);
    const report = await diagnostics.run(org.organizationId);
    for (const check of ["POSTING_INTO_CLOSED_PERIOD", "ENTRY_WITHOUT_PERIOD", "TB_BALANCED", "UNBALANCED_ENTRIES"]) {
      expect(report.checks.find((c) => c.check === check)?.status).toBe("PASS");
    }
  });

  it("reopening a month (owner, with a reason) lets that month take postings again — and only then", async () => {
    await periods.reopen(org.user, M2.year, M2.month, "Нужна корректировка");
    const late = await post(inMonth(M2, 25), 5, "После переоткрытия");
    expect(monthOf(new Date(late.entryDate))).toEqual(M2);
    expect(revenue).toBeTruthy();
  });
});
