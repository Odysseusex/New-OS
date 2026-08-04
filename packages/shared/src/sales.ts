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
