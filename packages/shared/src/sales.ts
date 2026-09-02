import { Unit } from "./catalog";
import { PaymentStatus } from "./customers";
import { PaymentMethod } from "./finance";
import { FiscalReceiptStatus } from "./fiscal";

export interface SaleItemDto {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
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

export interface SaleDetailDto extends SaleDto {
  items: SaleItemDto[];
  // Null when the sale was made with fiscalisation switched off — which is
  // every sale so far.
  fiscalReceipt: SaleFiscalReceiptDto | null;
}

export interface CreateSaleItemRequestDto {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateSaleRequestDto {
  locationId?: string;
  customerId?: string;
  amountPaid?: number;
  paymentMethod?: PaymentMethod;
  items: CreateSaleItemRequestDto[];
}

export interface SalesSummaryDto {
  todayRevenue: number;
  todaySalesCount: number;
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
}

export interface SalesReportDto {
  from: string;
  to: string;
  totalRevenue: number;
  totalCount: number;
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
