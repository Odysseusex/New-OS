import { Unit } from "./catalog";

export enum ProductionBatchStatus {
  PLANNED = "PLANNED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export const PRODUCTION_BATCH_STATUS_LABELS_RU: Record<ProductionBatchStatus, string> = {
  [ProductionBatchStatus.PLANNED]: "Запланировано",
  [ProductionBatchStatus.IN_PROGRESS]: "В процессе",
  [ProductionBatchStatus.COMPLETED]: "Выполнено",
  [ProductionBatchStatus.CANCELLED]: "Отменено",
};

// Why a batch ended up CANCELLED — covers both "cancelled before production
// started" (usually MISTAKE) and "aborted mid-process" (equipment/ingredient
// problems), so reporting can tell the two apart without a separate status.
export enum ProductionCancelReason {
  EQUIPMENT_FAILURE = "EQUIPMENT_FAILURE",
  NO_INGREDIENTS = "NO_INGREDIENTS",
  MISTAKE = "MISTAKE",
  OTHER = "OTHER",
}

export const PRODUCTION_CANCEL_REASON_LABELS_RU: Record<ProductionCancelReason, string> = {
  [ProductionCancelReason.EQUIPMENT_FAILURE]: "Поломка оборудования",
  [ProductionCancelReason.NO_INGREDIENTS]: "Нет сырья",
  [ProductionCancelReason.MISTAKE]: "Ошибка при создании",
  [ProductionCancelReason.OTHER]: "Другое",
};

export interface RecipeItemDto {
  id: string;
  ingredientProductId: string;
  ingredientProductName: string;
  unit: Unit;
  quantity: number;
  // Share of this recipe's total dough weight (see RecipeDto.doughWeightKg),
  // null when the ingredient's unit can't be converted to weight (e.g. PCS)
  // or when the recipe has no computable dough weight at all.
  percentOfDoughWeight: number | null;
}

// The fixed, closed set of measurement kinds a stage parameter can hold —
// the actual physical dimensions a bakery process is measured in. This list
// is not meant to grow every time a new stage type or product category
// appears; new stages reuse the same handful of kinds.
export enum RecipeParameterKind {
  TEMPERATURE_C = "TEMPERATURE_C",
  DURATION_MINUTES = "DURATION_MINUTES",
  PERCENT = "PERCENT",
  WEIGHT_G = "WEIGHT_G",
  COUNT = "COUNT",
}

export const RECIPE_PARAMETER_KIND_LABELS_RU: Record<RecipeParameterKind, string> = {
  [RecipeParameterKind.TEMPERATURE_C]: "Температура, °C",
  [RecipeParameterKind.DURATION_MINUTES]: "Время, мин",
  [RecipeParameterKind.PERCENT]: "Процент, %",
  [RecipeParameterKind.WEIGHT_G]: "Вес, г",
  [RecipeParameterKind.COUNT]: "Количество, шт",
};

export const RECIPE_PARAMETER_KIND_UNIT_RU: Record<RecipeParameterKind, string> = {
  [RecipeParameterKind.TEMPERATURE_C]: "°C",
  [RecipeParameterKind.DURATION_MINUTES]: "мин",
  [RecipeParameterKind.PERCENT]: "%",
  [RecipeParameterKind.WEIGHT_G]: "г",
  [RecipeParameterKind.COUNT]: "шт",
};

export interface RecipeStageParameterDto {
  id: string;
  kind: RecipeParameterKind;
  label: string | null;
  value: number;
}

export interface RecipeStageParameterInputDto {
  kind: RecipeParameterKind;
  label?: string;
  value: number;
}

export interface RecipeStageDto {
  id: string;
  stageTypeId: string;
  stageTypeName: string;
  sequence: number;
  note: string | null;
  parameters: RecipeStageParameterDto[];
}

export interface RecipeStageInputDto {
  stageTypeId: string;
  sequence: number;
  note?: string;
  parameters: RecipeStageParameterInputDto[];
}

// Organization-wide catalog of process stages (Замес, Брожение, Выпечка,
// Сборка, ...) a recipe can pick from and order as it needs — bread,
// viennoiserie and cakes each pick a different subset/order from the same
// shared list rather than needing their own hardcoded set of stages.
export interface RecipeStageTypeDto {
  id: string;
  name: string;
  isActive: boolean;
}

export interface CreateRecipeStageTypeRequestDto {
  name: string;
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
  stages: RecipeStageDto[];
  revisions: RecipeRevisionDto[];
  generalNotes: string | null;
  pieceWeightG: number | null;
  lossPercent: number | null;
  shelfLifeDays: number | null;
  // Cost of all ingredients for one whole batch (yieldQuantity's worth),
  // before dividing by loss-adjusted yield — i.e. what the batch's
  // ingredients actually cost, regardless of how many good units it yields.
  totalIngredientCost: number;
  // Cost per finished unit: totalIngredientCost / (yieldQuantity adjusted
  // for lossPercent). This is what marginPercent is computed against, not
  // totalIngredientCost.
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
  // The single WEIGHT_G stage parameter across this recipe's process (e.g.
  // dough-piece weight at shaping), if there's exactly one — used to show
  // the implied bake loss against pieceWeightG. Null if there's none or
  // more than one (ambiguous which stage it refers to).
  preBakeWeightG: number | null;
}

export interface CreateRecipeItemRequestDto {
  ingredientProductId: string;
  quantity: number;
}

export interface RecipeTechCardFieldsDto {
  generalNotes?: string;
  pieceWeightG?: number;
  lossPercent?: number;
  shelfLifeDays?: number;
  stages?: RecipeStageInputDto[];
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
  startedAt: string | null;
  completedAt: string | null;
  cancelReason: ProductionCancelReason | null;
  cancelNote: string | null;
  createdByName: string;
}

export interface CreateProductionBatchRequestDto {
  locationId?: string;
  recipeId: string;
  plannedQuantity: number;
  scheduledFor?: string;
}

// Only allowed while the batch is still PLANNED — once IN_PROGRESS, the
// schedule/quantity that got fixed at start time is history, not a plan.
export interface UpdateProductionBatchRequestDto {
  scheduledFor?: string;
  plannedQuantity?: number;
}

export interface CompleteProductionBatchRequestDto {
  actualQuantity: number;
}

// note is a free-text detail, mirroring WriteOffStockDto's optional reason
// alongside its enum. reason is required by the API only when cancelling an
// IN_PROGRESS batch (aborting) — cancelling a still-PLANNED one can omit it.
export interface CancelProductionBatchRequestDto {
  reason?: ProductionCancelReason;
  note?: string;
}
