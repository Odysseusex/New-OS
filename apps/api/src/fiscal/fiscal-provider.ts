// The boundary between ArAmir OS and whichever fiscal operator is in use.
//
// Everything here is expressed in OUR terms — plain tenge, plain quantities,
// our own payment methods. No re:Kassa field names, no bills/coins, no
// thousandths. Swapping provider (or moving from their test server to the
// live one) must not reach past this file.
//
// What an interface CANNOT abstract away is capability: the retry design in
// FiscalReceiptStatus assumes the provider supports an idempotency key and
// treats a repeat of it as the same request. re:Kassa does (X-Request-ID).
// A provider that did not would need the state machine rethought, not just a
// new adapter.

export interface FiscalReceiptLine {
  name: string;
  quantity: number;
  // Per-unit price in tenge.
  unitPrice: number;
  // Line total in tenge. Passed explicitly rather than multiplied here so the
  // figure on the fiscal receipt is always the one the sale actually charged,
  // including any rounding already applied to it.
  total: number;
  // NTIN from Kazakhstan's National Catalogue of Goods (НКТ). Legally
  // required per line since
  // 01.01.2026, hence not optional at this boundary — the caller must refuse
  // to fiscalise a product that lacks one rather than send a blank.
  ntin: string;
  // Unit code from the fiscal classifier (796 = piece, and so on).
  measureUnitCode: string;
}

export type FiscalPaymentType = "CASH" | "CARD" | "MOBILE";

export interface FiscalSaleRequest {
  // Our idempotency key. The SAME value must be reused for every retry of
  // this sale — that is what makes a retry safe after a timeout.
  externalId: string;
  lines: FiscalReceiptLine[];
  payments: { type: FiscalPaymentType; amount: number }[];
  // Total in tenge, and what the customer handed over (equal for card).
  total: number;
  taken: number;
  change: number;
  occurredAt: Date;
  // Coordinates of the till. Mandatory since protocol 2.0.3.
  latitude: number;
  longitude: number;
}

// What a return receipt must quote about the sale it reverses. re:Kassa
// rejects the return outright without all of it — established against their
// sandbox, which answered an empty parentTicket by listing exactly these
// required fields. The cash register's own KGD id is deliberately absent:
// it belongs to the till, not to the receipt, so the provider supplies it.
export interface FiscalParentReceipt {
  ticketNumber: string;
  occurredAt: Date;
  total: number;
  isOffline: boolean;
}

export interface FiscalReturnRequest extends FiscalSaleRequest {
  parent: FiscalParentReceipt;
}

export interface FiscalSaleResult {
  providerTicketId: string;
  // Null while the receipt is still only registered offline — the offline
  // number is then the one that identifies it.
  ticketNumber: string | null;
  offlineTicketNumber: string | null;
  isOffline: boolean;
  qrCode: string | null;
  kgdKkmId: string | null;
  shiftNumber: number | null;
  // Kept whole: a return receipt has to quote the original back, and a
  // fiscal answer is evidence worth preserving verbatim.
  raw: unknown;
}

// Distinguishes the three outcomes that must be handled differently.
//   ok       — registered.
//   rejected — the provider said no, for a stated reason. Safe to fix and
//              retry with the same externalId.
//   unknown  — timeout or dropped connection. We do NOT know whether a
//              receipt exists; must be resolved before any retry.
export type FiscalSaleOutcome =
  | { kind: "ok"; result: FiscalSaleResult }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "unknown"; message: string };

// A fiscal shift (смена). The operator opens one on its own with the first
// receipt of the day and caps it at 24 hours; what a receipt punched into an
// expired shift does is not established, so the expiry is surfaced rather
// than waited on.
export interface FiscalShiftState {
  shiftNumber: number | null;
  isOpen: boolean;
  openedAt: Date | null;
  expiresAt: Date | null;
  isExpired: boolean;
}

export interface FiscalProvider {
  readonly name: string;
  // True once the provider has everything it needs to be called at all
  // (credentials configured). Lets the app run normally with fiscalisation
  // switched off, which is the current state.
  isConfigured(): boolean;
  registerSale(request: FiscalSaleRequest): Promise<FiscalSaleOutcome>;
  // Same three outcomes and the same idempotency contract as a sale — a
  // return that times out must never be blind-retried into a second refund.
  registerReturn(request: FiscalReturnRequest): Promise<FiscalSaleOutcome>;
  // Null when the state could not be read — a shift we cannot see is not the
  // same as a shift that is fine, and the caller has to tell them apart.
  getShiftState(): Promise<FiscalShiftState | null>;
}

// Injection token — NestJS cannot inject a TypeScript interface.
export const FISCAL_PROVIDER = Symbol("FISCAL_PROVIDER");
