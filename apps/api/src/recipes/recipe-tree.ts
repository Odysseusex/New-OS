import { Prisma } from "@prisma/client";
import { ProductType, rawMaterialUnitCost } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";

// Recipes that use semi-finished products (полуфабрикаты). ONE place that knows
// how a nested recipe is costed and expanded, so the recipe screen, the costing
// resolver and production can never value the same product two ways.
//
//   cost of 1 unit  = Σ quantity × (raw material's average | unit cost of the
//                     semi-finished's own recipe) ÷ recipe yield
//   expansion       = a semi-finished line becomes the raw materials of its own
//                     recipe, scaled by (quantity needed ÷ that recipe's yield)
//
// The yield is the sellable output after normal loss (D1), so «802 g of raw
// cooked into 1000 g of cream» is simply that recipe's yield.

export const MAX_RECIPE_DEPTH = 4;

export interface TreeIngredient {
  productId: string;
  name: string;
  type: ProductType;
  price: number;
  trackInventory: boolean;
  // Moving average: of a STOCKED semi-finished product's batches, or of a raw
  // material's priced receipts; null when there is none.
  averageUnitCost: number | null;
}

// Cost of one unit of a raw material in a recipe (see rawMaterialUnitCost).
export const rawIngredientCost = (ingredient: Pick<TreeIngredient, "price" | "averageUnitCost">): number =>
  rawMaterialUnitCost(ingredient.price, ingredient.averageUnitCost);

// A semi-finished product held as stock is a leaf, not a recipe to expand: it is
// consumed from stock at its average cost, and its raw materials were already
// consumed when its own batch was made. Without stock it is virtual, as before.
export const isStockedSemiFinished = (ingredient: Pick<TreeIngredient, "type" | "trackInventory">): boolean =>
  ingredient.type === ProductType.SEMI_FINISHED && ingredient.trackInventory;

export interface TreeRecipe {
  productId: string;
  yieldQuantity: number;
  items: { ingredient: TreeIngredient; quantity: number }[];
}

export type RecipeIndex = Map<string, TreeRecipe>;

type Db = PrismaService | Prisma.TransactionClient;

const RECIPE_TREE_SELECT = {
  productId: true,
  yieldQuantity: true,
  items: {
    select: {
      quantity: true,
      ingredientProduct: { select: { id: true, name: true, type: true, price: true, trackInventory: true, averageUnitCost: true } },
    },
  },
} as const;

type LoadedRecipe = Prisma.RecipeGetPayload<{ select: typeof RECIPE_TREE_SELECT }>;

function toTreeRecipe(recipe: LoadedRecipe): TreeRecipe {
  return {
    productId: recipe.productId,
    yieldQuantity: recipe.yieldQuantity.toNumber(),
    items: recipe.items.map((item) => ({
      quantity: item.quantity.toNumber(),
      ingredient: {
        productId: item.ingredientProduct.id,
        name: item.ingredientProduct.name,
        type: item.ingredientProduct.type as ProductType,
        price: item.ingredientProduct.price.toNumber(),
        trackInventory: item.ingredientProduct.trackInventory,
        averageUnitCost: item.ingredientProduct.averageUnitCost?.toNumber() ?? null,
      },
    })),
  };
}

// Active recipes for these products AND, level by level, for every
// semi-finished product they use. With no ids: every active recipe.
export async function loadRecipeIndex(db: Db, organizationId: string, productIds?: string[]): Promise<RecipeIndex> {
  const index: RecipeIndex = new Map();
  let wanted = productIds ? [...new Set(productIds)] : null;
  for (let level = 0; level <= MAX_RECIPE_DEPTH; level++) {
    const recipes: LoadedRecipe[] = await db.recipe.findMany({
      where: { organizationId, isActive: true, ...(wanted ? { productId: { in: wanted } } : {}) },
      select: RECIPE_TREE_SELECT,
    });
    for (const recipe of recipes) index.set(recipe.productId, toTreeRecipe(recipe));
    if (!wanted) break; // everything was loaded at once
    const next = new Set<string>();
    for (const recipe of recipes) {
      for (const item of recipe.items) {
        const id = item.ingredientProduct.id;
        if (item.ingredientProduct.type === ProductType.SEMI_FINISHED && !index.has(id)) next.add(id);
      }
    }
    if (next.size === 0) break;
    wanted = [...next];
  }
  return index;
}

// Unit cost of a recipe's output, or null when something under it cannot be
// priced (a semi-finished product with no active recipe, a loop). Never zero.
export function recipeUnitCost(
  recipe: TreeRecipe,
  index: RecipeIndex,
  memo: Map<string, number | null> = new Map(),
  path: Set<string> = new Set(),
): number | null {
  if (memo.has(recipe.productId)) return memo.get(recipe.productId) ?? null;
  if (recipe.yieldQuantity <= 0 || path.has(recipe.productId)) return null;
  path.add(recipe.productId);
  let total = 0;
  let known = true;
  for (const item of recipe.items) {
    let unit: number | null;
    if (isStockedSemiFinished(item.ingredient) && item.ingredient.averageUnitCost !== null) {
      // What is actually on the shelf costs what it was made for.
      unit = item.ingredient.averageUnitCost;
    } else if (item.ingredient.type === ProductType.SEMI_FINISHED) {
      const sub = index.get(item.ingredient.productId);
      unit = sub ? recipeUnitCost(sub, index, memo, path) : null;
    } else {
      unit = rawIngredientCost(item.ingredient);
    }
    if (unit === null) {
      known = false;
      break;
    }
    total += item.quantity * unit;
  }
  path.delete(recipe.productId);
  const result = known ? total / recipe.yieldQuantity : null;
  memo.set(recipe.productId, result);
  return result;
}

// Unit cost per semi-finished product id (null = unknown), for the recipe screen:
// the moving average for a stocked one that has it, else its own recipe's cost.
export async function semiFinishedUnitCosts(db: Db, organizationId: string, semiIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (semiIds.length === 0) return out;
  const [index, products] = await Promise.all([
    loadRecipeIndex(db, organizationId, semiIds),
    db.product.findMany({ where: { organizationId, id: { in: semiIds } }, select: { id: true, trackInventory: true, averageUnitCost: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const memo = new Map<string, number | null>();
  for (const id of new Set(semiIds)) {
    const product = productById.get(id);
    if (product?.trackInventory && product.averageUnitCost) {
      out.set(id, product.averageUnitCost.toNumber());
      continue;
    }
    const recipe = index.get(id);
    out.set(id, recipe ? recipeUnitCost(recipe, index, memo) : null);
  }
  return out;
}

export interface ExpandedLine {
  ingredient: TreeIngredient;
  quantity: number;
  // Cost of ONE unit of this line: the price of a raw material, the moving
  // average (else the recipe cost) of a stocked semi-finished product.
  unitCost: number | null;
}

// The things a batch consumes: the recipe scaled by `scale`, every VIRTUAL
// semi-finished line replaced by its own recipe's lines, a STOCKED one kept as a
// line (it is taken from stock). The same ingredient reached by two branches is
// one line. `missing` lists semi-finished products that cannot be expanded.
export function expandRecipe(
  recipe: TreeRecipe,
  scale: number,
  index: RecipeIndex,
): { lines: ExpandedLine[]; missing: string[] } {
  const byId = new Map<string, ExpandedLine>();
  const missing = new Set<string>();
  const memo = new Map<string, number | null>();
  const walk = (current: TreeRecipe, factor: number, path: string[]) => {
    for (const item of current.items) {
      const needed = item.quantity * factor;
      const ingredient = item.ingredient;
      if (ingredient.type === ProductType.SEMI_FINISHED && !isStockedSemiFinished(ingredient)) {
        const sub = index.get(ingredient.productId);
        if (!sub || sub.yieldQuantity <= 0 || path.includes(sub.productId) || path.length >= MAX_RECIPE_DEPTH) {
          missing.add(ingredient.name);
          continue;
        }
        walk(sub, needed / sub.yieldQuantity, [...path, sub.productId]);
        continue;
      }
      let unitCost: number | null = rawIngredientCost(ingredient);
      if (isStockedSemiFinished(ingredient)) {
        const sub = index.get(ingredient.productId);
        unitCost = ingredient.averageUnitCost ?? (sub ? recipeUnitCost(sub, index, memo) : null);
      }
      const line = byId.get(ingredient.productId);
      if (line) line.quantity += needed;
      else byId.set(ingredient.productId, { ingredient, quantity: needed, unitCost });
    }
  };
  walk(recipe, scale, [recipe.productId]);
  return { lines: [...byId.values()], missing: [...missing] };
}

export type RecipeProblem = { kind: "CYCLE"; path: string[] } | { kind: "TOO_DEEP" } | null;

// Would giving `productId` this recipe make a loop (a uses b uses a) or nest
// deeper than MAX_RECIPE_DEPTH? `index` already holds the other recipes; the
// candidate replaces whatever `productId` has there.
export function findRecipeProblem(productId: string, candidateItems: { ingredientProductId: string }[], index: RecipeIndex, semiIds: Set<string>): RecipeProblem {
  const children = (id: string): string[] =>
    id === productId
      ? candidateItems.map((i) => i.ingredientProductId).filter((x) => semiIds.has(x))
      : (index.get(id)?.items ?? []).map((i) => i.ingredient.productId).filter((x) => semiIds.has(x));
  let tooDeep = false;
  const visit = (id: string, path: string[]): RecipeProblem => {
    for (const child of children(id)) {
      if (child === productId) return { kind: "CYCLE", path: [...path, child] };
      if (path.includes(child)) continue; // a loop elsewhere; reported for its own product
      if (path.length >= MAX_RECIPE_DEPTH) {
        tooDeep = true;
        continue;
      }
      const found = visit(child, [...path, child]);
      if (found) return found;
    }
    return null;
  };
  const found = visit(productId, [productId]);
  if (found) return found;
  return tooDeep ? { kind: "TOO_DEEP" } : null;
}

// Does the recipe of `rootId` use `targetId` somewhere down its chain (or is it that product)?
export function recipeReaches(index: RecipeIndex, rootId: string, targetId: string): boolean {
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === targetId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (index.get(id)?.items ?? []).some((item) => item.ingredient.type === ProductType.SEMI_FINISHED && visit(item.ingredient.productId));
  };
  return visit(rootId);
}
