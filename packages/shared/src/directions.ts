import { NetProfitStatus } from "./finance";

// Business directions (направления бизнеса), told apart by the sale itself:
// paid for a cake order (CRM) → «Заказы»; to a wholesale customer → «Опт»;
// anything else at a till → «Розница».
export enum BusinessDirection {
  WHOLESALE = "WHOLESALE",
  RETAIL = "RETAIL",
  ORDERS = "ORDERS",
}

export const BUSINESS_DIRECTION_LABELS_RU: Record<BusinessDirection, string> = {
  [BusinessDirection.WHOLESALE]: "Опт",
  [BusinessDirection.RETAIL]: "Розница",
  [BusinessDirection.ORDERS]: "Заказы",
};

export const BUSINESS_DIRECTION_ORDER: BusinessDirection[] = [
  BusinessDirection.WHOLESALE,
  BusinessDirection.RETAIL,
  BusinessDirection.ORDERS,
];

export function businessDirectionOf(sale: { crmOrderId?: string | null; customerId?: string | null }): BusinessDirection {
  if (sale.crmOrderId) return BusinessDirection.ORDERS;
  if (sale.customerId) return BusinessDirection.WHOLESALE;
  return BusinessDirection.RETAIL;
}

// One direction's P&L. Выручка and себестоимость are its own; everything the
// business spends in common (inventory losses, operating expenses,
// depreciation, the other result and the recorded income tax) is allocated by
// its share of net revenue.
export interface DirectionPnlRowDto {
  direction: BusinessDirection;
  checks: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  // Share of the organization's net revenue, 0..100 (null when it is ≤ 0).
  revenueSharePercent: number | null;
  inventoryLosses: number;
  expenses: number;
  depreciation: number;
  operatingProfit: number;
  otherResult: number;
  incomeTax: number | null;
  netProfit: number;
}

export interface DirectionPnlDto {
  from: string;
  to: string;
  rows: DirectionPnlRowDto[];
  // The same figures for the whole business (equal to the P&L of the period).
  total: Omit<DirectionPnlRowDto, "direction" | "checks" | "revenueSharePercent"> & { checks: number };
  // False when the period's net revenue is not positive: common costs then have
  // no base to be shared by and stay with the total only.
  allocated: boolean;
  netProfitStatus: NetProfitStatus;
}

// Open cake orders the till can attach a sale to.
export interface OpenCrmOrderDto {
  id: string;
  number: number;
  title: string;
  customerName: string;
  dueAt: string;
  price: number | null;
}
