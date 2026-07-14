import { Unit } from "./catalog";

export enum ProductionBatchStatus {
  PLANNED = "PLANNED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export const PRODUCTION_BATCH_STATUS_LABELS_RU: Record<ProductionBatchStatus, string> = {
  [ProductionBatchStatus.PLANNED]: "Запланировано",
  [ProductionBatchStatus.COMPLETED]: "Выполнено",
  [ProductionBatchStatus.CANCELLED]: "Отменено",
};

export interface RecipeItemDto {
  id: string;
  ingredientProductId: string;
  ingredientProductName: string;
  unit: Unit;
  quantity: number;
}

export interface RecipeDto {
  id: string;
  productId: string;
  productName: string;
  productUnit: Unit;
  productPrice: number;
  yieldQuantity: number;
  items: RecipeItemDto[];
  unitCost: number;
  marginPercent: number | null;
  isActive: boolean;
}

export interface CreateRecipeItemRequestDto {
  ingredientProductId: string;
  quantity: number;
}

export interface CreateRecipeRequestDto {
  productId: string;
  yieldQuantity: number;
  items: CreateRecipeItemRequestDto[];
}

export interface ProductionBatchDto {
  id: string;
  locationId: string;
  locationName: string;
  recipeId: string;
  productId: string;
  productName: string;
  unit: Unit;
  status: ProductionBatchStatus;
  plannedQuantity: number;
  actualQuantity: number | null;
  scheduledFor: string;
  completedAt: string | null;
  createdByName: string;
}

export interface CreateProductionBatchRequestDto {
  locationId?: string;
  recipeId: string;
  plannedQuantity: number;
  scheduledFor?: string;
}

export interface CompleteProductionBatchRequestDto {
  actualQuantity: number;
}
