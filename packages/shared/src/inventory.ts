import { Unit } from "./catalog";

export enum StockMovementType {
  RECEIPT = "RECEIPT",
  SALE = "SALE",
  WRITE_OFF = "WRITE_OFF",
  ADJUSTMENT = "ADJUSTMENT",
}

export const STOCK_MOVEMENT_TYPE_LABELS_RU: Record<StockMovementType, string> = {
  [StockMovementType.RECEIPT]: "Приёмка",
  [StockMovementType.SALE]: "Продажа",
  [StockMovementType.WRITE_OFF]: "Списание",
  [StockMovementType.ADJUSTMENT]: "Корректировка",
};

export interface StockLevelDto {
  id: string;
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  sku: string;
  unit: Unit;
  category: string;
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
