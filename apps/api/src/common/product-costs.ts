import { PrismaService } from "../prisma/prisma.service";

// Unit cost per product, resolved the one way the whole app agrees on.
//
// Lifted out of FinanceService because the profitability report needs exactly
// the same number: a margin computed from a second, slightly different notion
// of cost would contradict the P&L on the same period, and the owner would
// have no way to tell which of the two was lying. Same reason isStockLow()
// lives in shared rather than in two services.
//
// Order matters and is not arbitrary:
//   1. The product's active техкарта (recipe) — what it actually costs US to
//      make, ingredients at their current prices, adjusted for yield.
//   2. Weighted-average actual purchase price — for goods we buy rather than
//      bake, where there is no recipe to compute from.
// A product with neither is absent from the map entirely. Callers must treat
// that as "unknown", never as zero: a zero cost turns into a 100% margin and
// quietly flatters the whole period.
export async function resolveProductUnitCosts(
  prisma: PrismaService,
  organizationId: string,
): Promise<Map<string, number>> {
  const [recipes, purchaseItems] = await Promise.all([
    prisma.recipe.findMany({
      where: { organizationId, isActive: true },
      include: { items: { include: { ingredientProduct: true } } },
    }),
    prisma.purchaseOrderItem.findMany({
      where: { purchaseOrder: { organizationId } },
    }),
  ]);

  // Ingredient-based cost for products that have a техкарта.
  const recipeCostByProduct = new Map<string, number>();
  for (const recipe of recipes) {
    const yieldQuantity = recipe.yieldQuantity.toNumber();
    if (yieldQuantity <= 0) continue;
    const totalIngredientCost = recipe.items.reduce(
      (sum, item) => sum + item.quantity.toNumber() * item.ingredientProduct.price.toNumber(),
      0,
    );
    recipeCostByProduct.set(recipe.productId, totalIngredientCost / yieldQuantity);
  }

  // Fallback for products without a recipe: weighted-average purchase cost.
  const purchaseAgg = new Map<string, { totalCost: number; totalQty: number }>();
  for (const item of purchaseItems) {
    const entry = purchaseAgg.get(item.productId) ?? { totalCost: 0, totalQty: 0 };
    entry.totalCost += item.subtotal.toNumber();
    entry.totalQty += item.quantity.toNumber();
    purchaseAgg.set(item.productId, entry);
  }
  const avgPurchaseCostByProduct = new Map<string, number>();
  for (const [productId, agg] of purchaseAgg) {
    if (agg.totalQty > 0) avgPurchaseCostByProduct.set(productId, agg.totalCost / agg.totalQty);
  }

  const merged = new Map<string, number>(avgPurchaseCostByProduct);
  for (const [productId, cost] of recipeCostByProduct) merged.set(productId, cost);
  return merged;
}
