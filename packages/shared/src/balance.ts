import { BalanceLine } from "./financial-events";
import type { CashFlowDto, ProfitAndLossDto } from "./finance";

// The balance sheet, without a plug.
//
// Assets and liabilities are what the ledgers and registers actually hold.
// Equity is built from its own history — the declared opening position, what
// the owner put in and took out, and the accumulated financial result of the
// events since — and is NEVER computed as Assets − Liabilities. If the two
// sides do not agree, the statement says NOT_BALANCED and lists why in a
// separate CONTROL section; nothing in CONTROL is added to a total.

export enum BalanceStatus {
  BALANCED = "BALANCED",
  NOT_BALANCED = "NOT_BALANCED",
  // The opening position has not been declared, so equity cannot be built.
  NOT_AVAILABLE = "NOT_AVAILABLE",
}

export const BALANCE_STATUS_LABELS_RU: Record<BalanceStatus, string> = {
  [BalanceStatus.BALANCED]: "Баланс сходится",
  [BalanceStatus.NOT_BALANCED]: "Баланс не сходится",
  [BalanceStatus.NOT_AVAILABLE]: "Баланс недоступен",
};

// Where a line's figure comes from.
export type BalanceSource = "LEDGER" | "REGISTER" | "DOCUMENTS" | "EVENTS";

export interface BalanceLineDto {
  line: BalanceLine;
  label: string;
  amount: number;
  source: BalanceSource;
}

export interface BalanceSectionDto {
  lines: BalanceLineDto[];
  total: number;
}

export interface BalanceEquityDto extends BalanceSectionDto {
  // The result of operations since the opening, from the events' P&L legs.
  accumulatedResult: number;
}

// One reason the two sides differ. Both figures are shown; nothing here is a total.
export interface BalanceControlLineDto {
  label: string;
  // What the ledger/register/documents hold …
  actual: number | null;
  // … and what the events say it should be.
  projected: number | null;
  // actual − projected, signed as it moves Assets − Liabilities − Equity.
  effect: number;
}

export interface BalanceControlDto {
  // Assets − Liabilities − Equity. Zero when the statement balances.
  difference: number;
  lines: BalanceControlLineDto[];
  // Findings that are not amounts (counts, missing declarations).
  notes: string[];
}

export interface BalanceSheetDto {
  asOf: string;
  status: BalanceStatus;
  assets: BalanceSectionDto;
  liabilities: BalanceSectionDto;
  equity: BalanceEquityDto;
  // Separate from everything above. Never part of Assets, Liabilities or Equity.
  control: BalanceControlDto;
  costingMethod: string;
}

// Inventory as quantity and value moving through the period. A reconciliation
// view: it explains the change, it never adjusts anything.
export interface InventoryRollForwardLineDto {
  key: string;
  label: string;
  quantity: number;
  // Valued at the cost stamped on each movement (today's cost where none was
  // stamped); null cost is left out and counted in `unvaluedMovements`.
  value: number;
}

export interface InventoryRollForwardDto {
  from: string;
  to: string;
  opening: { quantity: number; value: number };
  movements: InventoryRollForwardLineDto[];
  closingComputed: { quantity: number; value: number };
  // What the stock levels actually hold at the end of the period.
  closingActual: { quantity: number; value: number } | null;
  // closingActual − closingComputed. Shown, never absorbed.
  difference: { quantity: number; value: number } | null;
  reconciles: boolean | null;
  unvaluedMovements: number;
  costingMethod: string;
}

export interface MonthlyReportDto {
  year: number;
  month: number;
  from: string;
  to: string;
  pnl: ProfitAndLossDto;
  previousPnl: ProfitAndLossDto | null;
  cashFlow: CashFlowDto;
  balance: BalanceSheetDto;
  inventory: InventoryRollForwardDto;
  accountsReceivable: number;
  accountsPayable: number;
}
