import {
  CASH_FLOW_OPERATIONS_MAX,
  CashFlowMonthCellDto,
  CashFlowMonthDto,
  CashFlowMonthlyDto,
  CashFlowMonthlyLineDto,
  CashFlowMonthlySectionDto,
  CashFlowOperationsDto,
  CashSection,
  FinancialEvent,
} from "@bakery-os/shared";
import { round2 } from "../../common/money";
import { buildCashFlowFromEvents, lineLabel } from "./cash-flow-statement";

export interface MonthRange {
  key: string; // "YYYY-MM"
  from: Date;
  to: Date;
}

const emptyCell = (): CashFlowMonthCellDto => ({ inflow: 0, outflow: 0, count: 0 });

// ДДС with a column per month. Each month is the ordinary statement over that
// month (so the figures are the period report's figures, not a second way of
// counting), and the lines are joined by their label across months. A month's
// closing is the next month's opening because both come from "everything before".
export function buildCashFlowMonthly(events: FinancialEvent[], ranges: MonthRange[]): CashFlowMonthlyDto {
  const statements = ranges.map((r) => buildCashFlowFromEvents(events, r.from, r.to));

  const months: CashFlowMonthDto[] = statements.map((st, i) => ({
    key: ranges[i].key,
    from: ranges[i].from.toISOString(),
    to: ranges[i].to.toISOString(),
    openingBalance: st.openingBalance,
    openingDeclared: st.openingDeclaredInPeriod,
    closingBalance: st.closingBalance,
    totalInflow: st.totalInflow,
    totalOutflow: st.totalOutflow,
    netFlow: round2(st.totalInflow - st.totalOutflow),
    internalNet: st.internalTransfers.net,
  }));

  const sectionOrder: CashSection[] = [CashSection.OPERATING, CashSection.INVESTING, CashSection.FINANCING, CashSection.UNCLASSIFIED];
  const sections: CashFlowMonthlySectionDto[] = sectionOrder.map((section) => {
    const lines = new Map<string, CashFlowMonthlyLineDto>();
    statements.forEach((st, m) => {
      const found = st.sections.find((s) => s.section === section);
      for (const l of found?.lines ?? []) {
        let line = lines.get(l.label);
        if (!line) {
          line = { label: l.label, months: ranges.map(emptyCell), total: emptyCell() };
          lines.set(l.label, line);
        }
        line.months[m] = { inflow: l.inflow, outflow: l.outflow, count: l.count };
        line.total.inflow += l.inflow;
        line.total.outflow += l.outflow;
        line.total.count += l.count;
      }
    });
    const sorted = [...lines.values()]
      .map((l) => ({ ...l, total: { inflow: round2(l.total.inflow), outflow: round2(l.total.outflow), count: l.total.count } }))
      .sort((a, b) => b.total.inflow + b.total.outflow - (a.total.inflow + a.total.outflow));
    const monthTotals = statements.map((st) => {
      const s = st.sections.find((x) => x.section === section);
      return { inflow: s?.inflow ?? 0, outflow: s?.outflow ?? 0, net: s?.net ?? 0 };
    });
    const inflow = round2(monthTotals.reduce((sum, t) => sum + t.inflow, 0));
    const outflow = round2(monthTotals.reduce((sum, t) => sum + t.outflow, 0));
    return { section, months: monthTotals, total: { inflow, outflow, net: round2(inflow - outflow) }, lines: sorted };
  });

  return {
    months,
    sections,
    openingBalance: months[0]?.openingBalance ?? 0,
    closingBalance: months[months.length - 1]?.closingBalance ?? 0,
  };
}

// The movements behind one cell (or one row's total): the cash legs of one
// section whose article is `label`, dated within [from, to], newest first.
export function cashFlowOperations(
  events: FinancialEvent[],
  section: CashSection,
  label: string,
  from: Date,
  to: Date,
): CashFlowOperationsDto {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const found: CashFlowOperationsDto["operations"] = [];
  for (const e of events) {
    if (e.occurredAt < fromIso || e.occurredAt > toIso) continue;
    if (lineLabel(e) !== label) continue;
    for (const leg of e.cash) {
      if (leg.section !== section || leg.amount === 0) continue;
      found.push({ occurredAt: e.occurredAt, description: e.description, sourceType: e.sourceType, sourceId: e.sourceId, amount: round2(leg.amount) });
    }
  }
  found.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
  const total = round2(found.reduce((sum, o) => sum + o.amount, 0));
  return { operations: found.slice(0, CASH_FLOW_OPERATIONS_MAX), truncated: found.length > CASH_FLOW_OPERATIONS_MAX, total };
}
