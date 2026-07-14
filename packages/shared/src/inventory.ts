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

export interface StockMovementDto {
  id: string;
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  unit: Unit;
  type: StockMovementType;
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
