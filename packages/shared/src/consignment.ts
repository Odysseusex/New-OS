// Расчёты по товарам, взятым под реализацию.
//
// The shop sells goods that belong to someone else (the village store) and
// owes them per unit SOLD, not per unit delivered. Everything here is a
// running balance — sold, minus returned, minus already paid — rather than
// periodic settlement acts, so there are no periods to define, none to
// overlap, and no way for a late return to land outside its window.

// One supplier's standing balance.
export interface ConsignmentBalanceDto {
  supplierId: string;
  supplierName: string;
  // Everything ever sold of this supplier's goods, at the price snapshotted
  // on each sale line.
  soldAmount: number;
  // Everything handed back by buyers, cancelling the debt those sales made.
  returnedAmount: number;
  paidAmount: number;
  // soldAmount − returnedAmount − paidAmount. Negative means we have paid
  // ahead — an overpayment, not an error, but worth seeing.
  balance: number;
  // Units sold minus units returned, for a sanity check against the goods
  // physically on the shelf.
  quantitySold: number;
  lastPaidAt: string | null;
}

// One product line behind a supplier's balance, so the owner can check the
// total against something concrete rather than trusting a single number.
export interface ConsignmentProductRowDto {
  productId: string;
  productName: string;
  unitCost: number;
  quantitySold: number;
  quantityReturned: number;
  amount: number;
}

export interface ConsignmentPaymentDto {
  id: string;
  amount: number;
  paidAt: string;
  note: string | null;
  createdByName: string;
}

export interface ConsignmentDetailDto extends ConsignmentBalanceDto {
  // Grouped by product AND by the price it sold at: the same product sold
  // before and after a price change is two rows, because that is genuinely
  // two different debts.
  rows: ConsignmentProductRowDto[];
  payments: ConsignmentPaymentDto[];
}

export interface CreateConsignmentPaymentRequestDto {
  supplierId: string;
  amount: number;
  // Which account the money leaves. Omit to use the organization's default
  // bank account.
  accountId?: string;
  note?: string;
}
