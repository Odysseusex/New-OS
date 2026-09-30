// Cost valuation vocabulary shared by API and UI.
//
// NOTHING here is an approved accounting policy. The inventory cost-flow
// method (which cost a sold loaf carries: FIFO, weighted average, …) is an
// undecided business question; the bases below only NAME what the system does
// today so a report can say where a number came from.

export const COSTING_METHOD_LABEL_RU = "текущий расчёт (политика не утверждена)";

export enum CostBasis {
  // Active техкарта at that moment: Σ ingredient qty × ingredient price ÷ yield.
  RECIPE_CURRENT = "RECIPE_CURRENT",
  // Weighted-average of purchase order lines at that moment.
  PURCHASE_AVERAGE_CURRENT = "PURCHASE_AVERAGE_CURRENT",
  // A raw material's own price field.
  RAW_MATERIAL_PRICE = "RAW_MATERIAL_PRICE",
  // Consignment terms agreed with the goods' owner.
  CONSIGNMENT_TERMS = "CONSIGNMENT_TERMS",
  // What a received purchase order line actually cost.
  PURCHASE_ACTUAL = "PURCHASE_ACTUAL",
  // Ingredient cost of a completed production batch ÷ output.
  PRODUCTION_INGREDIENTS = "PRODUCTION_INGREDIENTS",
}

export const COST_BASIS_LABELS_RU: Record<CostBasis, string> = {
  [CostBasis.RECIPE_CURRENT]: "Техкарта (текущий расчёт)",
  [CostBasis.PURCHASE_AVERAGE_CURRENT]: "Средняя закупка (текущий расчёт)",
  [CostBasis.RAW_MATERIAL_PRICE]: "Цена сырья",
  [CostBasis.CONSIGNMENT_TERMS]: "Условия консигнации",
  [CostBasis.PURCHASE_ACTUAL]: "Фактическая закупка",
  [CostBasis.PRODUCTION_INGREDIENTS]: "Ингредиенты партии",
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
}

export const PRODUCTION_COST_COMPONENT_LABELS_RU: Record<ProductionCostComponent, string> = {
  [ProductionCostComponent.INGREDIENT]: "Ингредиенты",
  [ProductionCostComponent.PACKAGING]: "Упаковка",
  [ProductionCostComponent.LABOR]: "Оплата труда",
  [ProductionCostComponent.UTILITY]: "Коммунальные расходы",
  [ProductionCostComponent.OVERHEAD]: "Накладные расходы",
  [ProductionCostComponent.TECHNOLOGICAL_LOSS]: "Технологические потери",
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
