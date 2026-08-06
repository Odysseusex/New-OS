import { PaymentStatus } from "./customers";
import { Unit } from "./catalog";

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

export interface FinanceCategoryDto {
  id: string;
  name: string;
  kind: FinanceCategoryKind;
  isActive: boolean;
}

export interface CreateFinanceCategoryRequestDto {
  name: string;
  kind: FinanceCategoryKind;
}

export interface UpdateFinanceCategoryRequestDto {
  name: string;
}

// ── Cash movements — the single append-only money ledger, the direct
// counterpart of StockMovement. Never edited/deleted; corrections are a new
// ADJUSTMENT row referencing the one it corrects. ──────────────────────

export enum CashMovementType {
  OPENING_BALANCE = "OPENING_BALANCE",
  SALE_RECEIPT = "SALE_RECEIPT",
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
