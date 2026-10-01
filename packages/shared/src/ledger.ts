// General ledger (Phase 10): double-entry bookkeeping over the existing
// operational ledgers. Shared between the API and the UI.
//
//   business document → AccountingEvent → JournalEntry → JournalLine
//
// Amounts cross the API as numbers with at most two decimals; every sum the
// server makes is done in exact decimal arithmetic before it gets here.

import { BalanceLine, PnlLine } from "./financial-events";

export enum LedgerAccountType {
  ASSET = "ASSET",
  LIABILITY = "LIABILITY",
  EQUITY = "EQUITY",
  REVENUE = "REVENUE",
  COGS = "COGS",
  OPERATING_EXPENSE = "OPERATING_EXPENSE",
  BELOW_OPERATING = "BELOW_OPERATING",
  TAX = "TAX",
}

export const LEDGER_ACCOUNT_TYPE_LABELS_RU: Record<LedgerAccountType, string> = {
  [LedgerAccountType.ASSET]: "Активы",
  [LedgerAccountType.LIABILITY]: "Обязательства",
  [LedgerAccountType.EQUITY]: "Капитал",
  [LedgerAccountType.REVENUE]: "Выручка",
  [LedgerAccountType.COGS]: "Себестоимость",
  [LedgerAccountType.OPERATING_EXPENSE]: "Операционные расходы",
  [LedgerAccountType.BELOW_OPERATING]: "Прочие и финансовые статьи",
  [LedgerAccountType.TAX]: "Налоги",
};

// Balance-sheet accounts carry over; result accounts are zero-based per period.
export const BALANCE_SHEET_ACCOUNT_TYPES: readonly LedgerAccountType[] = [
  LedgerAccountType.ASSET,
  LedgerAccountType.LIABILITY,
  LedgerAccountType.EQUITY,
];
export const RESULT_ACCOUNT_TYPES: readonly LedgerAccountType[] = [
  LedgerAccountType.REVENUE,
  LedgerAccountType.COGS,
  LedgerAccountType.OPERATING_EXPENSE,
  LedgerAccountType.BELOW_OPERATING,
  LedgerAccountType.TAX,
];

export enum NormalBalance {
  DEBIT = "DEBIT",
  CREDIT = "CREDIT",
}

export const NORMAL_BALANCE_LABELS_RU: Record<NormalBalance, string> = {
  [NormalBalance.DEBIT]: "Дебетовый",
  [NormalBalance.CREDIT]: "Кредитовый",
};

// The side an account of this type normally carries. A contra account (owner
// withdrawals, discounts…) deliberately differs and says so on the account itself.
export const DEFAULT_NORMAL_BALANCE: Record<LedgerAccountType, NormalBalance> = {
  [LedgerAccountType.ASSET]: NormalBalance.DEBIT,
  [LedgerAccountType.LIABILITY]: NormalBalance.CREDIT,
  [LedgerAccountType.EQUITY]: NormalBalance.CREDIT,
  [LedgerAccountType.REVENUE]: NormalBalance.CREDIT,
  [LedgerAccountType.COGS]: NormalBalance.DEBIT,
  [LedgerAccountType.OPERATING_EXPENSE]: NormalBalance.DEBIT,
  [LedgerAccountType.BELOW_OPERATING]: NormalBalance.DEBIT,
  [LedgerAccountType.TAX]: NormalBalance.DEBIT,
};

export enum AccountingEventStatus {
  POSTED = "POSTED",
  NOT_POSTED = "NOT_POSTED",
  UNAPPROVED = "UNAPPROVED",
  NO_GL_EFFECT = "NO_GL_EFFECT",
  EXCEPTION = "EXCEPTION",
  REVERSED = "REVERSED",
}

export const ACCOUNTING_EVENT_STATUS_LABELS_RU: Record<AccountingEventStatus, string> = {
  [AccountingEventStatus.POSTED]: "Проведено",
  [AccountingEventStatus.NOT_POSTED]: "Не проведено",
  [AccountingEventStatus.UNAPPROVED]: "Политика не утверждена",
  [AccountingEventStatus.NO_GL_EFFECT]: "Без влияния на главную книгу",
  [AccountingEventStatus.EXCEPTION]: "Исключение",
  [AccountingEventStatus.REVERSED]: "Сторнировано",
};

// Why an event is not (yet) in the ledger. Stored as the event's statusReason.
export enum NotPostedReason {
  UNCLASSIFIED = "UNCLASSIFIED",
  ACCOUNT_NOT_MAPPED = "ACCOUNT_NOT_MAPPED",
  PERIOD_CLOSED = "PERIOD_CLOSED",
  BEFORE_LEDGER_START = "BEFORE_LEDGER_START",
  OPENING_VIA_ENTRY = "OPENING_VIA_ENTRY",
  DOES_NOT_BALANCE = "DOES_NOT_BALANCE",
  SOURCE_CANCELLED = "SOURCE_CANCELLED",
}

export const NOT_POSTED_REASON_LABELS_RU: Record<NotPostedReason, string> = {
  [NotPostedReason.UNCLASSIFIED]: "Вторая сторона операции неизвестна (нет классификации)",
  [NotPostedReason.ACCOUNT_NOT_MAPPED]: "Не заведён системный счёт",
  [NotPostedReason.PERIOD_CLOSED]: "Период закрыт",
  [NotPostedReason.BEFORE_LEDGER_START]: "До запуска главной книги (не переносится автоматически)",
  [NotPostedReason.OPENING_VIA_ENTRY]: "Начальный остаток вносится отдельной проводкой",
  [NotPostedReason.DOES_NOT_BALANCE]: "Операция не сбалансирована",
  [NotPostedReason.SOURCE_CANCELLED]: "Источник отменён",
};

export enum JournalEntryKind {
  STANDARD = "STANDARD",
  OPENING_BALANCE = "OPENING_BALANCE",
  MANUAL = "MANUAL",
  REVERSAL = "REVERSAL",
}

export const JOURNAL_ENTRY_KIND_LABELS_RU: Record<JournalEntryKind, string> = {
  [JournalEntryKind.STANDARD]: "Из операции",
  [JournalEntryKind.OPENING_BALANCE]: "Начальный остаток",
  [JournalEntryKind.MANUAL]: "Ручная проводка",
  [JournalEntryKind.REVERSAL]: "Сторно",
};

// ── system accounts ─────────────────────────────────────────────────────
// The accounts the application itself posts to. The organization creates them
// once (explicitly) and may rename or re-code them; the KEY is what the posting
// rules use, so the code and name are free to follow the organization's own
// chart. Nothing else about the chart is prescribed.

export enum SystemAccountKey {
  CASH_ON_HAND = "CASH_ON_HAND",
  BANK = "BANK",
  RECEIVABLES = "RECEIVABLES",
  INVENTORY = "INVENTORY",
  FIXED_ASSETS = "FIXED_ASSETS",
  SUPPLIER_PAYABLES = "SUPPLIER_PAYABLES",
  EXPENSE_PAYABLES = "EXPENSE_PAYABLES",
  CONSIGNMENT_PAYABLES = "CONSIGNMENT_PAYABLES",
  LOANS = "LOANS",
  OPENING_EQUITY = "OPENING_EQUITY",
  OWNER_CONTRIBUTIONS = "OWNER_CONTRIBUTIONS",
  OWNER_WITHDRAWALS = "OWNER_WITHDRAWALS",
  SALES_REVENUE = "SALES_REVENUE",
  SALES_DISCOUNTS = "SALES_DISCOUNTS",
  SALES_RETURNS = "SALES_RETURNS",
  COST_OF_GOODS_SOLD = "COST_OF_GOODS_SOLD",
  OPERATING_EXPENSES = "OPERATING_EXPENSES",
  INVENTORY_LOSSES = "INVENTORY_LOSSES",
  DEPRECIATION_EXPENSE = "DEPRECIATION_EXPENSE",
  OTHER_INCOME = "OTHER_INCOME",
  OTHER_EXPENSE = "OTHER_EXPENSE",
  FINANCIAL_INCOME = "FINANCIAL_INCOME",
  FINANCIAL_EXPENSE = "FINANCIAL_EXPENSE",
  INCOME_TAX_EXPENSE = "INCOME_TAX_EXPENSE",
}

export interface SystemAccountDef {
  name: string;
  type: LedgerAccountType;
  normalBalance: NormalBalance;
}

const T = LedgerAccountType;
const D = NormalBalance.DEBIT;
const C = NormalBalance.CREDIT;

export const SYSTEM_ACCOUNT_DEFS: Record<SystemAccountKey, SystemAccountDef> = {
  [SystemAccountKey.CASH_ON_HAND]: { name: "Касса", type: T.ASSET, normalBalance: D },
  [SystemAccountKey.BANK]: { name: "Банк", type: T.ASSET, normalBalance: D },
  [SystemAccountKey.RECEIVABLES]: { name: "Дебиторская задолженность", type: T.ASSET, normalBalance: D },
  [SystemAccountKey.INVENTORY]: { name: "Запасы", type: T.ASSET, normalBalance: D },
  [SystemAccountKey.FIXED_ASSETS]: { name: "Основные средства (остаточная стоимость)", type: T.ASSET, normalBalance: D },
  [SystemAccountKey.SUPPLIER_PAYABLES]: { name: "Кредиторская задолженность — поставщики", type: T.LIABILITY, normalBalance: C },
  [SystemAccountKey.EXPENSE_PAYABLES]: { name: "Кредиторская задолженность — расходы", type: T.LIABILITY, normalBalance: C },
  [SystemAccountKey.CONSIGNMENT_PAYABLES]: { name: "Кредиторская задолженность — консигнация", type: T.LIABILITY, normalBalance: C },
  [SystemAccountKey.LOANS]: { name: "Займы и кредиты", type: T.LIABILITY, normalBalance: C },
  [SystemAccountKey.OPENING_EQUITY]: { name: "Начальный капитал", type: T.EQUITY, normalBalance: C },
  [SystemAccountKey.OWNER_CONTRIBUTIONS]: { name: "Взносы собственника", type: T.EQUITY, normalBalance: C },
  [SystemAccountKey.OWNER_WITHDRAWALS]: { name: "Изъятия собственника", type: T.EQUITY, normalBalance: D },
  [SystemAccountKey.SALES_REVENUE]: { name: "Выручка от продаж", type: T.REVENUE, normalBalance: C },
  [SystemAccountKey.SALES_DISCOUNTS]: { name: "Скидки покупателям", type: T.REVENUE, normalBalance: D },
  [SystemAccountKey.SALES_RETURNS]: { name: "Возвраты от покупателей", type: T.REVENUE, normalBalance: D },
  [SystemAccountKey.COST_OF_GOODS_SOLD]: { name: "Себестоимость проданного", type: T.COGS, normalBalance: D },
  [SystemAccountKey.OPERATING_EXPENSES]: { name: "Операционные расходы", type: T.OPERATING_EXPENSE, normalBalance: D },
  [SystemAccountKey.INVENTORY_LOSSES]: { name: "Потери запасов", type: T.OPERATING_EXPENSE, normalBalance: D },
  [SystemAccountKey.DEPRECIATION_EXPENSE]: { name: "Амортизация", type: T.OPERATING_EXPENSE, normalBalance: D },
  [SystemAccountKey.OTHER_INCOME]: { name: "Прочие доходы", type: T.BELOW_OPERATING, normalBalance: C },
  [SystemAccountKey.OTHER_EXPENSE]: { name: "Прочие расходы", type: T.BELOW_OPERATING, normalBalance: D },
  [SystemAccountKey.FINANCIAL_INCOME]: { name: "Финансовые доходы", type: T.BELOW_OPERATING, normalBalance: C },
  [SystemAccountKey.FINANCIAL_EXPENSE]: { name: "Финансовые расходы", type: T.BELOW_OPERATING, normalBalance: D },
  [SystemAccountKey.INCOME_TAX_EXPENSE]: { name: "Налог на прибыль", type: T.TAX, normalBalance: D },
};

export const SYSTEM_ACCOUNT_KEYS: readonly SystemAccountKey[] = Object.values(SystemAccountKey);

// The posting rules: which system account an event's balance / result leg
// lands on. CASH_AND_BANK is absent on purpose — cash legs carry their own
// account and post to Касса or Банк by the account's type.
export const BALANCE_LINE_ACCOUNT_KEY: Partial<Record<BalanceLine, SystemAccountKey>> = {
  [BalanceLine.INVENTORY]: SystemAccountKey.INVENTORY,
  [BalanceLine.RECEIVABLES]: SystemAccountKey.RECEIVABLES,
  [BalanceLine.FIXED_ASSETS]: SystemAccountKey.FIXED_ASSETS,
  [BalanceLine.SUPPLIER_PAYABLES]: SystemAccountKey.SUPPLIER_PAYABLES,
  [BalanceLine.EXPENSE_PAYABLES]: SystemAccountKey.EXPENSE_PAYABLES,
  [BalanceLine.CONSIGNMENT_PAYABLES]: SystemAccountKey.CONSIGNMENT_PAYABLES,
  [BalanceLine.LOANS]: SystemAccountKey.LOANS,
  [BalanceLine.OPENING_EQUITY]: SystemAccountKey.OPENING_EQUITY,
  [BalanceLine.OWNER_CONTRIBUTIONS]: SystemAccountKey.OWNER_CONTRIBUTIONS,
  [BalanceLine.OWNER_WITHDRAWALS]: SystemAccountKey.OWNER_WITHDRAWALS,
};

export const PNL_LINE_ACCOUNT_KEY: Record<PnlLine, SystemAccountKey> = {
  [PnlLine.REVENUE]: SystemAccountKey.SALES_REVENUE,
  [PnlLine.DISCOUNTS]: SystemAccountKey.SALES_DISCOUNTS,
  [PnlLine.RETURNS]: SystemAccountKey.SALES_RETURNS,
  [PnlLine.COGS]: SystemAccountKey.COST_OF_GOODS_SOLD,
  [PnlLine.INVENTORY_LOSS]: SystemAccountKey.INVENTORY_LOSSES,
  [PnlLine.OPERATING_EXPENSE]: SystemAccountKey.OPERATING_EXPENSES,
  [PnlLine.DEPRECIATION]: SystemAccountKey.DEPRECIATION_EXPENSE,
  [PnlLine.OTHER_INCOME]: SystemAccountKey.OTHER_INCOME,
  [PnlLine.OTHER_EXPENSE]: SystemAccountKey.OTHER_EXPENSE,
  [PnlLine.FINANCIAL_INCOME]: SystemAccountKey.FINANCIAL_INCOME,
  [PnlLine.FINANCIAL_EXPENSE]: SystemAccountKey.FINANCIAL_EXPENSE,
  [PnlLine.INCOME_TAX]: SystemAccountKey.INCOME_TAX_EXPENSE,
};

// ── dimensions ──────────────────────────────────────────────────────────
// Nullable on every line. Department / project / cost centre do not exist in
// the schema yet; they join as further nullable columns without reshaping.
export interface JournalDimensions {
  cashAccountId?: string | null;
  locationId?: string | null;
  productId?: string | null;
  categoryId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  financeCategoryId?: string | null;
}

// ── chart of accounts ───────────────────────────────────────────────────
export interface LedgerAccountDto {
  id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  normalBalance: NormalBalance;
  parentId: string | null;
  isActive: boolean;
  systemAccountKey: SystemAccountKey | null;
  // Has at least one posted line: its type/side can no longer be changed.
  hasPostings: boolean;
}

export interface CreateLedgerAccountInput {
  code: string;
  name: string;
  type: LedgerAccountType;
  normalBalance?: NormalBalance;
  parentId?: string | null;
}

export interface UpdateLedgerAccountInput {
  code?: string;
  name?: string;
  parentId?: string | null;
  isActive?: boolean;
  // Only while the account has no postings.
  type?: LedgerAccountType;
  normalBalance?: NormalBalance;
}

export interface LedgerStatusDto {
  enabled: boolean;
  startsAt: string | null;
  systemAccountsReady: boolean;
  missingSystemAccounts: SystemAccountKey[];
  openingEntryPosted: boolean;
  eventCounts: Record<AccountingEventStatus, number>;
  // Events dated from the start that are eligible but not looked at yet. Null:
  // not computed here (it needs a full projection) — see the coverage report.
  pendingEvents: number | null;
}

// ── journal ─────────────────────────────────────────────────────────────
export interface JournalLineInput extends JournalDimensions {
  accountId?: string;
  systemAccountKey?: SystemAccountKey;
  debit?: number;
  credit?: number;
  description?: string;
  cashSection?: string | null;
}

export interface ManualJournalEntryInput {
  entryDate: string;
  description: string;
  reference?: string;
  lines: JournalLineInput[];
}

export interface OpeningBalanceLineInput {
  accountId?: string;
  systemAccountKey?: SystemAccountKey;
  // Positive = the account's normal side carries this much.
  amount: number;
}

export interface OpeningBalanceInput {
  lines: OpeningBalanceLineInput[];
  note?: string;
}

// What the system could propose for the opening entry from the position the
// owner already declared. Read-only: nothing is posted until it is submitted.
export interface OpeningBalanceProposalDto {
  startsAt: string | null;
  lines: { systemAccountKey: SystemAccountKey; accountName: string; amount: number; source: string }[];
  notes: string[];
}

export interface ReverseJournalEntryInput {
  reason: string;
}

export interface EnableLedgerInput {
  startsAt: string;
}

export interface JournalLineDto extends JournalDimensions {
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
  cashSection: string | null;
}

export interface JournalEntrySourceDto {
  accountingEventId: string;
  eventKey: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
}

export interface JournalEntryDto {
  id: string;
  number: number;
  entryDate: string;
  description: string;
  kind: JournalEntryKind;
  reference: string | null;
  periodYear: number;
  periodMonth: number;
  postedAt: string;
  postedByName: string | null;
  source: JournalEntrySourceDto | null;
  reversalOfEntryId: string | null;
  reversedByEntryId: string | null;
  reversalReason: string | null;
  totalDebit: number;
  totalCredit: number;
  lines: JournalLineDto[];
}

export interface JournalListQuery {
  from?: string;
  to?: string;
  accountId?: string;
  kind?: JournalEntryKind;
  sourceType?: string;
  limit?: number;
  offset?: number;
}

// ── general ledger / trial balance ─────────────────────────────────────
export interface GeneralLedgerRowDto {
  date: string;
  entryId: string;
  entryNumber: number;
  reference: string | null;
  description: string;
  debit: number;
  credit: number;
  // In the account's own normal side: a debit-normal account grows with debits.
  runningBalance: number;
  sourceType: string | null;
  sourceId: string | null;
}

export interface GeneralLedgerDto {
  account: LedgerAccountDto;
  from: string | null;
  to: string | null;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  rows: GeneralLedgerRowDto[];
}

export interface LedgerFilterQuery {
  from?: string;
  to?: string;
  locationId?: string;
  accountType?: LedgerAccountType;
  productId?: string;
  customerId?: string;
  supplierId?: string;
}

export interface TrialBalanceRowDto {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  normalBalance: NormalBalance;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  // Debit minus credit over the whole span up to `to` — the sign convention
  // of the trial balance's own Debit / Credit columns.
  closingDebit: number;
  closingCredit: number;
  // The same figure on the account's normal side.
  closingBalance: number;
}

export interface TrialBalanceDto {
  from: string | null;
  to: string | null;
  rows: TrialBalanceRowDto[];
  totals: {
    periodDebit: number;
    periodCredit: number;
    closingDebit: number;
    closingCredit: number;
    balanced: boolean;
    // closingDebit − closingCredit. Shown, never absorbed into any account.
    difference: number;
  };
}

// ── statements from the ledger ─────────────────────────────────────────
export interface GlPnlLineDto {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  amount: number;
}

export interface GlPnlDto {
  from: string;
  to: string;
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
  lines: GlPnlLineDto[];
}

export interface GlBalanceLineDto {
  accountId: string;
  code: string;
  name: string;
  group: string;
  amount: number;
}

export interface GlBalanceSheetDto {
  asOf: string;
  assets: { lines: GlBalanceLineDto[]; total: number };
  liabilities: { lines: GlBalanceLineDto[]; total: number };
  equity: {
    lines: GlBalanceLineDto[];
    // Result of every period since the ledger started, not yet closed into equity.
    accumulatedResult: number;
    // …of which earlier accounting periods (months) and the period containing `asOf`.
    retainedResult: number;
    currentPeriodResult: number;
    total: number;
  };
  // Assets − (Liabilities + Equity). Zero whenever every entry balances; a
  // non-zero value is a diagnostic, never an account.
  difference: number;
  balanced: boolean;
}

export interface GlCashFlowSectionDto {
  section: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface GlCashFlowDto {
  from: string;
  to: string;
  openingBalance: number;
  sections: GlCashFlowSectionDto[];
  internalTransfers: { inflow: number; outflow: number; net: number };
  totalInflow: number;
  totalOutflow: number;
  closingBalance: number;
}

export interface PnlReconciliationRowDto {
  metric: string;
  ledger: number;
  existing: number;
  difference: number;
}

export interface PnlReconciliationDto {
  from: string;
  to: string;
  rows: PnlReconciliationRowDto[];
  // Why the two can differ: events that are not in the ledger.
  unpostedEvents: number;
  matches: boolean;
}

// ── diagnostics & coverage ─────────────────────────────────────────────
export type DiagnosticStatus = "PASS" | "FAIL" | "WARNING" | "NOT_AVAILABLE";
export type DiagnosticSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface LedgerDiagnosticDto {
  check: string;
  title: string;
  status: DiagnosticStatus;
  expected: number | string | null;
  actual: number | string | null;
  difference: number | null;
  severity: DiagnosticSeverity;
  source: string;
  details?: string[];
}

export interface LedgerDiagnosticsReportDto {
  generatedAt: string;
  enabled: boolean;
  checks: LedgerDiagnosticDto[];
  summary: { pass: number; fail: number; warning: number; notAvailable: number };
}

export enum CoverageStatus {
  GL_POSTED = "GL_POSTED",
  PARTIALLY_POSTED = "PARTIALLY_POSTED",
  NOT_POSTED = "NOT_POSTED",
  UNAPPROVED = "UNAPPROVED",
  NOT_APPLICABLE = "NOT_APPLICABLE",
}

export const COVERAGE_STATUS_LABELS_RU: Record<CoverageStatus, string> = {
  [CoverageStatus.GL_POSTED]: "Проведено в главную книгу",
  [CoverageStatus.PARTIALLY_POSTED]: "Проведено частично",
  [CoverageStatus.NOT_POSTED]: "Не проведено",
  [CoverageStatus.UNAPPROVED]: "Политика не утверждена",
  [CoverageStatus.NOT_APPLICABLE]: "Нет операций",
};

export interface LedgerCoverageRowDto {
  key: string;
  label: string;
  status: CoverageStatus;
  // Operations of this family dated from the ledger start.
  total: number;
  posted: number;
  notPosted: number;
  // Dated before the ledger start: never converted automatically.
  notMigrated: number;
  note: string | null;
}

export interface LedgerCoverageDto {
  generatedAt: string;
  startsAt: string | null;
  rows: LedgerCoverageRowDto[];
}

export interface PostPendingResultDto {
  considered: number;
  posted: number;
  notPosted: number;
  alreadyDone: number;
}
