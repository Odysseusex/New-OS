import { PaymentStatus } from "./customers";
import { PaymentMethod } from "./finance";

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

export interface SaleDetailDto extends SaleDto {
  items: SaleItemDto[];
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
