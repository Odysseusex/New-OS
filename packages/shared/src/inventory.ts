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
  createdByName: string;
  createdAt: string;
}

export interface CreateStockMovementRequestDto {
  locationId?: string;
  productId: string;
  quantity: number;
  reason?: string;
}
