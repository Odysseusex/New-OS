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
  soldAt: string;
  totalAmount: number;
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
  items: CreateSaleItemRequestDto[];
}

export interface SalesSummaryDto {
  todayRevenue: number;
  todaySalesCount: number;
  last7DaysRevenue: number;
  averageTicket: number;
}
