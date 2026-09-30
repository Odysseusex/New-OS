// FinancialEvent: the single, NON-PERSISTED description of what a business
// fact does to the three statements. Events are derived on demand from the
// source documents and ledgers by deterministic rules; nothing writes an event
// and nothing is stored, so a statement can always be rebuilt and two runs
// over the same sources give the identical result.

export enum PnlLine {
  REVENUE = "REVENUE",
  DISCOUNTS = "DISCOUNTS",
  RETURNS = "RETURNS",
  COGS = "COGS",
  INVENTORY_LOSS = "INVENTORY_LOSS",
  OPERATING_EXPENSE = "OPERATING_EXPENSE",
  DEPRECIATION = "DEPRECIATION",
  OTHER_INCOME = "OTHER_INCOME",
  OTHER_EXPENSE = "OTHER_EXPENSE",
  FINANCIAL_INCOME = "FINANCIAL_INCOME",
  FINANCIAL_EXPENSE = "FINANCIAL_EXPENSE",
  INCOME_TAX = "INCOME_TAX",
}

export enum BalanceLine {
  // Assets
  CASH_AND_BANK = "CASH_AND_BANK",
  INVENTORY = "INVENTORY",
  RECEIVABLES = "RECEIVABLES",
  FIXED_ASSETS = "FIXED_ASSETS",
  // Liabilities
  SUPPLIER_PAYABLES = "SUPPLIER_PAYABLES",
  EXPENSE_PAYABLES = "EXPENSE_PAYABLES",
  CONSIGNMENT_PAYABLES = "CONSIGNMENT_PAYABLES",
  LOANS = "LOANS",
  // Equity (direct movements only — the result of operations arrives through
  // the P&L legs, never as an equity line of its own)
  OPENING_EQUITY = "OPENING_EQUITY",
  OWNER_CONTRIBUTIONS = "OWNER_CONTRIBUTIONS",
  OWNER_WITHDRAWALS = "OWNER_WITHDRAWALS",
}

export type BalanceSide = "ASSET" | "LIABILITY" | "EQUITY";

export const BALANCE_LINE_SIDE: Record<BalanceLine, BalanceSide> = {
  [BalanceLine.CASH_AND_BANK]: "ASSET",
  [BalanceLine.INVENTORY]: "ASSET",
  [BalanceLine.RECEIVABLES]: "ASSET",
  [BalanceLine.FIXED_ASSETS]: "ASSET",
  [BalanceLine.SUPPLIER_PAYABLES]: "LIABILITY",
  [BalanceLine.EXPENSE_PAYABLES]: "LIABILITY",
  [BalanceLine.CONSIGNMENT_PAYABLES]: "LIABILITY",
  [BalanceLine.LOANS]: "LIABILITY",
  [BalanceLine.OPENING_EQUITY]: "EQUITY",
  [BalanceLine.OWNER_CONTRIBUTIONS]: "EQUITY",
  [BalanceLine.OWNER_WITHDRAWALS]: "EQUITY",
};

export const BALANCE_LINE_LABELS_RU: Record<BalanceLine, string> = {
  [BalanceLine.CASH_AND_BANK]: "Денежные средства",
  [BalanceLine.INVENTORY]: "Запасы",
  [BalanceLine.RECEIVABLES]: "Дебиторская задолженность",
  [BalanceLine.FIXED_ASSETS]: "Основные средства",
  [BalanceLine.SUPPLIER_PAYABLES]: "Кредиторская задолженность — поставщики",
  [BalanceLine.EXPENSE_PAYABLES]: "Кредиторская задолженность — расходы",
  [BalanceLine.CONSIGNMENT_PAYABLES]: "Кредиторская задолженность — консигнация",
  [BalanceLine.LOANS]: "Займы и кредиты",
  [BalanceLine.OPENING_EQUITY]: "Начальный капитал",
  [BalanceLine.OWNER_CONTRIBUTIONS]: "Взносы собственника",
  [BalanceLine.OWNER_WITHDRAWALS]: "Изъятия собственника",
};

// Where a cash leg lands in the cash-flow statement. OPENING and INTERNAL are
// deliberately not activities: opening money is a starting position, never an
// inflow, and a transfer between own accounts is not money entering or leaving.
export enum CashSection {
  OPENING = "OPENING",
  OPERATING = "OPERATING",
  INVESTING = "INVESTING",
  FINANCING = "FINANCING",
  INTERNAL = "INTERNAL",
  UNCLASSIFIED = "UNCLASSIFIED",
}

export const CASH_SECTION_LABELS_RU: Record<CashSection, string> = {
  [CashSection.OPENING]: "Начальный остаток",
  [CashSection.OPERATING]: "Операционная деятельность",
  [CashSection.INVESTING]: "Инвестиционная деятельность",
  [CashSection.FINANCING]: "Финансовая деятельность",
  [CashSection.INTERNAL]: "Внутренние переводы",
  [CashSection.UNCLASSIFIED]: "Не классифицировано",
};

export enum FinancialEventType {
  OPENING_BALANCE = "OPENING_BALANCE",
  CUSTOMER_RECEIPT = "CUSTOMER_RECEIPT",
  CUSTOMER_REFUND = "CUSTOMER_REFUND",
  SUPPLIER_PAYMENT = "SUPPLIER_PAYMENT",
  EXPENSE_PAYMENT = "EXPENSE_PAYMENT",
  INTERNAL_TRANSFER = "INTERNAL_TRANSFER",
  OWNER_CONTRIBUTION = "OWNER_CONTRIBUTION",
  OWNER_WITHDRAWAL = "OWNER_WITHDRAWAL",
  LOAN_PROCEEDS = "LOAN_PROCEEDS",
  LOAN_REPAYMENT = "LOAN_REPAYMENT",
  CASH_RESULT = "CASH_RESULT",
  CASH_UNCLASSIFIED = "CASH_UNCLASSIFIED",
  // Accrual-side events (added with the full catalogue)
  SALE = "SALE",
  SALE_COST = "SALE_COST",
  SALE_RETURN = "SALE_RETURN",
  SALE_RETURN_COST = "SALE_RETURN_COST",
  EXPENSE_ACCRUAL = "EXPENSE_ACCRUAL",
  PURCHASE_RECEIPT = "PURCHASE_RECEIPT",
  INVOICE_RECEIPT = "INVOICE_RECEIPT",
  INVENTORY_LOSS = "INVENTORY_LOSS",
  INVENTORY_GAIN = "INVENTORY_GAIN",
  CONSIGNMENT_SALE = "CONSIGNMENT_SALE",
  CONSIGNMENT_RETURN = "CONSIGNMENT_RETURN",
  SUPPLIER_RETURN = "SUPPLIER_RETURN",
  DEPRECIATION = "DEPRECIATION",
  ASSET_DISPOSAL = "ASSET_DISPOSAL",
  OPENING_POSITION = "OPENING_POSITION",
}

export interface CashLeg {
  accountId: string;
  section: CashSection;
  // Signed: + money in, − money out.
  amount: number;
}
export interface BalanceLeg {
  line: BalanceLine;
  // Signed change of the line's own balance (a liability line rises with +).
  delta: number;
}
export interface PnlLeg {
  line: PnlLine;
  // Signed effect on the period result: income +, expense −.
  amount: number;
}

export interface FinancialEvent {
  // Deterministic identity: `${sourceType}:${sourceId}[:${part}]`. Two events
  // never share a key, and the same source always yields the same key.
  key: string;
  type: FinancialEventType;
  occurredAt: string;
  sourceType: string;
  sourceId: string;
  description: string;
  cash: CashLeg[];
  balance: BalanceLeg[];
  pnl: PnlLeg[];
  // True when the rules cannot know the counter-side of the cash leg (no usable
  // classification). The cash leg is still recorded; nothing is invented for
  // the missing side. A cash-flow SECTION being UNCLASSIFIED is a different,
  // lesser thing: the counter-side may be perfectly known.
  unclassified: boolean;
  // Category the money was booked under, when the source has one. Statements
  // use it as the line label so the owner sees «Аренда», not a mechanism.
  categoryName?: string | null;
}

export interface EventInvariantViolation {
  invariant: "I1" | "I2" | "I3" | "I4";
  key: string;
  detail: string;
}

export interface EventInvariantReport {
  eventCount: number;
  // Events skipped by I1 because their counter-side is unknown (unclassified).
  incompleteEvents: number;
  violations: EventInvariantViolation[];
}
