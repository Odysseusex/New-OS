import { FinancialEvent, PnlLine } from "@bakery-os/shared";
import { round2 } from "../../common/money";

export interface PnlFromEvents {
  grossRevenue: number;
  discounts: number;
  returns: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  inventoryLosses: number;
  operatingExpenses: number;
  depreciation: number;
  operatingProfit: number;
  otherResult: number;
  profitBeforeTax: number;
  incomeTax: number;
  netProfit: number;
}

const sum = (events: FinancialEvent[], lines: PnlLine[]) =>
  events.reduce((total, e) => total + e.pnl.filter((p) => lines.includes(p.line)).reduce((s, p) => s + p.amount, 0), 0);

// The P&L, built from events alone. It exists to be compared with the direct
// P&L: both are derived from the same documents by different routes, so any
// difference is a real finding rather than a display choice.
export function pnlFromEvents(events: FinancialEvent[], from: Date, to: Date): PnlFromEvents {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const inPeriod = events.filter((e) => e.occurredAt >= fromIso && e.occurredAt <= toIso);
  const grossRevenue = sum(inPeriod, [PnlLine.REVENUE]);
  const discounts = -sum(inPeriod, [PnlLine.DISCOUNTS]);
  const returns = -sum(inPeriod, [PnlLine.RETURNS]);
  const cogs = -sum(inPeriod, [PnlLine.COGS]);
  const inventoryLosses = -sum(inPeriod, [PnlLine.INVENTORY_LOSS]);
  const operatingExpenses = -sum(inPeriod, [PnlLine.OPERATING_EXPENSE]);
  const depreciation = -sum(inPeriod, [PnlLine.DEPRECIATION]);
  const otherResult = sum(inPeriod, [PnlLine.OTHER_INCOME, PnlLine.OTHER_EXPENSE, PnlLine.FINANCIAL_INCOME, PnlLine.FINANCIAL_EXPENSE]);
  const incomeTax = -sum(inPeriod, [PnlLine.INCOME_TAX]);
  const netRevenue = round2(grossRevenue - discounts - returns);
  const grossProfit = round2(netRevenue - cogs);
  const operatingProfit = round2(grossProfit - inventoryLosses - operatingExpenses - depreciation);
  const profitBeforeTax = round2(operatingProfit + otherResult);
  return {
    grossRevenue: round2(grossRevenue),
    discounts: round2(discounts),
    returns: round2(returns),
    netRevenue,
    cogs: round2(cogs),
    grossProfit,
    inventoryLosses: round2(inventoryLosses),
    operatingExpenses: round2(operatingExpenses),
    depreciation: round2(depreciation),
    operatingProfit,
    otherResult: round2(otherResult),
    profitBeforeTax,
    incomeTax: round2(incomeTax),
    netProfit: round2(profitBeforeTax - incomeTax),
  };
}
