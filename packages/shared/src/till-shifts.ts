// Кассовая смена (till shift), as in iiko Front: opened with the cash counted
// in the drawer, cash put in or taken out during it with a comment, X-отчёт any
// time, Z-отчёт at the close with the cash counted against what is expected.

export interface TillShiftTenderDto {
  // PaymentMethod: CASH / CARD / TRANSFER.
  method: string;
  sales: number;
  refunds: number;
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
  checks: number;
  returns: number;
  revenue: number;
  tenders: TillShiftTenderDto[];
  // Sold on credit (wholesale at the till), not money.
  onCredit: number;
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  // Every other movement of the till's cash in the shift: внесения, выемки, expenses paid from the till.
  cashMoves: TillShiftCashMoveDto[];
  cashMovesTotal: number;
  expectedCash: number;
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
  bookCashAtOpen: number;
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
  shift: TillShiftDto | null;
  report: TillShiftReportDto | null;
  // The point's cash account (the drawer); null = none, so no shift can be opened.
  tillAccount: { id: string; name: string; balance: number } | null;
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
