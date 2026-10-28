// Cost valuation vocabulary shared by API and UI.
//
// Decision D2 (approved): inventory is costed at WEIGHTED AVERAGE. In the
// system today that applies to goods that are bought (the average of what was
// actually received: RECEIVED orders and CONFIRMED invoices). A baked product is
// costed from its recipe, and an ingredient at the price on its product card;
// moving that to receipt-by-receipt averaging is not done and is reported as
// such. The bases below NAME where each number came from; a figure already
// stamped on a sale or movement is never recomputed.

export const COSTING_METHOD_LABEL_RU =
  "средневзвешенная стоимость закупок; сырьё — скользящая средневзвешенная по приёмкам (до первой приёмки с ценой — по цене из номенклатуры)";

export enum CostBasis {
  // Active техкарта at that moment: Σ ingredient qty × ingredient price ÷ yield.
  RECIPE_CURRENT = "RECIPE_CURRENT",
  // Weighted-average of purchase order lines at that moment.
  PURCHASE_AVERAGE_CURRENT = "PURCHASE_AVERAGE_CURRENT",
  // A raw material's own price field (before its first priced receipt).
  RAW_MATERIAL_PRICE = "RAW_MATERIAL_PRICE",
  // Moving weighted average of a raw material over its priced receipts.
  RAW_MATERIAL_AVERAGE = "RAW_MATERIAL_AVERAGE",
  // Consignment terms agreed with the goods' owner.
  CONSIGNMENT_TERMS = "CONSIGNMENT_TERMS",
  // What a received purchase order line actually cost.
  PURCHASE_ACTUAL = "PURCHASE_ACTUAL",
  // Ingredient cost of a completed production batch ÷ output.
  PRODUCTION_INGREDIENTS = "PRODUCTION_INGREDIENTS",
  // Moving weighted-average cost of a stocked semi-finished product.
  PRODUCTION_AVERAGE = "PRODUCTION_AVERAGE",
}

export const COST_BASIS_LABELS_RU: Record<CostBasis, string> = {
  [CostBasis.RECIPE_CURRENT]: "Техкарта (текущий расчёт)",
  [CostBasis.PURCHASE_AVERAGE_CURRENT]: "Средняя закупка (текущий расчёт)",
  [CostBasis.RAW_MATERIAL_PRICE]: "Цена сырья",
  [CostBasis.RAW_MATERIAL_AVERAGE]: "Средневзвешенная цена сырья",
  [CostBasis.CONSIGNMENT_TERMS]: "Условия консигнации",
  [CostBasis.PURCHASE_ACTUAL]: "Фактическая закупка",
  [CostBasis.PRODUCTION_INGREDIENTS]: "Ингредиенты партии",
  [CostBasis.PRODUCTION_AVERAGE]: "Средневзвешенная себестоимость полуфабриката",
};

// Components a production batch's cost can be made of. Only INGREDIENT is
// computed; every other component stays unavailable until the production
// costing policy (labour, utilities, overhead, technological loss — decision
// D6) is approved. They exist as a typed, extensible shape, not as numbers.
export enum ProductionCostComponent {
  INGREDIENT = "INGREDIENT",
  PACKAGING = "PACKAGING",
  LABOR = "LABOR",
  UTILITY = "UTILITY",
  OVERHEAD = "OVERHEAD",
  TECHNOLOGICAL_LOSS = "TECHNOLOGICAL_LOSS",
  // Spoilage beyond the normal technological loss. Recorded apart from normal
  // product cost (D1) and never capitalised automatically (D6).
  ABNORMAL_LOSS = "ABNORMAL_LOSS",
}

// What one unit of a raw material costs: the moving average of its priced
// receipts once there is one, the price on its card until then.
export function rawMaterialUnitCost(price: number, averageUnitCost: number | null | undefined): number {
  return averageUnitCost ?? price;
}

// Moving weighted average after a purchase: what is on the shelf at the old
// average plus this delivery at its price, over the new quantity. Stock at or
// below zero carries no value, so the delivery's price becomes the average.
export function movingAverageAfterPurchase(onHand: number, average: number, quantity: number, unitPrice: number): number {
  const before = Math.max(onHand, 0);
  if (before + quantity <= 0) return unitPrice;
  return (before * average + quantity * unitPrice) / (before + quantity);
}

export const PRODUCTION_COST_COMPONENT_LABELS_RU: Record<ProductionCostComponent, string> = {
  [ProductionCostComponent.INGREDIENT]: "Ингредиенты",
  [ProductionCostComponent.PACKAGING]: "Упаковка",
  [ProductionCostComponent.LABOR]: "Оплата труда",
  [ProductionCostComponent.UTILITY]: "Коммунальные расходы",
  [ProductionCostComponent.OVERHEAD]: "Накладные расходы",
  [ProductionCostComponent.TECHNOLOGICAL_LOSS]: "Технологические потери",
  [ProductionCostComponent.ABNORMAL_LOSS]: "Сверхнормативные потери",
};

export const ACTIVE_PRODUCTION_COST_COMPONENTS: readonly ProductionCostComponent[] = [
  ProductionCostComponent.INGREDIENT,
];

export interface ProductionCostComponentStatusDto {
  component: ProductionCostComponent;
  label: string;
  // "ACTIVE" = computed and stored; "NOT_CONFIGURED" = policy not approved yet.
  status: "ACTIVE" | "NOT_CONFIGURED";
  amount: number | null;
}
