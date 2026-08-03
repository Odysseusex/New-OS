import { Unit } from "./catalog";

export enum StockMovementType {
  RECEIPT = "RECEIPT",
  SALE = "SALE",
  WRITE_OFF = "WRITE_OFF",
  ADJUSTMENT = "ADJUSTMENT",
  PRODUCTION_CONSUMPTION = "PRODUCTION_CONSUMPTION",
  PRODUCTION_OUTPUT = "PRODUCTION_OUTPUT",
}

export const STOCK_MOVEMENT_TYPE_LABELS_RU: Record<StockMovementType, string> = {
  [StockMovementType.RECEIPT]: "Приёмка",
  [StockMovementType.SALE]: "Продажа",
  [StockMovementType.WRITE_OFF]: "Списание",
  [StockMovementType.ADJUSTMENT]: "Корректировка",
  [StockMovementType.PRODUCTION_CONSUMPTION]: "Расход на производство",
  [StockMovementType.PRODUCTION_OUTPUT]: "Выпуск продукции",
};

// Categorizes a write-off so losses can be reported by cause rather than as
// one undifferentiated bucket.
export enum WriteOffReason {
  EXPIRED = "EXPIRED",
  DAMAGED = "DAMAGED",
  PRODUCTION_DEFECT = "PRODUCTION_DEFECT",
  QUALITY_ISSUE = "QUALITY_ISSUE",
  OTHER = "OTHER",
}

export const WRITE_OFF_REASON_LABELS_RU: Record<WriteOffReason, string> = {
  [WriteOffReason.EXPIRED]: "Истёк срок годности",
  [WriteOffReason.DAMAGED]: "Повреждено при хранении/транспортировке",
  [WriteOffReason.PRODUCTION_DEFECT]: "Брак производства",
  [WriteOffReason.QUALITY_ISSUE]: "Не соответствует стандартам качества",
  [WriteOffReason.OTHER]: "Другое",
};

export interface StockLevelDto {
  id: string;
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  sku: string;
  unit: Unit;
  categoryName: string | null;
  quantity: number;
  minQuantity: number;
  isLow: boolean;
}

// The one definition of "low stock" — used by InventoryService (isLow on
// each StockLevelDto), NotificationsService (via that same field) and
// LocationsService's per-location low-stock counts, so all three can never
// drift apart. minQuantity = 0 means "no threshold set" and must never
// count as low, even once quantity itself reaches 0 — otherwise every
// made-to-order finished good with no minimum set would falsely alert the
// moment it sells out, which is normal for that kind of product, not a
// problem to flag.
export function isStockLow(quantity: number, minQuantity: number): boolean {
  return minQuantity > 0 && quantity <= minQuantity;
}

export interface StockMovementDto {
  id: string;
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  unit: Unit;
  type: StockMovementType;
  // Always a positive magnitude, except for ADJUSTMENT where it's signed
  // (positive = stock increased, negative = decreased) since the type alone
  // doesn't imply a direction the way RECEIPT/WRITE_OFF do.
  quantity: number;
  reason: string | null;
  writeOffReason: WriteOffReason | null;
  createdByName: string;
  createdAt: string;
}

export interface CreateStockMovementRequestDto {
  locationId?: string;
  productId: string;
  quantity: number;
  reason?: string;
  writeOffReason?: WriteOffReason;
}

// Corrects a stock level to what it actually is on the shelf, after a
// mistaken receipt/write-off — the caller states the true current quantity,
// not a delta, and the service computes+records the signed difference as an
// ADJUSTMENT movement so the ledger stays append-only (no edits/deletes of
// past movements).
export interface AdjustStockRequestDto {
  locationId?: string;
  productId: string;
  actualQuantity: number;
  reason: string;
}

export interface WriteOffReasonBreakdownDto {
  reason: WriteOffReason;
  quantity: number;
  value: number;
}

export interface WriteOffProductBreakdownDto {
  productId: string;
  productName: string;
  quantity: number;
  value: number;
}

export interface QualitySummaryDto {
  from: string;
  to: string;
  totalValue: number;
  totalMovements: number;
  byReason: WriteOffReasonBreakdownDto[];
  byProduct: WriteOffProductBreakdownDto[];
}
