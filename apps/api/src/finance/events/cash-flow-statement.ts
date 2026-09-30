import { CashFlowSectionDto, CashSection, FinancialEvent } from "@bakery-os/shared";
import { round2 } from "../../common/money";

const ACTIVITY_ORDER: CashSection[] = [
  CashSection.OPERATING,
  CashSection.INVESTING,
  CashSection.FINANCING,
  CashSection.UNCLASSIFIED,
];

export interface CashFlowFromEvents {
  openingBalance: number;
  // Opening balances DATED inside the period: part of the starting position,
  // never an inflow.
  openingDeclaredInPeriod: number;
  closingBalance: number;
  sections: CashFlowSectionDto[];
  internalTransfers: { amount: number; net: number; count: number };
  totalInflow: number;
  totalOutflow: number;
}

// Statement of cash flows over [from, to], built from events only.
//   opening = everything before `from` + opening balances dated inside the period
//   inflow / outflow = OPERATING + INVESTING + FINANCING + UNCLASSIFIED legs
//   internal transfers are listed apart and cannot inflate either side
//   closing = opening + inflow − outflow, by construction; the caller checks it
//   against the account ledgers.
export function buildCashFlowFromEvents(events: FinancialEvent[], from: Date, to: Date): CashFlowFromEvents {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  let opening = 0;
  let openingInPeriod = 0;
  let transferGross = 0;
  let transferNet = 0;
  let transferCount = 0;

  const sections = new Map<CashSection, Map<string, { label: string; inflow: number; outflow: number; count: number }>>();
  for (const s of ACTIVITY_ORDER) sections.set(s, new Map());

  for (const e of events) {
    const before = e.occurredAt < fromIso;
    const inPeriod = !before && e.occurredAt <= toIso;
    if (!before && !inPeriod) continue;
    for (const leg of e.cash) {
      if (before) {
        opening += leg.amount;
        continue;
      }
      if (leg.section === CashSection.OPENING) {
        opening += leg.amount;
        openingInPeriod += leg.amount;
        continue;
      }
      if (leg.section === CashSection.INTERNAL) {
        transferNet += leg.amount;
        if (leg.amount > 0) transferGross += leg.amount;
        continue;
      }
      if (leg.amount === 0) continue;
      const lines = sections.get(leg.section)!;
      const label = lineLabel(e);
      const entry = lines.get(label) ?? { label, inflow: 0, outflow: 0, count: 0 };
      if (leg.amount > 0) entry.inflow += leg.amount;
      else entry.outflow += -leg.amount;
      entry.count += 1;
      lines.set(label, entry);
    }
    if (inPeriod && e.cash.some((c) => c.section === CashSection.INTERNAL)) transferCount += 1;
  }

  let totalInflow = 0;
  let totalOutflow = 0;
  const out: CashFlowSectionDto[] = ACTIVITY_ORDER.map((section) => {
    const lines = [...sections.get(section)!.values()]
      .map((l) => ({ label: l.label, inflow: round2(l.inflow), outflow: round2(l.outflow), count: l.count }))
      .sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));
    const inflow = round2(lines.reduce((s, l) => s + l.inflow, 0));
    const outflow = round2(lines.reduce((s, l) => s + l.outflow, 0));
    totalInflow += inflow;
    totalOutflow += outflow;
    return { section, inflow, outflow, net: round2(inflow - outflow), lines };
  });

  const openingBalance = round2(opening);
  return {
    openingBalance,
    openingDeclaredInPeriod: round2(openingInPeriod),
    closingBalance: round2(openingBalance + totalInflow - totalOutflow + transferNet),
    sections: out,
    internalTransfers: { amount: round2(transferGross), net: round2(transferNet), count: transferCount },
    totalInflow: round2(totalInflow),
    totalOutflow: round2(totalOutflow),
  };
}

// The category when the source has one («Аренда»), else what the event is.
function lineLabel(e: FinancialEvent): string {
  return e.categoryName ?? e.description;
}
