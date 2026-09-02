import { PaymentStatus } from "./customers";
import { Unit } from "./catalog";
import { CompensationType } from "./hr";

// How a sale was settled — decides which CashAccount a receipt lands in
// (CASH -> the selling location's till, CARD/TRANSFER -> the organization's
// default bank account).
export enum PaymentMethod {
  CASH = "CASH",
  CARD = "CARD",
  TRANSFER = "TRANSFER",
}

export const PAYMENT_METHOD_LABELS_RU: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: "Наличные",
  [PaymentMethod.CARD]: "Карта",
  [PaymentMethod.TRANSFER]: "Перевод",
};

// ── Cash accounts (bank accounts + cash registers — one entity, two
// subtypes, same pattern as Location.type/Product.type elsewhere) ─────

export enum CashAccountType {
  BANK = "BANK",
  CASH = "CASH",
}

export const CASH_ACCOUNT_TYPE_LABELS_RU: Record<CashAccountType, string> = {
  [CashAccountType.BANK]: "Банковский счёт",
  [CashAccountType.CASH]: "Касса",
};

export interface CashAccountDto {
  id: string;
  name: string;
  type: CashAccountType;
  locationId: string | null;
  locationName: string | null;
  isDefault: boolean;
  currentBalance: number;
  isActive: boolean;
}

export interface CreateCashAccountRequestDto {
  name: string;
  type: CashAccountType;
  locationId?: string;
  isDefault?: boolean;
  openingBalance?: number;
}

export interface UpdateCashAccountRequestDto {
  name: string;
}

// ── Finance categories — user-managed income/expense catalog, replaces
// the old hardcoded ExpenseCategory enum (same pattern as product Category
// and RecipeStageType: adding one is a user action, not a code deploy) ──

export enum FinanceCategoryKind {
  INCOME = "INCOME",
  EXPENSE = "EXPENSE",
}

export const FINANCE_CATEGORY_KIND_LABELS_RU: Record<FinanceCategoryKind, string> = {
  [FinanceCategoryKind.INCOME]: "Доход",
  [FinanceCategoryKind.EXPENSE]: "Расход",
};

// How an expense category behaves as sales volume changes — the input to
// break-even/contribution-margin analysis. UNCLASSIFIED is a first-class,
// always-visible state (not silently inferred as either): a new category
// starts here and stays here until someone deliberately classifies it, and
// break-even reporting must say so honestly rather than guess.
export enum CostBehavior {
  FIXED = "FIXED",
  VARIABLE = "VARIABLE",
  UNCLASSIFIED = "UNCLASSIFIED",
}

export const COST_BEHAVIOR_LABELS_RU: Record<CostBehavior, string> = {
  [CostBehavior.FIXED]: "Постоянные",
  [CostBehavior.VARIABLE]: "Переменные",
  [CostBehavior.UNCLASSIFIED]: "Не классифицированы",
};

export interface FinanceCategoryDto {
  id: string;
  name: string;
  kind: FinanceCategoryKind;
  isActive: boolean;
  costBehavior: CostBehavior;
}

export interface CreateFinanceCategoryRequestDto {
  name: string;
  kind: FinanceCategoryKind;
  costBehavior?: CostBehavior;
}

export interface UpdateFinanceCategoryRequestDto {
  name: string;
}

export interface SetFinanceCategoryCostBehaviorRequestDto {
  costBehavior: CostBehavior;
}

// ── Cash movements — the single append-only money ledger, the direct
// counterpart of StockMovement. Never edited/deleted; corrections are a new
// ADJUSTMENT row referencing the one it corrects. ──────────────────────

export enum CashMovementType {
  OPENING_BALANCE = "OPENING_BALANCE",
  SALE_RECEIPT = "SALE_RECEIPT",
  SALE_REFUND = "SALE_REFUND",
  CUSTOMER_PAYMENT = "CUSTOMER_PAYMENT",
  SUPPLIER_PAYMENT = "SUPPLIER_PAYMENT",
  EXPENSE_PAYMENT = "EXPENSE_PAYMENT",
  TRANSFER_IN = "TRANSFER_IN",
  TRANSFER_OUT = "TRANSFER_OUT",
  CASH_DEPOSIT = "CASH_DEPOSIT",
  CASH_WITHDRAWAL = "CASH_WITHDRAWAL",
  OTHER_INCOME = "OTHER_INCOME",
  OTHER_EXPENSE = "OTHER_EXPENSE",
  ADJUSTMENT = "ADJUSTMENT",
}

export const CASH_MOVEMENT_TYPE_LABELS_RU: Record<CashMovementType, string> = {
  [CashMovementType.OPENING_BALANCE]: "Начальный остаток",
  [CashMovementType.SALE_RECEIPT]: "Оплата от покупателя",
  [CashMovementType.SALE_REFUND]: "Возврат покупателю",
  [CashMovementType.CUSTOMER_PAYMENT]: "Погашение долга клиентом",
  [CashMovementType.SUPPLIER_PAYMENT]: "Оплата поставщику",
  [CashMovementType.EXPENSE_PAYMENT]: "Оплата расхода",
  [CashMovementType.TRANSFER_IN]: "Перевод (зачисление)",
  [CashMovementType.TRANSFER_OUT]: "Перевод (списание)",
  [CashMovementType.CASH_DEPOSIT]: "Пополнение кассы",
  [CashMovementType.CASH_WITHDRAWAL]: "Снятие наличных",
  [CashMovementType.OTHER_INCOME]: "Прочий доход",
  [CashMovementType.OTHER_EXPENSE]: "Прочий расход",
  [CashMovementType.ADJUSTMENT]: "Корректировка",
};

// Types where money flows INTO the account — used to render +/- and to sum
// "today's inflow/outflow". ADJUSTMENT is excluded: its direction is carried
// by the sign of `amount` itself, not by type (mirrors how
// StockMovement.quantity works for its own ADJUSTMENT type).
export const CASH_MOVEMENT_INFLOW_TYPES: CashMovementType[] = [
  CashMovementType.OPENING_BALANCE,
  CashMovementType.SALE_RECEIPT,
  CashMovementType.CUSTOMER_PAYMENT,
  CashMovementType.TRANSFER_IN,
  CashMovementType.CASH_DEPOSIT,
  CashMovementType.OTHER_INCOME,
];

export interface CashMovementDto {
  id: string;
  accountId: string;
  accountName: string;
  type: CashMovementType;
  amount: number;
  occurredAt: string;
  reason: string | null;
  categoryId: string | null;
  categoryName: string | null;
  customerId: string | null;
  customerName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  saleId: string | null;
  expenseId: string | null;
  invoiceId: string | null;
  correctsMovementId: string | null;
  createdByName: string;
}

export interface CashDepositRequestDto {
  accountId: string;
  amount: number;
  reason?: string;
}

export interface CashWithdrawalRequestDto {
  accountId: string;
  amount: number;
  reason?: string;
}

export interface CashTransferRequestDto {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  reason?: string;
}

export interface CashAdjustmentRequestDto {
  accountId: string;
  // The true, physically counted balance — the server computes the signed
  // delta itself, same convention as InventoryService.adjust().
  actualBalance: number;
  reason: string;
}

// ── Expenses — a document with a real lifecycle, same shape as the
// supplier side of Invoice: DRAFT (editable, no obligation yet) ->
// CONFIRMED (a real payable) -> paid down via amountPaid. Confirming does
// NOT move money by itself — only recordPayment() does. ─────────────────

export enum ExpenseStatus {
  DRAFT = "DRAFT",
  CONFIRMED = "CONFIRMED",
  CANCELLED = "CANCELLED",
}

export const EXPENSE_STATUS_LABELS_RU: Record<ExpenseStatus, string> = {
  [ExpenseStatus.DRAFT]: "Черновик",
  [ExpenseStatus.CONFIRMED]: "Подтверждён",
  [ExpenseStatus.CANCELLED]: "Отменён",
};

export interface ExpenseDto {
  id: string;
  locationId: string | null;
  locationName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: ExpenseStatus;
  amount: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  description: string | null;
  incurredOn: string;
  createdByName: string;
}

export interface CreateExpenseRequestDto {
  locationId?: string;
  categoryId?: string;
  amount: number;
  description?: string;
  incurredOn?: string;
  // Fast path (default true): the expense is created CONFIRMED and fully
  // paid in one step, exactly like today's one-shot expense log. Set false
  // to create a DRAFT instead — reviewed/confirmed and paid later.
  paidImmediately?: boolean;
  // Required when paidImmediately is true — which account the money left.
  accountId?: string;
}

export interface RecordExpensePaymentRequestDto {
  accountId: string;
  amount: number;
}

export interface RecordSupplierPaymentRequestDto {
  accountId: string;
  amount: number;
}

// ── P&L ──────────────────────────────────────────────────────────────

export type FinancePeriodPreset = "today" | "7d" | "30d" | "month";

export interface ProductPnLDto {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPercent: number | null;
  hasCostData: boolean;
}

export interface ProfitAndLossDto {
  from: string;
  to: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  expensesTotal: number;
  // = grossProfit - expensesTotal. Named honestly: with no interest/tax/
  // non-operating items tracked yet, this is operating profit, not net
  // profit (see FinanceDashboardDto.netProfit, which mirrors it for now).
  operatingProfit: number;
  unknownCostLineItems: number;
  byProduct: ProductPnLDto[];
}

// ── Break-even analysis — reuses getProfitAndLoss()'s revenue/cogs rather
// than recomputing them; the only new input is FinanceCategory.costBehavior
// applied to CONFIRMED expenses in the same period. Deliberately not a
// forecast: it answers "at this period's actual margin, what revenue would
// have covered fixed costs", nothing more. Every non-OK status means the
// number is intentionally withheld rather than shown wrong. ────────────

export enum BreakEvenStatus {
  // Enough classified data to compute a real number.
  OK = "OK",
  // No revenue in the period — contribution margin is undefined.
  NO_SALES = "NO_SALES",
  // No expense in the period has been classified FIXED yet.
  NO_FIXED_COSTS_CLASSIFIED = "NO_FIXED_COSTS_CLASSIFIED",
  // Planned mode only: nothing has been planned yet — no monthly pay rates
  // and no planned fixed costs entered.
  NO_PLANNED_FIXED_COSTS = "NO_PLANNED_FIXED_COSTS",
  // Revenue doesn't cover COGS + variable expenses — contribution margin
  // is zero or negative, so no break-even revenue exists (more sales alone
  // would never recover fixed costs at this margin).
  NEGATIVE_MARGIN = "NEGATIVE_MARGIN",
}

export const BREAK_EVEN_STATUS_LABELS_RU: Record<BreakEvenStatus, string> = {
  [BreakEvenStatus.OK]: "Рассчитано",
  [BreakEvenStatus.NO_SALES]: "Нет продаж за период",
  [BreakEvenStatus.NO_FIXED_COSTS_CLASSIFIED]: "Постоянные расходы не классифицированы",
  [BreakEvenStatus.NO_PLANNED_FIXED_COSTS]: "Плановые постоянные расходы не заданы",
  [BreakEvenStatus.NEGATIVE_MARGIN]: "Маржинальная прибыль отрицательна или нулевая",
};

export interface BreakEvenFixedCostLineDto {
  categoryId: string;
  categoryName: string;
  amount: number;
}

export interface BreakEvenDto {
  from: string;
  to: string;
  status: BreakEvenStatus;
  revenue: number;
  cogs: number;
  variableExpensesTotal: number;
  fixedExpensesTotal: number;
  // Expenses in the period whose category is still UNCLASSIFIED — surfaced
  // so the user knows the fixed/variable totals above are partial, not to
  // be silently folded into either side.
  unclassifiedExpensesTotal: number;
  contributionMargin: number;
  // Null only when revenue is zero (undefined ratio) — still computed (and
  // may be zero or negative) for NO_FIXED_COSTS_CLASSIFIED/NEGATIVE_MARGIN
  // so the number itself remains a useful diagnostic even when status isn't OK.
  contributionMarginPercent: number | null;
  breakEvenRevenue: number | null;
  fixedCostLines: BreakEvenFixedCostLineDto[];
}

// ── Planned fixed costs — the PLAN half of the plan/fact split ─────────
//
// A PlannedFixedCost states what a recurring cost is EXPECTED to be each
// month (rent, electricity, internet). It is never turned into an Expense
// or CashMovement — real money still moves only through Finance → Расходы.
// Planned and actual figures are reported separately and never summed.
//
// `amount` is always per-month, deliberately: every one of these costs is
// quoted monthly in practice, and a second period unit would only invite
// mismatched arithmetic.

export interface PlannedFixedCostDto {
  id: string;
  categoryId: string;
  categoryName: string;
  // Null = organization-wide ("Вся сеть").
  locationId: string | null;
  locationName: string | null;
  amount: number;
  effectiveFrom: string;
  // Null = this is the currently active planned amount.
  effectiveTo: string | null;
  createdByName: string;
  createdAt: string;
}

export interface CreatePlannedFixedCostRequestDto {
  categoryId: string;
  // Omit for an organization-wide cost.
  locationId?: string;
  amount: number;
  // Defaults to now if omitted.
  effectiveFrom?: string;
}

// Why an employee's pay rate could not be counted into the planned payroll
// total. Surfaced explicitly rather than silently dropping the person, so
// the planned figure never looks more complete than it is.
export enum PayrollExclusionReason {
  // Hourly/piece-rate: no hours or output volume is planned anywhere yet,
  // so any monthly figure would be invented rather than derived.
  NON_MONTHLY_RATE = "NON_MONTHLY_RATE",
  // Active employee who simply has no rate entered at all.
  NO_RATE_SET = "NO_RATE_SET",
}

export const PAYROLL_EXCLUSION_REASON_LABELS_RU: Record<PayrollExclusionReason, string> = {
  [PayrollExclusionReason.NON_MONTHLY_RATE]: "Не месячная ставка",
  [PayrollExclusionReason.NO_RATE_SET]: "Ставка не задана",
};

export interface PlannedPayrollExclusionDto {
  reason: PayrollExclusionReason;
  // Set only for NON_MONTHLY_RATE — which kind of rate it was.
  paymentType: CompensationType | null;
  employeeCount: number;
  // Names, so the owner can act on it instead of just seeing a count.
  employeeNames: string[];
}

// Planned monthly payroll, derived live from the currently active
// EmployeeCompensation rows of ACTIVE employees. Never stored.
export interface PlannedPayrollDto {
  // Sum of active MONTHLY rates only.
  total: number;
  includedEmployeeCount: number;
  // Everyone deliberately left out of `total`, with the reason why.
  exclusions: PlannedPayrollExclusionDto[];
}

// Planned-side break-even. Uses the SAME contribution-margin ratio the
// actual break-even computes from real sales (a ratio is scale-invariant,
// so it transfers honestly), but weighs it against PLANNED monthly fixed
// costs instead of the period's booked expenses.
//
// The answer is therefore always a MONTHLY revenue figure, regardless of
// which period is selected — pro-rating a month of rent down to a single
// day would be arithmetic that reads precise and means nothing.
export interface PlannedBreakEvenDto {
  // Period the margin ratio was measured over (not the planned costs).
  from: string;
  to: string;
  status: BreakEvenStatus;
  // Actuals, carried through purely as the margin input.
  revenue: number;
  cogs: number;
  variableExpensesTotal: number;
  contributionMargin: number;
  contributionMarginPercent: number | null;
  // The plan.
  payroll: PlannedPayrollDto;
  plannedOtherFixedTotal: number;
  // = payroll.total + plannedOtherFixedTotal
  plannedFixedTotal: number;
  plannedFixedCostLines: PlannedFixedCostDto[];
  // Monthly revenue needed to cover plannedFixedTotal at this margin.
  // Null whenever status !== OK.
  breakEvenRevenue: number | null;
}

// ── Owner dashboard — one endpoint powering the 10 at-a-glance cards ───

// ── Inventory valuation — stock on hand priced as an asset. RAW_MATERIAL
// uses Product.price (that IS cost for that type); FINISHED_GOOD never
// does (that's the sale price) — it goes through recipe/purchase cost,
// same resolution P&L COGS uses. See FinanceService.getInventoryValuation.

export interface InventoryValuationLineDto {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  unit: Unit;
  quantity: number;
  unitCost: number | null;
  value: number;
  hasCostData: boolean;
}

export interface InventoryValuationDto {
  totalValue: number;
  unknownValueLineItems: number;
  byProduct: InventoryValuationLineDto[];
}

// ── "Запуск финансового учёта" — one-time opening balance setup, run once
// per organization after adopting Finance on top of pre-existing
// stock/production/sales history. See Organization.financeInitializedAt.

export interface FinanceSetupStatusDto {
  initialized: boolean;
  initializedAt: string | null;
  initializedByName: string | null;
  // Always derived live from OPENING_BALANCE CashMovements — stable
  // forever once initialized, since accounts opened afterwards can no
  // longer use openingBalance (see CashAccountsService.create).
  cashValue: number;
  // Frozen (post-initialization) or live preview (pre-initialization) —
  // same shape either way so the wizard's review step and the permanent
  // record render identically.
  inventoryValue: number;
  inventoryUnknownValueLineItems: number;
  receivablesValue: number;
  payablesValue: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
}

export interface ReconcileInvoiceItemDto {
  invoiceId: string;
  amountPaid: number;
}

export interface ReconcileInvoicesRequestDto {
  items: ReconcileInvoiceItemDto[];
}

export interface FinanceDashboardDto {
  cashOnHand: number;
  bankBalance: number;
  cashRegisterBalance: number;
  todayInflow: number;
  todayOutflow: number;
  accountsReceivable: number;
  accountsPayable: number;
  grossProfit: number;
  operatingProfit: number;
  // Equals operatingProfit today — no loans/non-operating items exist yet
  // to make it diverge (see ProfitAndLossDto.operatingProfit).
  netProfit: number;
  period: { from: string; to: string };
}
