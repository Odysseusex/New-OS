export enum FiscalReceiptStatus {
  PENDING = "PENDING",
  SENDING = "SENDING",
  REGISTERED = "REGISTERED",
  FAILED = "FAILED",
  UNKNOWN = "UNKNOWN",
}

export interface FiscalReceiptDto {
  id: string;
  saleId: string | null;
  status: FiscalReceiptStatus;
  ticketNumber: string | null;
  qrCode: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  registeredAt: string | null;
}

// One line per receipt the reconciliation pass touched, so the caller can
// show what changed rather than just a count.
export interface FiscalReconcileOutcomeDto {
  receiptId: string;
  saleId: string | null;
  before: FiscalReceiptStatus;
  after: FiscalReceiptStatus;
}

export interface FiscalReconcileResultDto {
  checked: number;
  resolved: number;
  outcomes: FiscalReconcileOutcomeDto[];
}

export interface FiscalShiftDto {
  shiftNumber: number | null;
  isOpen: boolean;
  openedAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
}

export interface FiscalStatusDto {
  // False while FISCALIZATION_ENABLED is off — the till sells without
  // punching receipts, which is the current production state.
  enabled: boolean;
  // Which operator is wired up: "rekassa" for real, "fake" for the local
  // stand-in whose receipts are not real.
  provider: string;
  // Null when the operator could not be reached, which is NOT the same as
  // "no shift open" and must be shown differently.
  shift: FiscalShiftDto | null;
  needsAttentionCount: number;
}
