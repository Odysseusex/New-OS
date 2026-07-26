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

export interface RecipeStepDto {
  id: string;
  sequence: number;
  instruction: string;
  durationMinutes: number | null;
}

export interface RecipeStepInputDto {
  sequence: number;
  instruction: string;
  durationMinutes?: number;
}

export interface RecipeRevisionDto {
  id: string;
  changedAt: string;
  changedByName: string;
  summary: string;
}

export interface RecipeDto {
  id: string;
  productId: string;
  productName: string;
  productUnit: Unit;
  productPrice: number;
  yieldQuantity: number;
  items: RecipeItemDto[];
  steps: RecipeStepDto[];
  revisions: RecipeRevisionDto[];
  generalNotes: string | null;
  pieceWeightG: number | null;
  mixingTimeSlowMinutes: number | null;
  mixingTimeFastMinutes: number | null;
  doughTempC: number | null;
  shapingWeightG: number | null;
  proofingTempC: number | null;
  proofingHumidityPercent: number | null;
  bakingTempC: number | null;
  bakingTimeMinutes: number | null;
  steamSeconds: number | null;
  fermentationMinutes: number | null;
  proofingMinutes: number | null;
  lossPercent: number | null;
  shelfLifeDays: number | null;
  unitCost: number;
  marginPercent: number | null;
  isActive: boolean;
  // Derived, not stored: sum of ingredient quantities that are in
  // weight-compatible units (KG/G/L, treating 1L water as ~1kg). Null if no
  // ingredient is weight-compatible.
  doughWeightKg: number | null;
  // Names of ingredients excluded from doughWeightKg because their unit
  // (e.g. PCS) can't be converted to weight — shown so the number isn't
  // silently misleading.
  doughWeightExcludedIngredients: string[];
  // Derived suggestion for yieldQuantity, computed from doughWeightKg,
  // lossPercent and pieceWeightG when all three are available. A hint for
  // the technologist to review, never auto-applied.
  suggestedYieldQuantity: number | null;
}

export interface CreateRecipeItemRequestDto {
  ingredientProductId: string;
  quantity: number;
}

export interface RecipeTechCardFieldsDto {
  generalNotes?: string;
  pieceWeightG?: number;
  mixingTimeSlowMinutes?: number;
  mixingTimeFastMinutes?: number;
  doughTempC?: number;
  shapingWeightG?: number;
  proofingTempC?: number;
  proofingHumidityPercent?: number;
  bakingTempC?: number;
  bakingTimeMinutes?: number;
  steamSeconds?: number;
  fermentationMinutes?: number;
  proofingMinutes?: number;
  lossPercent?: number;
  shelfLifeDays?: number;
  steps?: RecipeStepInputDto[];
}

export interface CreateRecipeRequestDto extends RecipeTechCardFieldsDto {
  productId: string;
  yieldQuantity: number;
  items: CreateRecipeItemRequestDto[];
}

export interface UpdateRecipeRequestDto extends RecipeTechCardFieldsDto {
  yieldQuantity?: number;
  items?: CreateRecipeItemRequestDto[];
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
