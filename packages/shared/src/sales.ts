import { Unit } from "./catalog";
import { PaymentStatus } from "./customers";
import { PaymentMethod } from "./finance";
import { FiscalReceiptStatus } from "./fiscal";

// The one markdown this business uses: stale goods, after 18:00 and again
// the next day, go for half price. A single constant rather than a setting
// screen — there is exactly one rate, and changing it is a one-line edit.
export const MARKDOWN_PERCENT = 50;

// Whole tenge: the till's keypad has no decimal key, and asking a cashier
// for 172.5 ₸ at a bread counter is not a real thing.
export function markdownPrice(fullPrice: number): number {
  return Math.round((fullPrice * (100 - MARKDOWN_PERCENT)) / 100);
}

export interface SaleItemDto {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  // What the buyer actually paid per unit — already discounted when the line
  // was marked down.
  unitPrice: number;
  // The price before the markdown; null when sold at full price. The money
  // given away is (fullUnitPrice − unitPrice) × quantity.
  fullUnitPrice: number | null;
  subtotal: number;
}

export interface SaleDto {
  id: string;
  locationId: string;
  locationName: string;
  customerId: string | null;
  customerName: string | null;
  soldAt: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  itemsCount: number;
  createdByName: string;
}

// What the cashier needs to see about the fiscal side of a sale: the number
// the buyer can check the receipt by, and the QR that checks it for them.
export interface SaleFiscalReceiptDto {
  status: FiscalReceiptStatus;
  // The fiscal number. Null while a receipt exists but isn't registered.
  ticketNumber: string | null;
  // Null unless the operator returned one — offline receipts often don't.
  qrCode: string | null;
  // Registered by the till without reaching the operator yet. The receipt is
  // valid, but the buyer's check will only work once it syncs.
  isOffline: boolean;
}

// One tender of a split sale. `method` is never MIXED — that value describes
// the sale, not a payment.
export interface SalePaymentDto {
  method: PaymentMethod;
  amount: number;
}

// What the Kaspi payment terminal returned for the card half of a sale.
// Null whenever no terminal was involved: cash, a card typed on the terminal
// by hand, or any sale from before the terminal was connected.
export interface SaleTerminalPaymentDto {
  // "qr", "card" or "alaqan". A refund has to go back the same way.
  method: string;
  // What a refund quotes — the order number for QR, the RRN for a card.
  transactionId: string;
  cardMask: string | null;
}

export interface SaleDetailDto extends SaleDto {
  items: SaleItemDto[];
  // Present only when the card half went through the Kaspi terminal.
  terminalPayment: SaleTerminalPaymentDto | null;
  // Empty for an ordinary single-method sale — `paymentMethod` says it all
  // there. Populated only when the sale was split.
  payments: SalePaymentDto[];
  // Null when the sale was made with fiscalisation switched off — which is
  // every sale so far.
  fiscalReceipt: SaleFiscalReceiptDto | null;
}

export interface CreateSaleItemRequestDto {
  productId: string;
  quantity: number;
  // The price actually charged, markdown already applied.
  unitPrice: number;
  // Sent only for a marked-down line: the price it would have gone for.
  // Must be greater than unitPrice — the server rejects anything else, since
  // a "discount" that raised the price is a bug, not a discount.
  fullUnitPrice?: number;
}

export interface CreateSalePaymentRequestDto {
  method: PaymentMethod;
  amount: number;
}

// Sent by the till when the card half was taken on the Kaspi terminal. The
// payment has already happened by then — the terminal is the authority on
// that — so this is the till reporting a fact, not asking for one.
export interface CreateSaleTerminalPaymentRequestDto {
  method: string;
  transactionId: string;
  cardMask?: string;
}

export interface CreateSaleRequestDto {
  locationId?: string;
  terminalPayment?: CreateSaleTerminalPaymentRequestDto;
  customerId?: string;
  amountPaid?: number;
  paymentMethod?: PaymentMethod;
  // A split payment: two or more tenders that must add up to the sale total.
  // Omit it for an ordinary sale and `paymentMethod` decides everything, as
  // before — every existing caller keeps working untouched.
  payments?: CreateSalePaymentRequestDto[];
  items: CreateSaleItemRequestDto[];
}

// One tender's share of what was taken today. `method` is never MIXED — a
// split sale is counted under each of its own methods, which is the whole
// point of the breakdown.
export interface SalesTakingsRowDto {
  method: PaymentMethod;
  amount: number;
}

export interface SalesSummaryDto {
  todayRevenue: number;
  todaySalesCount: number;
  // What was actually handed over today, split by tender — the figure a
  // cashier counts the drawer against. Different from todayRevenue whenever
  // a sale went out on credit; the gap is todayUnpaid.
  todayTakings: SalesTakingsRowDto[];
  // Refunds paid out today, as a positive number. Not split by tender: a
  // refund follows its original sale's method, and a mixed sale has no single
  // one to follow.
  todayRefunds: number;
  // Sold today but not paid for — the part of todayRevenue that is a debt
  // rather than money in hand.
  todayUnpaid: number;
  last7DaysRevenue: number;
  averageTicket: number;
}

export interface SalesByLocationDto {
  locationId: string;
  locationName: string;
  revenue: number;
  count: number;
}

export interface SalesByProductDto {
  productId: string;
  productName: string;
  quantity: number;
  revenue: number;
  // Of `quantity`, how many units went at the markdown price, and how much
  // money that cost. Zero for a product never marked down.
  markdownQuantity: number;
  markdownLoss: number;
}

export interface SalesReportDto {
  from: string;
  to: string;
  totalRevenue: number;
  totalCount: number;
  // Money given away on stale goods over the period, and the units it went
  // on. This is really a measure of overproduction: a product that is
  // reliably marked down is a product being baked in the wrong quantity.
  markdownLoss: number;
  markdownQuantity: number;
  byLocation: SalesByLocationDto[];
  byProduct: SalesByProductDto[];
}

// ── Demand analysis — average sales volume by product/customer ─────────
//
// "Продажа" here means the same thing SalesService.create() already means:
// a Sale row exists, full stop. Payment status never affects these
// numbers — a sale on credit still counts as sold, same as everywhere else
// in the app.
//
// avgPerDay divides by COMPLETED calendar days in [from, to], not by the
// raw span — if the period's last day is today, today is excluded from the
// denominator (but its quantity still counts in `quantity`), since an
// in-progress day would otherwise silently drag the average down. See
// SalesService.demandAnalysis for the exact rule. Null whenever there are
// zero completed days (e.g. a period consisting only of today) or zero
// matching sales — never a fabricated number.
export interface SalesDemandRowBase {
  quantity: number;
  // Distinct sales containing this row's product (or, for a byCustomer row,
  // this customer's sales matching the active product/category filter) —
  // never the count of line items, so a product appearing twice in one sale
  // still counts as one sale.
  salesCount: number;
  avgPerDay: number | null;
  avgPerSale: number | null;
  revenue: number;
}

export interface SalesDemandByProductRowDto extends SalesDemandRowBase {
  productId: string;
  productName: string;
}

export interface SalesDemandByCustomerRowDto extends SalesDemandRowBase {
  // Null = walk-in retail sales with no linked Customer ("Розница").
  customerId: string | null;
  customerName: string;
}

export interface SalesDemandSummaryDto extends SalesDemandRowBase {
  avgRevenuePerDay: number | null;
}

export interface SalesDemandAnalysisDto {
  from: string;
  to: string;
  // Denominator behind every avgPerDay figure in this response.
  completedDays: number;
  summary: SalesDemandSummaryDto;
  // Breakdown by product — meaningful whenever no single productId filter
  // is active (i.e. "Все товары" or a category rollup).
  byProduct: SalesDemandByProductRowDto[];
  // Breakdown by customer — meaningful whenever no single customerId filter
  // is active (i.e. "Все клиенты").
  byCustomer: SalesDemandByCustomerRowDto[];
}

// ---- Динамика продаж по клиенту ---------------------------------------------

// One calendar day of shipments to a single customer. Days with no sales are
// still present with zeros — a gap in the series would read as "no data" on a
// chart when it actually means "ничего не отгружали".
export interface SalesCustomerTrendPointDto {
  // Calendar date in the reporting time zone, YYYY-MM-DD.
  date: string;
  quantity: number;
  revenue: number;
  salesCount: number;
}

// Best/worst are picked among days that actually had a shipment. Including
// the zero-filled days would make "худший день" almost always a 0 — true but
// useless, and the zeros are already visible on the chart itself.
export interface SalesCustomerTrendExtremeDto {
  date: string;
  quantity: number;
  revenue: number;
}

// The immediately preceding window of the same length. deltaPct is null when
// the previous window has no baseline to divide by (see deltaPct()).
export interface SalesCustomerTrendComparisonDto {
  from: string;
  to: string;
  quantity: number;
  revenue: number;
  quantityDeltaPct: number | null;
  revenueDeltaPct: number | null;
}

export interface SalesCustomerTrendDto {
  customerId: string;
  customerName: string;
  from: string;
  to: string;
  // IANA zone the calendar days are bucketed by — the server runs in UTC, so
  // without this the day boundaries would not match the owner's own day.
  timeZone: string;
  points: SalesCustomerTrendPointDto[];
  totalQuantity: number;
  totalRevenue: number;
  salesCount: number;
  // Denominator behind both averages: days in the range, excluding today when
  // the range reaches it (same rule as SalesService.demandAnalysis).
  completedDays: number;
  avgQuantityPerDay: number | null;
  avgRevenuePerDay: number | null;
  bestDay: SalesCustomerTrendExtremeDto | null;
  worstDay: SalesCustomerTrendExtremeDto | null;
  // Distinct units across everything shipped in the range. More than one
  // means totalQuantity adds up different units (шт + кг) and the "Шт."
  // metric must be shown with a warning — revenue is always sound.
  units: Unit[];
  previous: SalesCustomerTrendComparisonDto;
}

export interface SaleReturnItemDto {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface SaleReturnDto {
  id: string;
  saleId: string;
  locationId: string;
  locationName: string;
  returnedAt: string;
  totalAmount: number;
  reason: string | null;
  // False when the goods were written off instead of going back on the shelf.
  restocked: boolean;
  createdByName: string;
  items: SaleReturnItemDto[];
  fiscalReceipt: SaleFiscalReceiptDto | null;
}

export interface CreateSaleReturnItemRequestDto {
  productId: string;
  quantity: number;
}

export interface CreateSaleReturnRequestDto {
  // Only the lines actually coming back, with their own quantities — a buyer
  // returning one loaf out of three is the normal case.
  items: CreateSaleReturnItemRequestDto[];
  reason?: string;
  restocked?: boolean;
}

// ── Product profitability and ABC analysis ────────────────────────────
//
// What the sales report never answered: which products actually EARN. It
// reports revenue per product, and revenue is not profit — a cake with the
// biggest turnover can be the one carrying the thinnest margin.
//
// Cost comes from the same place P&L takes it: the product's техкарта
// (recipe) first, weighted-average actual purchase price second. A product
// with neither is reported with hasCostData=false and left OUT of every
// total rather than being guessed at, exactly as the P&L does — a made-up
// cost would quietly poison the margin of the whole period.
export interface ProductProfitabilityRowDto {
  productId: string;
  productName: string;
  quantity: number;
  revenue: number;
  // Себестоимость проданного: unit cost × quantity sold.
  cost: number;
  // Маржинальная прибыль — revenue minus the cost of what was sold.
  margin: number;
  // Маржинальность, % of revenue. Null when revenue is zero (undefined
  // ratio), which happens for a product given away at a 100% markdown.
  marginPercent: number | null;
  // Share of the period's total revenue and total margin, in percent. The
  // two differ, and the gap between them is the point of this whole report.
  revenueShare: number;
  marginShare: number;
  // ABC class by contribution to MARGIN, not revenue: A = the products
  // making the first 80% of the money, B = the next 15%, C = the last 5%.
  // Ranked on margin because ranking on revenue is what hides a
  // high-turnover, low-margin product in class A. The product that carries
  // the running total past 80% is itself still an A.
  abcClass: "A" | "B" | "C" | null;
  // False when the product has no recipe and no purchase history. Its
  // revenue is still shown, but cost/margin are zero and it is excluded
  // from the totals and from ABC ranking.
  hasCostData: boolean;
  // Of `quantity`, how many units went at the markdown price. A product
  // reliably marked down is being baked in the wrong quantity, and that
  // shows up here as margin lost rather than only as units.
  markdownQuantity: number;
  markdownLoss: number;
}

export interface ProductProfitabilityDto {
  from: string;
  to: string;
  // Totals over products WITH cost data only — see hasCostData above.
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  totalMarginPercent: number | null;
  // Revenue of products with no cost data, excluded from the totals above.
  // Surfaced rather than hidden: it says how much of the period the margin
  // figure actually covers.
  revenueWithoutCostData: number;
  productsWithoutCostData: number;
  rows: ProductProfitabilityRowDto[];
}

// ── Sales dynamics: day by day, by hour, by weekday ───────────────────
//
// Bucketed on a wall clock in Asia/Almaty, never the server's UTC — a loaf
// sold at 9pm Almaty is not tomorrow's sale.
export interface SalesDynamicsPointDto {
  // "YYYY-MM-DD" in the reporting time zone.
  date: string;
  revenue: number;
  salesCount: number;
  // Null on a day with no sales — an average of nothing is not zero.
  averageTicket: number | null;
}

export interface SalesHourBucketDto {
  // 0–23, wall clock in the reporting time zone.
  hour: number;
  revenue: number;
  salesCount: number;
}

export interface SalesWeekdayBucketDto {
  // 1 = Monday … 7 = Sunday. ISO order, so the week reads Mon→Sun as it does
  // on every Russian calendar, rather than starting on Sunday.
  weekday: number;
  revenue: number;
  salesCount: number;
  // Sales spread over however many of this weekday fell in the period, so a
  // period containing five Mondays and four Tuesdays compares fairly.
  occurrences: number;
  averageRevenue: number | null;
}

export interface SalesDynamicsDto {
  from: string;
  to: string;
  timeZone: string;
  // One point per calendar day in range, zero-filled — a gap in a time series
  // reads as "no data" when it should read as "genuinely zero".
  points: SalesDynamicsPointDto[];
  totalRevenue: number;
  totalSalesCount: number;
  averageTicket: number | null;
  // Days excluding today, since today is still in progress and would drag
  // every average down. Same rule as the demand and customer-trend reports.
  completedDays: number;
  averageRevenuePerDay: number | null;
  bestDay: SalesDynamicsPointDto | null;
  worstDay: SalesDynamicsPointDto | null;
  byHour: SalesHourBucketDto[];
  byWeekday: SalesWeekdayBucketDto[];
  // The same span immediately before this one, for a like-for-like delta.
  previous: {
    from: string;
    to: string;
    revenue: number;
    salesCount: number;
    revenueDeltaPct: number | null;
    salesCountDeltaPct: number | null;
  };
}
