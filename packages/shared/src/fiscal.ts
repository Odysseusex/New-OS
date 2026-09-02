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
