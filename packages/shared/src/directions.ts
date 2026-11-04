import type { NetProfitStatus } from "./finance";

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

// The base the costs no direction owns are shared by (the ТЗ's three choices).
export enum DirectionAllocationBase {
  REVENUE = "REVENUE",
  GROSS_PROFIT = "GROSS_PROFIT",
  MANUAL = "MANUAL",
}

export const DIRECTION_ALLOCATION_BASE_LABELS_RU: Record<DirectionAllocationBase, string> = {
  [DirectionAllocationBase.REVENUE]: "Пропорционально выручке",
  [DirectionAllocationBase.GROSS_PROFIT]: "Пропорционально валовой прибыли",
  [DirectionAllocationBase.MANUAL]: "Вручную, %",
};

export interface DirectionAllocationDto {
  base: DirectionAllocationBase;
  // Percentages per direction for MANUAL (sum 100); null otherwise.
  shares: Record<BusinessDirection, number> | null;
}

// Checks manual percentages: each 0..100, together exactly 100 (to 0.01).
export function directionSharesError(shares: Partial<Record<BusinessDirection, number>> | null | undefined): string | null {
  if (!shares) return "Укажите проценты по направлениям";
  let sum = 0;
  for (const d of BUSINESS_DIRECTION_ORDER) {
    const v = shares[d] ?? 0;
    if (!Number.isFinite(v) || v < 0 || v > 100) return "Процент — от 0 до 100";
    sum += v;
  }
  return Math.abs(sum - 100) > 0.005 ? `Сумма процентов должна быть 100, сейчас ${Math.round(sum * 100) / 100}` : null;
}

// One direction's P&L. Выручка and себестоимость are its own, and so is an
// expense booked to it (Expense.direction); everything the business spends in
// common (inventory losses, other operating expenses, depreciation, the other
// result and the recorded income tax) is allocated by the chosen base.
export interface DirectionPnlRowDto {
  direction: BusinessDirection;
  checks: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  // Share of the organization's net revenue, 0..100 (null when it is ≤ 0).
  revenueSharePercent: number | null;
  // Share of the common costs this direction carries under the chosen base (null = nothing shared).
  allocationSharePercent: number | null;
  // Gross profit less what is booked to the direction itself (its own expenses and other result).
  profitBeforeAllocation: number;
  // Its part of the common costs (losses, common expenses, depreciation, common other result, tax).
  allocatedCosts: number;
  inventoryLosses: number;
  expenses: number;
  // Part of `expenses` booked to this direction wholly (the rest is its share of common ones).
  directExpenses: number;
  // Operating profit before depreciation.
  ebitda: number;
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
  total: Omit<DirectionPnlRowDto, "direction" | "checks" | "revenueSharePercent" | "allocationSharePercent"> & { checks: number };
  allocation: DirectionAllocationDto;
  // False when the chosen base is not positive for any direction (no revenue, no
  // gross profit): common costs then stay with the total only.
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
