import { Prisma } from "@prisma/client";
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
//   2. Weighted-average actual purchase price (D2) — for goods we buy rather
//      than bake, where there is no recipe to compute from. Only what was
//      really received counts: RECEIVED purchase orders at what was actually
//      delivered (quantity and cost), and CONFIRMED supplier invoices. An order
//      that is merely placed, or was cancelled, has bought nothing.
// A product with neither is absent from the map entirely. Callers must treat
// that as "unknown", never as zero: a zero cost turns into a 100% margin and
// quietly flatters the whole period.
export async function resolveProductUnitCosts(
  prisma: PrismaService | Prisma.TransactionClient,
  organizationId: string,
  // Optional narrowing for hot paths (a sale valuing three loaves must not load
  // every recipe in the organisation). The result for a listed product is
  // identical to the unfiltered one.
  productIds?: string[],
): Promise<Map<string, number>> {
  const [recipes, purchaseItems, invoiceItems] = await Promise.all([
    prisma.recipe.findMany({
      where: { organizationId, isActive: true, ...(productIds ? { productId: { in: productIds } } : {}) },
      include: { items: { include: { ingredientProduct: true } } },
    }),
    prisma.purchaseOrderItem.findMany({
      where: { purchaseOrder: { organizationId, status: "RECEIVED" }, ...(productIds ? { productId: { in: productIds } } : {}) },
    }),
    prisma.invoiceItem.findMany({
      where: { invoice: { organizationId, status: "CONFIRMED" }, ...(productIds ? { productId: { in: productIds } } : {}) },
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
  const add = (productId: string, quantity: number, unitCost: number) => {
    const entry = purchaseAgg.get(productId) ?? { totalCost: 0, totalQty: 0 };
    entry.totalCost += quantity * unitCost;
    entry.totalQty += quantity;
    purchaseAgg.set(productId, entry);
  };
  for (const item of purchaseItems) {
    // What was actually delivered; the ordered figures only when nothing differed.
    add(item.productId, (item.receivedQuantity ?? item.quantity).toNumber(), (item.receivedUnitCost ?? item.unitCost).toNumber());
  }
  for (const item of invoiceItems) add(item.productId, item.quantity.toNumber(), item.unitCost.toNumber());
  const avgPurchaseCostByProduct = new Map<string, number>();
  for (const [productId, agg] of purchaseAgg) {
    if (agg.totalQty > 0) avgPurchaseCostByProduct.set(productId, agg.totalCost / agg.totalQty);
  }

  const merged = new Map<string, number>(avgPurchaseCostByProduct);
  for (const [productId, cost] of recipeCostByProduct) merged.set(productId, cost);
  return merged;
}
