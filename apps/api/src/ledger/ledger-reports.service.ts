import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AccountingEventStatus,
  CASH_SECTION_LABELS_RU,
  CashSection,
  GlBalanceLineDto,
  GlBalanceSheetDto,
  GlCashFlowDto,
  GlCashFlowSectionDto,
  GlPnlDto,
  GlPnlLineDto,
  LedgerAccountType,
  NormalBalance,
  PnlReconciliationDto,
  SystemAccountKey,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../costing/costing.service";
import { FinancialEventProjector } from "../finance/events/projector";
import { FinanceService } from "../finance/finance.service";
import { monthOf, monthRange } from "../common/reporting-period";
import { Dec, num, sum, ZERO } from "./journal-math";

// The statements, read from the general ledger and from nothing else. Each
// figure is a sum of posted journal lines; no operational table is consulted,
// so a statement can only ever say what the books say.

const dec = (v: Prisma.Decimal | null | undefined): Dec => v ?? ZERO;

interface AccountSums {
  id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  normalBalance: NormalBalance;
  key: SystemAccountKey | null;
  debit: Dec;
  credit: Dec;
}

@Injectable()
export class LedgerReportsService {
  constructor(
    private prisma: PrismaService,
    private finance?: FinanceService,
  ) {}

  private async sums(
    organizationId: string,
    range: { gte?: Date; lte?: Date; lt?: Date },
    extra: Prisma.JournalLineWhereInput = {},
  ): Promise<AccountSums[]> {
    const [accounts, grouped] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { organizationId } }),
      this.prisma.journalLine.groupBy({
        by: ["accountId"],
        where: { organizationId, journalEntry: { entryDate: range }, ...extra },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const byId = new Map(grouped.map((g) => [g.accountId, g._sum]));
    return accounts.flatMap((a) => {
      const s = byId.get(a.id);
      if (!s) return [];
      return [
        {
          id: a.id,
          code: a.code,
          name: a.name,
          type: a.type as LedgerAccountType,
          normalBalance: a.normalBalance as NormalBalance,
          key: (a.systemAccountKey as SystemAccountKey | null) ?? null,
          debit: dec(s.debit),
          credit: dec(s.credit),
        },
      ];
    });
  }

  // ── profit and loss ──────────────────────────────────────────────────────

  async getPnl(organizationId: string, from: Date, to: Date, locationId?: string): Promise<GlPnlDto> {
    const rows = await this.sums(organizationId, { gte: from, lte: to }, locationId ? { locationId } : {});
    let grossRevenue = ZERO;
    let discounts = ZERO;
    let returns = ZERO;
    let cogs = ZERO;
    let inventoryLosses = ZERO;
    let operatingExpenses = ZERO;
    let depreciation = ZERO;
    let otherResult = ZERO;
    let incomeTax = ZERO;
    const lines: GlPnlLineDto[] = [];

    for (const r of rows) {
      const credit = r.credit.minus(r.debit); // effect on profit: income +, expense −
      const debit = r.debit.minus(r.credit);
      switch (r.type) {
        case LedgerAccountType.REVENUE:
          if (r.key === SystemAccountKey.SALES_DISCOUNTS) discounts = discounts.plus(debit);
          else if (r.key === SystemAccountKey.SALES_RETURNS) returns = returns.plus(debit);
          else if (r.normalBalance === NormalBalance.CREDIT) grossRevenue = grossRevenue.plus(credit);
          else discounts = discounts.plus(debit); // a debit-normal revenue account is a deduction
          break;
        case LedgerAccountType.COGS:
          cogs = cogs.plus(debit);
          break;
        case LedgerAccountType.OPERATING_EXPENSE:
          if (r.key === SystemAccountKey.INVENTORY_LOSSES) inventoryLosses = inventoryLosses.plus(debit);
          else if (r.key === SystemAccountKey.DEPRECIATION_EXPENSE) depreciation = depreciation.plus(debit);
          else operatingExpenses = operatingExpenses.plus(debit);
          break;
        case LedgerAccountType.BELOW_OPERATING:
          otherResult = otherResult.plus(credit);
          break;
        case LedgerAccountType.TAX:
          incomeTax = incomeTax.plus(debit);
          break;
        default:
          continue; // balance-sheet accounts are not part of the result
      }
      lines.push({ accountId: r.id, code: r.code, name: r.name, type: r.type, amount: num(credit) });
    }
    const netRevenue = grossRevenue.minus(discounts).minus(returns);
    const grossProfit = netRevenue.minus(cogs);
    const operatingProfit = grossProfit.minus(inventoryLosses).minus(operatingExpenses).minus(depreciation);
    const profitBeforeTax = operatingProfit.plus(otherResult);
    const netProfit = profitBeforeTax.minus(incomeTax);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      grossRevenue: num(grossRevenue),
      discounts: num(discounts),
      returns: num(returns),
      netRevenue: num(netRevenue),
      cogs: num(cogs),
      grossProfit: num(grossProfit),
      inventoryLosses: num(inventoryLosses),
      operatingExpenses: num(operatingExpenses),
      depreciation: num(depreciation),
      operatingProfit: num(operatingProfit),
      otherResult: num(otherResult),
      profitBeforeTax: num(profitBeforeTax),
      incomeTax: num(incomeTax),
      netProfit: num(netProfit),
      lines: lines.sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  // ── balance sheet ────────────────────────────────────────────────────────

  async getBalanceSheet(organizationId: string, asOf: Date = new Date()): Promise<GlBalanceSheetDto> {
    const rows = await this.sums(organizationId, { lte: asOf });
    const group = (r: AccountSums): string => {
      switch (r.key) {
        case SystemAccountKey.CASH_ON_HAND:
        case SystemAccountKey.BANK:
          return "Денежные средства";
        case SystemAccountKey.RECEIVABLES:
          return "Дебиторская задолженность";
        case SystemAccountKey.INVENTORY:
          return "Запасы";
        case SystemAccountKey.FIXED_ASSETS:
          return "Основные средства";
        case SystemAccountKey.SUPPLIER_PAYABLES:
        case SystemAccountKey.EXPENSE_PAYABLES:
        case SystemAccountKey.CONSIGNMENT_PAYABLES:
          return "Кредиторская задолженность";
        case SystemAccountKey.LOANS:
          return "Займы и кредиты";
        case SystemAccountKey.OPENING_EQUITY:
          return "Начальный капитал";
        case SystemAccountKey.OWNER_CONTRIBUTIONS:
        case SystemAccountKey.OWNER_WITHDRAWALS:
          return "Капитал собственника";
        default:
          return r.type === LedgerAccountType.ASSET ? "Прочие активы" : r.type === LedgerAccountType.LIABILITY ? "Прочие обязательства" : "Прочий капитал";
      }
    };
    const toLine = (r: AccountSums, amount: Dec): GlBalanceLineDto => ({
      accountId: r.id,
      code: r.code,
      name: r.name,
      group: group(r),
      amount: num(amount),
    });
    const assets = rows.filter((r) => r.type === LedgerAccountType.ASSET).map((r) => ({ r, amount: r.debit.minus(r.credit) }));
    const liabilities = rows.filter((r) => r.type === LedgerAccountType.LIABILITY).map((r) => ({ r, amount: r.credit.minus(r.debit) }));
    const equity = rows.filter((r) => r.type === LedgerAccountType.EQUITY).map((r) => ({ r, amount: r.credit.minus(r.debit) }));
    const result = sum(
      rows
        .filter((r) => r.type !== LedgerAccountType.ASSET && r.type !== LedgerAccountType.LIABILITY && r.type !== LedgerAccountType.EQUITY)
        .map((r) => r.credit.minus(r.debit)),
    );

    // The result of the accounting period (month) that contains `asOf`; every
    // earlier period is what has been retained. There are no closing entries:
    // results stay on their accounts, and this is only how they are presented.
    const { year, month } = monthOf(asOf);
    const periodStart = monthRange(year, month).start;
    const earlier = await this.sums(organizationId, { lt: periodStart });
    const retained = sum(
      earlier
        .filter((r) => r.type !== LedgerAccountType.ASSET && r.type !== LedgerAccountType.LIABILITY && r.type !== LedgerAccountType.EQUITY)
        .map((r) => r.credit.minus(r.debit)),
    );

    const assetsTotal = sum(assets.map((a) => a.amount));
    const liabilitiesTotal = sum(liabilities.map((a) => a.amount));
    const equityTotal = sum(equity.map((a) => a.amount)).plus(result);
    const difference = assetsTotal.minus(liabilitiesTotal).minus(equityTotal);
    return {
      asOf: asOf.toISOString(),
      assets: { lines: assets.map(({ r, amount }) => toLine(r, amount)).sort((a, b) => a.code.localeCompare(b.code)), total: num(assetsTotal) },
      liabilities: { lines: liabilities.map(({ r, amount }) => toLine(r, amount)).sort((a, b) => a.code.localeCompare(b.code)), total: num(liabilitiesTotal) },
      equity: {
        lines: equity.map(({ r, amount }) => toLine(r, amount)).sort((a, b) => a.code.localeCompare(b.code)),
        accumulatedResult: num(result),
        retainedResult: num(retained),
        currentPeriodResult: num(result.minus(retained)),
        total: num(equityTotal),
      },
      // Never an account: when the books are consistent this is exactly zero.
      difference: num(difference),
      balanced: difference.isZero(),
    };
  }

  // ── cash flow (ДДС) ──────────────────────────────────────────────────────

  async getCashFlow(organizationId: string, from: Date, to: Date): Promise<GlCashFlowDto> {
    const cashAccounts = await this.prisma.ledgerAccount.findMany({
      where: { organizationId, systemAccountKey: { in: [SystemAccountKey.CASH_ON_HAND, SystemAccountKey.BANK] } },
      select: { id: true },
    });
    const ids = cashAccounts.map((a) => a.id);
    const base = { organizationId, accountId: { in: ids } };

    const [before, within] = await Promise.all([
      this.prisma.journalLine.aggregate({ where: { ...base, journalEntry: { entryDate: { lt: from } } }, _sum: { debit: true, credit: true } }),
      this.prisma.journalLine.findMany({
        where: { ...base, journalEntry: { entryDate: { gte: from, lte: to } } },
        select: { debit: true, credit: true, cashSection: true, journalEntry: { select: { kind: true } } },
      }),
    ]);
    let opening = dec(before._sum.debit).minus(dec(before._sum.credit));
    const bySection = new Map<string, { inflow: Dec; outflow: Dec }>();
    for (const l of within) {
      // An opening position is a starting point, never an inflow.
      if (l.journalEntry.kind === "OPENING_BALANCE") {
        opening = opening.plus(l.debit).minus(l.credit);
        continue;
      }
      const section = l.cashSection ?? CashSection.UNCLASSIFIED;
      const s = bySection.get(section) ?? { inflow: ZERO, outflow: ZERO };
      s.inflow = s.inflow.plus(l.debit);
      s.outflow = s.outflow.plus(l.credit);
      bySection.set(section, s);
    }
    const order = [CashSection.OPERATING, CashSection.INVESTING, CashSection.FINANCING, CashSection.UNCLASSIFIED];
    const sections: GlCashFlowSectionDto[] = order
      .filter((s) => bySection.has(s))
      .map((s) => {
        const v = bySection.get(s)!;
        return { section: s, label: CASH_SECTION_LABELS_RU[s], inflow: num(v.inflow), outflow: num(v.outflow), net: num(v.inflow.minus(v.outflow)) };
      });
    // Section OPENING lines carried by ordinary entries (none are produced today).
    const internal = bySection.get(CashSection.INTERNAL) ?? { inflow: ZERO, outflow: ZERO };
    const extra = bySection.get(CashSection.OPENING);
    if (extra) opening = opening.plus(extra.inflow).minus(extra.outflow);

    const totalInflow = sum(sections.map((s) => new Prisma.Decimal(s.inflow)));
    const totalOutflow = sum(sections.map((s) => new Prisma.Decimal(s.outflow)));
    const closing = opening.plus(totalInflow).minus(totalOutflow).plus(internal.inflow).minus(internal.outflow);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      openingBalance: num(opening),
      sections,
      internalTransfers: { inflow: num(internal.inflow), outflow: num(internal.outflow), net: num(internal.inflow.minus(internal.outflow)) },
      totalInflow: num(totalInflow),
      totalOutflow: num(totalOutflow),
      closingBalance: num(closing),
    };
  }

  // ── the ledger against the existing report ───────────────────────────────

  // During the migration the existing P&L stays what the owner sees. This sets
  // the two side by side: a difference is a finding (an event not in the ledger,
  // or a rule the two read differently), never something to smooth over.
  async reconcilePnl(organizationId: string, from: Date, to: Date): Promise<PnlReconciliationDto> {
    if (!this.finance) throw new Error("FinanceService is required to reconcile with the existing P&L");
    const [gl, legacy, org] = await Promise.all([
      this.getPnl(organizationId, from, to),
      this.finance.getProfitAndLoss(organizationId, from, to),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ledgerStartsAt: true } }),
    ]);
    const pairs: [string, number, number][] = [
      ["Валовая выручка", gl.grossRevenue, legacy.grossRevenue],
      ["Скидки", gl.discounts, legacy.discountsTotal],
      ["Возвраты", gl.returns, legacy.returnsTotal],
      ["Чистая выручка", gl.netRevenue, legacy.netRevenue],
      ["Себестоимость", gl.cogs, legacy.cogs],
      ["Валовая прибыль", gl.grossProfit, legacy.grossProfit],
      ["Потери запасов", gl.inventoryLosses, legacy.inventoryLosses],
      ["Операционные расходы", gl.operatingExpenses, legacy.expensesTotal],
      ["Амортизация", gl.depreciation, legacy.depreciation],
      ["Операционная прибыль", gl.operatingProfit, legacy.operatingProfit],
      ["Прочий результат", gl.otherResult, legacy.otherResult],
    ];
    const rows = pairs.map(([metric, ledger, existing]) => ({
      metric,
      ledger,
      existing,
      difference: Math.round((ledger - existing) * 100) / 100,
    }));

    // Events of this span the ledger does not hold.
    let unposted = 0;
    if (org.ledgerStartsAt) {
      const events = await new FinancialEventProjector(this.prisma, new CostingService(this.prisma)).project(organizationId, { upTo: to });
      const inSpan = events.filter((e) => new Date(e.occurredAt) >= from && new Date(e.occurredAt) >= org.ledgerStartsAt!);
      const posted = new Set(
        (
          await this.prisma.accountingEvent.findMany({
            where: { organizationId, status: { in: [AccountingEventStatus.POSTED, AccountingEventStatus.REVERSED, AccountingEventStatus.NO_GL_EFFECT] } },
            select: { eventKey: true },
          })
        ).map((e) => e.eventKey),
      );
      unposted = inSpan.filter((e) => !posted.has(e.key)).length;
    }
    return { from: from.toISOString(), to: to.toISOString(), rows, unpostedEvents: unposted, matches: rows.every((r) => Math.abs(r.difference) <= 0.01) };
  }
}
