// Производство → «Распределение»: the day's output shared out to points (transfers) and wholesale customers
// (sales on account) from one grid, prefilled from each one's «постоянный заказ».

export interface StandingOrderLineDto {
  customerId: string | null;
  locationId: string | null;
  productId: string;
  quantity: number;
  // Agreed wholesale price (customers only); null = the product's price.
  unitPrice: number | null;
}

// Replaces the whole standing order of ONE target (exactly one of customerId / locationId).
export interface SaveStandingOrderRequestDto {
  customerId?: string;
  locationId?: string;
  lines: { productId: string; quantity: number; unitPrice?: number | null }[];
}

export const STANDING_ORDER_MAX_LINES = 300;
