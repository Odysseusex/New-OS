import { ProductType, Unit } from "./catalog";
import type { ProductionCostComponentStatusDto } from "./costing";

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
  // Брутто: what is taken from stock and costed.
  quantity: number;
  // Технологические потери of this ingredient, %; null = not stated.
  lossPercent: number | null;
  // Нетто = брутто × (1 − потери/100); equals брутто when no loss is stated.
  netQuantity: number;
  // RAW_MATERIAL, or SEMI_FINISHED (a component with its own recipe).
  ingredientType: ProductType;
  // Cost of ONE unit of this ingredient: its price for raw material, the unit
  // cost of its own recipe for a semi-finished product. Null = cannot be priced.
  ingredientUnitCost: number | null;
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

export interface RecipeVersionItemDto {
  ingredientProductId: string;
  name: string;
  unit: Unit;
  quantity: number;
  lossPercent: number | null;
  netQuantity: number;
}

// The composition of a recipe in force from `validFrom` (newest first on the card).
export interface RecipeVersionDto {
  id: string;
  number: number;
  validFrom: string;
  createdByName: string;
  yieldQuantity: number;
  lossPercent: number | null;
  items: RecipeVersionItemDto[];
}

// Нетто of an ingredient line, to 0.001 of its unit.
export function recipeNetQuantity(quantity: number, lossPercent: number | null | undefined): number {
  const loss = lossPercent && lossPercent > 0 ? Math.min(lossPercent, 100) : 0;
  return Math.round(quantity * (1 - loss / 100) * 1000) / 1000;
}

export interface RecipeDto {
  id: string;
  productId: string;
  productName: string;
  productType: ProductType;
  // Semi-finished product held as stock (batches of its own, average cost).
  productStocked: boolean;
  productUnit: Unit;
  productPrice: number;
  yieldQuantity: number;
  items: RecipeItemDto[];
  stages: RecipeStageDto[];
  revisions: RecipeRevisionDto[];
  versions: RecipeVersionDto[];
  generalNotes: string | null;
  pieceWeightG: number | null;
  lossPercent: number | null;
  shelfLifeDays: number | null;
  // Largest mix the mixer takes, kg; the calculator splits a bigger amount. Null = not split.
  mixCapacityKg: number | null;
  // Cost of all ingredients for one whole batch (yieldQuantity's worth),
  // before dividing by loss-adjusted yield — i.e. what the batch's
  // ingredients actually cost, regardless of how many good units it yields.
  totalIngredientCost: number;
  // False when some ingredient cannot be priced; the figures then leave it out.
  costComplete: boolean;
  // What the owner marked as not yet in the cost (stored), and the warning shown:
  // the stored note while the recipe has no semi-finished ingredient, else null.
  uncountedNote: string | null;
  uncountedWarning: string | null;
  // Cost per finished unit: totalIngredientCost / (yieldQuantity adjusted
  // for lossPercent). This is what marginPercent is computed against, not
  // totalIngredientCost.
  unitCost: number;
  marginPercent: number | null;
  // Наценка: (price − unit cost) / unit cost, in percent. Null without a price or cost.
  markupPercent?: number | null;
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
  // Брутто.
  quantity: number;
  // Потери, % (0–99.99); null/absent = not stated.
  lossPercent?: number | null;
}

export interface RecipeTechCardFieldsDto {
  generalNotes?: string;
  // «начинка» — shown as «Не учтено: …» until a semi-finished ingredient is added.
  // An empty string clears it.
  uncountedNote?: string;
  pieceWeightG?: number;
  lossPercent?: number;
  shelfLifeDays?: number;
  // null clears it.
  mixCapacityKg?: number | null;
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
  // A batch of a STOCKED semi-finished product (cream, filling): the raw
  // materials consumed are what the plan said, the output is what was weighed.
  consumesByPlan: boolean;
  status: ProductionBatchStatus;
  plannedQuantity: number;
  actualQuantity: number | null;
  scheduledFor: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelReason: ProductionCancelReason | null;
  cancelNote: string | null;
  createdByName: string;
  // The recipe version a completed batch was produced by (null before completion / before versions existed).
  recipeVersionNumber: number | null;
  // Cost components of a completed batch (null while not completed). Only
  // INGREDIENT is computed; the rest are NOT_CONFIGURED until policy D6.
  costComponents: ProductionCostComponentStatusDto[] | null;
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
  // Raw material really used, only for the ingredients that differ from the
  // norm (left out = exactly the norm). Above the norm = «Перерасход» (a
  // write-off), below = «Экономия» (stock comes back); the product's cost
  // stays the norm.
  consumption?: { productId: string; quantity: number }[];
  // Another own point to put the output in (e.g. straight to a shop); absent = the batch's point.
  outputLocationId?: string;
}

// What a batch takes off the shelf per ONE unit of the quantity it consumes
// for (the actual output, or the plan for a stocked semi-finished product):
// the recipe expanded to stocked items, one line per product.
export interface ProductionBatchNormDto {
  batchId: string;
  consumesByPlan: boolean;
  plannedQuantity: number;
  lines: { productId: string; name: string; unit: Unit; perUnit: number; fromStock: boolean }[];
}

// «Отклонения от техкарты»: raw material used vs the recipe norm.
export interface ProductionDeviationLineDto {
  batchId: string;
  completedAt: string;
  locationName: string;
  productName: string;
  outputQuantity: number;
  outputUnit: Unit;
  ingredientId: string;
  ingredientName: string;
  unit: Unit;
  norm: number;
  actual: number;
  // actual − norm: > 0 перерасход, < 0 экономия.
  deviation: number;
  unitCost: number | null;
  deviationValue: number | null;
}

export interface ProductionDeviationByIngredientDto {
  ingredientId: string;
  ingredientName: string;
  unit: Unit;
  norm: number;
  actual: number;
  deviation: number;
  deviationValue: number;
}

export interface ProductionDeviationReportDto {
  from: string;
  to: string;
  batchesCount: number;
  overuseValue: number;
  savingValue: number;
  byIngredient: ProductionDeviationByIngredientDto[];
  // Only lines whose actual differs from the norm.
  lines: ProductionDeviationLineDto[];
}

// note is a free-text detail, mirroring WriteOffStockDto's optional reason
// alongside its enum. reason is required by the API only when cancelling an
// IN_PROGRESS batch (aborting) — cancelling a still-PLANNED one can omit it.
export interface CancelProductionBatchRequestDto {
  reason?: ProductionCancelReason;
  note?: string;
}

// «Выпуск»: what was produced in a period, per product and point, at the cost of
// the ingredients by the norm (overuse is a write-off, not product cost — D1).
export interface ProductionOutputRowDto {
  productId: string;
  productName: string;
  unit: Unit;
  locationId: string;
  locationName: string;
  // ТЗ §4.4 «по направлениям»: the point's default direction (null = none set).
  directionId: string | null;
  directionName: string | null;
  batches: number;
  quantity: number;
  cost: number;
  // cost ÷ quantity; null when nothing came out.
  unitCost: number | null;
}

export interface ProductionOutputReportDto {
  from: string;
  to: string;
  rows: ProductionOutputRowDto[];
  totalCost: number;
}

// Unit cost of one product month by month (Almaty months, zero-filled).
export interface ProductionUnitCostMonthDto {
  month: string; // "YYYY-MM"
  quantity: number;
  cost: number;
  unitCost: number | null;
}

export interface ProductionUnitCostTrendDto {
  productId: string;
  productName: string;
  unit: Unit;
  months: ProductionUnitCostMonthDto[];
}

// «Акт выпуска» (ТЗ §4.3) of a completed batch.
export interface ProductionBatchDocumentLineDto {
  ingredientId: string;
  ingredientName: string;
  unit: Unit;
  norm: number;
  actual: number;
  deviation: number;
  // The cost the consumption was stamped with (average at the time).
  unitCost: number | null;
  normAmount: number | null;
  actualAmount: number | null;
  deviationValue: number | null;
}

export interface ProductionBatchDocumentDto {
  batchId: string;
  productName: string;
  unit: Unit;
  locationName: string;
  // Where the output went (the batch's point, or a shop it went straight to).
  outputLocationName: string;
  plannedQuantity: number;
  actualQuantity: number;
  completedAt: string;
  createdByName: string;
  recipeVersionNumber: number | null;
  lines: ProductionBatchDocumentLineDto[];
  untrackedCost: number;
  // By the norm (D1); null for a batch completed before costs were recorded.
  batchCost: number | null;
  unitCost: number | null;
  deviationValue: number;
}
