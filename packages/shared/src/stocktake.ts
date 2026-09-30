import { Unit } from "./catalog";

export enum StocktakeStatus {
  COUNTING = "COUNTING",
  REVIEW = "REVIEW",
  APPROVED = "APPROVED",
  CANCELLED = "CANCELLED",
}

export const STOCKTAKE_STATUS_LABELS_RU: Record<StocktakeStatus, string> = {
  [StocktakeStatus.COUNTING]: "Подсчёт",
  [StocktakeStatus.REVIEW]: "На проверке",
  [StocktakeStatus.APPROVED]: "Проведена",
  [StocktakeStatus.CANCELLED]: "Отменена",
};

export interface StocktakeLineDto {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: Unit;
  categoryName: string | null;
  systemQuantity: number;
  countedQuantity: number | null;
  // countedQuantity − systemQuantity; null while not counted.
  difference: number | null;
  // Current unit cost from the costing service (null = no cost data); the
  // value is indicative until approval fixes it on the adjustment movement.
  unitCost: number | null;
  differenceValue: number | null;
  note: string | null;
  movementId: string | null;
}

export interface StocktakeSummaryDto {
  id: string;
  locationId: string;
  locationName: string;
  status: StocktakeStatus;
  note: string | null;
  snapshotAt: string;
  createdByName: string;
  approvedAt: string | null;
  approvedByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lineCount: number;
  countedCount: number;
}

export interface StocktakeDto extends StocktakeSummaryDto {
  lines: StocktakeLineDto[];
  shortageValue: number;
  surplusValue: number;
  // Lines whose snapshot disagreed with the movement ledger at creation —
  // the count does not hide it; the integrity diagnostic keeps reporting it.
  snapshotDriftCount: number;
}

export interface CreateStocktakeRequestDto {
  locationId: string;
  categoryId?: string;
  note?: string;
}

export interface UpdateStocktakeLineRequestDto {
  countedQuantity: number | null;
  note?: string | null;
}

export interface CancelStocktakeRequestDto {
  reason: string;
}
