import { Unit } from "./catalog";
import { CashMovementType, PaymentMethod } from "./finance";
import { StockMovementType } from "./inventory";

// «Сверка дня» — one location, one business day (Asia/Almaty): what the shelf and
// the till should hold according to the ledgers, against what was counted.
//
//   goods:  counted − (opening + received − sold + returned + other)   per product,
//           valued at the product's price
//   money:  counted − expected                                        per tender
//   result: money difference + goods difference
//
// A product missing from the shelf with the same money extra in the drawer nets to
// zero (sold without ringing it up, money still there); missing goods with no extra
// money is a real loss. The server sends the expected side once; this file holds the
// arithmetic so the screen recalculates as figures are typed, and the server stores
// the same summary when the worksheet is saved.

export interface ReconciliationStockLineDto {
  productId: string;
  productName: string;
  sku: string | null;
  unit: Unit;
  // Goods «под реализацию»: counted like any other, owed to their supplier.
  consignment: boolean;
  // The product's price — what a missing unit would have brought at the till.
  price: number;
  opening: number;
  // Receipts, transfers in, production output.
  received: number;
  sold: number;
  returned: number;
  // Net of write-offs, adjustments, transfers out, production consumption (signed).
  other: number;
  // opening + received − sold + returned + other
  closing: number;
  countedQuantity: number | null;
}

export interface ReconciliationTillMovementDto {
  type: CashMovementType;
  // Signed effect on the drawer.
  amount: number;
}

export interface ReconciliationMoneyDto {
  cashSales: number;
  cashRefunds: number;
  // Other movements of this location's till during the day (paid-out expenses,
  // withdrawals, deposits, debts repaid in cash…), grouped by type.
  tillMovements: ReconciliationTillMovementDto[];
  cardSales: number;
  cardRefunds: number;
  transferSales: number;
  transferRefunds: number;
  // Sold on credit: no money taken.
  onCredit: number;
}

export interface DailyReconciliationDto {
  locationId: string;
  locationName: string;
  // "YYYY-MM-DD", Almaty wall clock.
  date: string;
  dayStart: string;
  dayEnd: string;
  savedAt: string | null;
  savedByName: string | null;
  openingCash: number | null;
  countedCash: number | null;
  countedCard: number | null;
  countedTransfer: number | null;
  note: string | null;
  money: ReconciliationMoneyDto;
  lines: ReconciliationStockLineDto[];
}

export interface SaveDailyReconciliationRequestDto {
  locationId: string;
  date: string;
  openingCash?: number | null;
  countedCash?: number | null;
  countedCard?: number | null;
  countedTransfer?: number | null;
  note?: string | null;
  // Only counted products; a product left out is «not counted».
  lines: { productId: string; countedQuantity: number }[];
}

export interface ReconciliationHistoryItemDto {
  locationId: string;
  locationName: string;
  date: string;
  moneyDifference: number | null;
  goodsDifference: number | null;
  result: number | null;
  savedAt: string;
  savedByName: string;
}

// Everything that happened to one product at one location in one day, in order,
// with the balance after each step — to check a cashier's «система не даёт
// пробить» against what was actually received and rung up.
export interface ProductTrailRowDto {
  at: string;
  type: StockMovementType;
  // Signed effect on the shelf.
  change: number;
  balance: number;
  byName: string;
  reason: string | null;
  // For a sale: the whole check it was part of.
  sale: { total: number; paymentMethod: PaymentMethod; itemsCount: number } | null;
}

export interface ProductDayTrailDto {
  productId: string;
  productName: string;
  unit: Unit;
  date: string;
  opening: number;
  closing: number;
  rows: ProductTrailRowDto[];
}

export interface ReconciliationSummary {
  expectedCash: number;
  expectedCard: number;
  expectedTransfer: number;
  cashDifference: number | null;
  cardDifference: number | null;
  transferDifference: number | null;
  // Sum of the tenders that were counted; null when none was.
  moneyDifference: number | null;
  countedLines: number;
  totalLines: number;
  // Value of what is missing / extra on the shelf, both ≥ 0.
  shortageValue: number;
  surplusValue: number;
  // surplus − shortage; null when nothing was counted.
  goodsDifference: number | null;
  // money + goods; null when neither side was counted.
  result: number | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineDifference = (line: Pick<ReconciliationStockLineDto, "closing" | "countedQuantity">): number | null =>
  line.countedQuantity === null ? null : Math.round((line.countedQuantity - line.closing) * 1000) / 1000;

export function summarizeReconciliation(input: {
  money: ReconciliationMoneyDto;
  openingCash: number | null;
  countedCash: number | null;
  countedCard: number | null;
  countedTransfer: number | null;
  lines: Pick<ReconciliationStockLineDto, "closing" | "countedQuantity" | "price">[];
}): ReconciliationSummary {
  const { money } = input;
  const till = money.tillMovements.reduce((sum, m) => sum + m.amount, 0);
  const expectedCash = round2((input.openingCash ?? 0) + money.cashSales - money.cashRefunds + till);
  const expectedCard = round2(money.cardSales - money.cardRefunds);
  const expectedTransfer = round2(money.transferSales - money.transferRefunds);
  const diff = (counted: number | null, expected: number) => (counted === null ? null : round2(counted - expected));
  const cashDifference = diff(input.countedCash, expectedCash);
  const cardDifference = diff(input.countedCard, expectedCard);
  const transferDifference = diff(input.countedTransfer, expectedTransfer);
  const counted = [cashDifference, cardDifference, transferDifference].filter((d): d is number => d !== null);
  const moneyDifference = counted.length > 0 ? round2(counted.reduce((a, b) => a + b, 0)) : null;

  let shortageValue = 0;
  let surplusValue = 0;
  let countedLines = 0;
  for (const line of input.lines) {
    const d = lineDifference(line);
    if (d === null) continue;
    countedLines += 1;
    const value = d * line.price;
    if (value < 0) shortageValue -= value;
    else surplusValue += value;
  }
  shortageValue = round2(shortageValue);
  surplusValue = round2(surplusValue);
  const goodsDifference = countedLines > 0 ? round2(surplusValue - shortageValue) : null;
  const result = moneyDifference === null && goodsDifference === null ? null : round2((moneyDifference ?? 0) + (goodsDifference ?? 0));

  return {
    expectedCash,
    expectedCard,
    expectedTransfer,
    cashDifference,
    cardDifference,
    transferDifference,
    moneyDifference,
    countedLines,
    totalLines: input.lines.length,
    shortageValue,
    surplusValue,
    goodsDifference,
    result,
  };
}

// The tenders the worksheet counts; MIXED only ever describes a whole sale.
export const RECONCILIATION_TENDERS = [PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER] as const;
