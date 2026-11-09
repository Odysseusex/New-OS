// Кассовая смена (till shift), as in iiko Front: opened with the cash counted
// in the drawer, cash put in or taken out during it with a comment, X-отчёт any
// time, Z-отчёт at the close with the cash counted against what is expected.

export interface TillShiftTenderDto {
  // PaymentMethod: CASH / CARD / TRANSFER.
  method: string;
  sales: number;
  refunds: number;
  // Card only: the part the Kaspi terminal took by QR («в т.ч. Kaspi QR»).
  kaspiQr?: { sales: number; refunds: number };
}

export interface TillShiftCashMoveDto {
  at: string;
  // Positive = put into the drawer, negative = taken out.
  amount: number;
  comment: string | null;
  byName: string | null;
  // Where the money came from / went (the other account), or what it was (an expense paid from the till…).
  counterpart: string | null;
}

// X-отчёт / Z-отчёт: the shift's figures, read from the point's sales, returns
// and till movements inside the shift.
export interface TillShiftReportDto {
  // Set for the till's own staff (cashier, senior cashier): a blind count — every figure
  // that would tell them what the drawer should hold is null, and the cash line is left out.
  blind?: boolean;
  checks: number;
  returns: number;
  revenue: number | null;
  tenders: TillShiftTenderDto[];
  // Sold on credit (wholesale at the till), not money.
  onCredit: number;
  openingCash: number;
  cashSales: number | null;
  cashRefunds: number | null;
  // Every other movement of the till's cash in the shift: внесения, выемки, expenses paid from the till.
  cashMoves: TillShiftCashMoveDto[];
  cashMovesTotal: number;
  expectedCash: number | null;
}

export interface TillShiftDto {
  id: string;
  locationId: string;
  locationName: string;
  number: number;
  openedAt: string;
  openedByName: string;
  openingCash: number;
  // What the till's cash accounts held in the books at the opening (shown when it differs from the count).
  bookCashAtOpen: number | null;
  closedAt: string | null;
  closedByName: string | null;
  countedCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  note: string | null;
}

// The till's view of its point: the open shift (if any) with its live X-report,
// whether a shift is required to sell, and where a выемка/внесение can go.
export interface TillShiftStateDto {
  required: boolean;
  // A cashier removes a line / lowers a quantity only with a senior cashier's PIN.
  lineRemovalApproval: boolean;
  shift: TillShiftDto | null;
  report: TillShiftReportDto | null;
  // The point's cash account (the drawer); null = none, so no shift can be opened.
  // `balance` is null for the till's own staff (blind count).
  tillAccount: { id: string; name: string; balance: number | null } | null;
  otherAccounts: { id: string; name: string }[];
  nextNumber: number;
}

export interface TillShiftDetailDto extends TillShiftDto {
  report: TillShiftReportDto;
}

export interface OpenTillShiftRequestDto {
  locationId: string;
  openingCash: number;
}

export interface TillShiftCashRequestDto {
  // IN = внесение (from accountId into the drawer), OUT = выемка (from the drawer to accountId).
  direction: "IN" | "OUT";
  amount: number;
  accountId: string;
  comment: string;
}

export interface CloseTillShiftRequestDto {
  countedCash: number;
  note?: string;
}

// ── PIN and the senior cashier's approval (ТЗ §5.4) ──

export const TILL_PIN_PATTERN = /^\d{4,6}$/;

export type TillApprovalAction = "DISCOUNT" | "RETURN" | "LINE_REMOVAL" | "WELCOME_BONUS";

export const TILL_APPROVAL_ACTION_LABELS_RU: Record<TillApprovalAction, string> = {
  DISCOUNT: "Скидка на чек",
  RETURN: "Возврат",
  LINE_REMOVAL: "Удаление позиции из чека",
  WELCOME_BONUS: "Приветственный бонус",
};

export interface TillApprovalRequestDto {
  pin: string;
  action: TillApprovalAction;
  locationId?: string;
  // What is being approved, for the audit log: «Круассан × 2».
  detail?: string;
}

// A one-use-ish approval: valid for minutes, for this action, for the cashier who asked.
export interface TillApprovalDto {
  approvalToken: string;
  approverName: string;
}

export interface PinLoginRequestDto {
  pin: string;
}

export interface SetUserPinRequestDto {
  // null removes the PIN.
  pin: string | null;
}

// A discount on the whole check at the till: a percent or a sum (one of them).
export interface ManualDiscountDto {
  percent?: number;
  amount?: number;
}

// The discount in ₸ a manual discount asks for, on a base of `base` ₸ (never more than the base).
export function manualDiscountTarget(base: number, discount: ManualDiscountDto): number {
  const raw = discount.percent !== undefined ? (base * discount.percent) / 100 : (discount.amount ?? 0);
  return Math.max(0, Math.min(Math.floor(raw * 100 + 1e-6) / 100, base));
}
