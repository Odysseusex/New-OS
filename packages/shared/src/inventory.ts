import { Unit } from "./catalog";

export enum StockMovementType {
  RECEIPT = "RECEIPT",
  SALE = "SALE",
  SALE_RETURN = "SALE_RETURN",
  WRITE_OFF = "WRITE_OFF",
  ADJUSTMENT = "ADJUSTMENT",
  PRODUCTION_CONSUMPTION = "PRODUCTION_CONSUMPTION",
  PRODUCTION_OUTPUT = "PRODUCTION_OUTPUT",
  // Written in pairs by delivery routes (origin → destination). They were in
  // the database enum all along; this list simply had not caught up.
  TRANSFER_OUT = "TRANSFER_OUT",
  TRANSFER_IN = "TRANSFER_IN",
}

export const STOCK_MOVEMENT_TYPE_LABELS_RU: Record<StockMovementType, string> = {
  [StockMovementType.RECEIPT]: "Приёмка",
  [StockMovementType.SALE]: "Продажа",
  [StockMovementType.SALE_RETURN]: "Возврат от покупателя",
  [StockMovementType.WRITE_OFF]: "Списание",
  [StockMovementType.ADJUSTMENT]: "Корректировка",
  [StockMovementType.PRODUCTION_CONSUMPTION]: "Расход на производство",
  [StockMovementType.PRODUCTION_OUTPUT]: "Выпуск продукции",
  [StockMovementType.TRANSFER_OUT]: "Перемещение (отгрузка)",
  [StockMovementType.TRANSFER_IN]: "Перемещение (поступление)",
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
  // Annulled as part of an erroneous receipt/write-off pair (StockVoid): it
  // stays in the history but is no longer counted as a loss anywhere.
  voided?: boolean;
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


// ── Аннулирование ошибочного прихода и списания (StockVoid) ────────────────
// A receipt that never physically happened plus the write-off that only took
// that phantom stock off again. The pair nets to zero, so stock is already
// right: a void moves nothing, it links the movements and removes them from
// every loss figure. Nothing is edited or deleted, and a void cannot be undone.

export interface StockVoidCandidateDto {
  id: string;
  type: StockMovementType;
  locationId: string;
  locationName: string;
  quantity: number;
  unit: Unit;
  createdAt: string;
  createdByName: string;
  reason: string | null;
  writeOffReason: WriteOffReason | null;
  // Cost stamped on the row; null = none (the report then uses today's cost).
  unitCost: number | null;
  // Why this movement cannot be part of a void (a purchase document stands
  // behind it, it is already annulled…). null = it can be selected.
  blockedReason: string | null;
  voided: boolean;
}

export interface CreateStockVoidRequestDto {
  productId: string;
  movementIds: string[];
  reason: string;
}

export interface StockVoidLocationNetDto {
  locationId: string;
  locationName: string;
  received: number;
  writtenOff: number;
  // received − written off. Must be exactly 0 for a void to be allowed.
  net: number;
}

export interface StockVoidPreviewDto {
  allowed: boolean;
  problems: string[];
  locations: StockVoidLocationNetDto[];
  // What the profit and loss currently counts for the selected write-offs
  // (stamped cost, else today's cost) — the fictitious loss a void removes.
  lossRemoved: number;
  // Selected write-offs with no stamped cost, valued at today's cost.
  writeOffsWithoutStampedCost: number;
}

export interface StockVoidDto {
  id: string;
  productId: string;
  productName: string;
  reason: string;
  createdAt: string;
  createdByName: string;
  lossRemoved: number;
  movements: { id: string; type: StockMovementType; locationName: string; quantity: number; createdAt: string }[];
}
