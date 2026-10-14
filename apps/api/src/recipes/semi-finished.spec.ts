import { ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { CostingService } from "../costing/costing.service";
import { ProductsService } from "../products/products.service";
import { buildServices } from "../../test/support/services";
import { ProductionService } from "../production/production.service";
import { RecipesService } from "./recipes.service";
import { expandRecipe, findRecipeProblem, loadRecipeIndex, recipeUnitCost } from "./recipe-tree";

// Semi-finished products: a recipe may use a component that has its own recipe.
// The cost and the raw materials consumed come through the nested recipes, and
// the figures must equal what the technologist's sheet (трайфл «Наполеон») gives.

const prisma = new PrismaService();
const recipes = new RecipesService(prisma);
const production = new ProductionService(prisma);
const services = buildServices(prisma);
let org: IsolatedOrg;
let n = 0;

const product = (name: string, type: ProductType, price = 0, unit: Unit = Unit.KG, extra: object = {}) =>
  prisma.product.create({
    data: { organizationId: org.organizationId, name, sku: `SF-${++n}`, unit, type, price, trackInventory: type !== ProductType.SEMI_FINISHED, ...extra } as never,
  });
const recipeOf = (productId: string, yieldQuantity: number, items: [string, number][]) =>
  recipes.create(org.user, { productId, yieldQuantity, items: items.map(([ingredientProductId, quantity]) => ({ ingredientProductId, quantity })) } as never);

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "semi-finished");
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

// The sheet, in kilograms. Prices are per kg. A recipe's yield is stored to 0.001 of
// the unit, so the sheet's 850.85 g is entered as 0.851 kg (figures differ by < 0.1 %).
async function buildTruffle() {
  const raw = Object.fromEntries(
    await Promise.all(
      Object.entries({
        milk: 850, egg: 1200, sugar: 420, starch: 850, flour: 214, vanillin: 2400, butter: 2950,
        cream33: 2900, paste: 28000, margarine: 2950, vinegar: 700, salt: 700, water: 0,
      }).map(async ([k, price]) => [k, await product(`Сырьё ${k} ${++n}`, ProductType.RAW_MATERIAL, price)] as const),
    ),
  );
  const custard = await product("Заварной крем", ProductType.SEMI_FINISHED);
  const diplomat = await product("Крем Дипломат", ProductType.SEMI_FINISHED);
  const crumbs = await product("Коржи", ProductType.SEMI_FINISHED);
  const truffle = await product("Трайфл Наполеон", ProductType.FINISHED_GOOD, 2500, Unit.PCS);
  await recipeOf(custard.id, 0.802, [[raw.milk.id, 0.5], [raw.egg.id, 0.1], [raw.sugar.id, 0.1], [raw.starch.id, 0.03], [raw.flour.id, 0.02], [raw.vanillin.id, 0.002], [raw.butter.id, 0.05]]);
  await recipeOf(diplomat.id, 1.32, [[custard.id, 1], [raw.cream33.id, 0.3], [raw.paste.id, 0.02]]);
  await recipeOf(crumbs.id, 0.851, [[raw.flour.id, 0.43], [raw.margarine.id, 0.365], [raw.egg.id, 0.06], [raw.vinegar.id, 0.01], [raw.salt.id, 0.006], [raw.water.id, 0.13]]);
  await recipeOf(truffle.id, 1, [[diplomat.id, 0.22], [crumbs.id, 0.18]]);
  return { raw, custard, diplomat, crumbs, truffle };
}

describe("cost through nested recipes", () => {
  let t: Awaited<ReturnType<typeof buildTruffle>>;
  beforeAll(async () => {
    t = await buildTruffle();
  });

  it("matches the technologist's sheet at every level", async () => {
    const all = await recipes.findAllForOrganization(org.organizationId);
    const unit = (id: string) => all.find((r) => r.productId === id)?.unitCost as number;
    expect(unit(t.custard.id)).toBeCloseTo(958.95, 1); // 1 kg of custard
    expect(unit(t.diplomat.id)).toBeCloseTo(1809.81, 1); // 1 kg of cream
    expect(unit(t.crumbs.id)).toBeCloseTo(1471.43, 0); // 1 kg of crumbs
    expect(unit(t.truffle.id)).toBeCloseTo(663.02, 0); // one truffle, without packaging
    const card = all.find((r) => r.productId === t.truffle.id)!;
    expect(card.costComplete).toBe(true);
    expect(card.items.map((i) => [i.ingredientType, Math.round(i.ingredientUnitCost ?? 0)])).toEqual([
      [ProductType.SEMI_FINISHED, 1810],
      [ProductType.SEMI_FINISHED, 1471],
    ]);
  });

  it("the costing interface values the semi-finished and the finished product the same way", async () => {
    const costs = await new CostingService(prisma).currentUnitCosts(org.organizationId);
    expect(costs.get(t.truffle.id)?.unitCost).toBeCloseTo(663.02, 0);
    expect(costs.get(t.diplomat.id)?.unitCost).toBeCloseTo(1809.81, 1);
    // A narrowed lookup (what a sale does) must give the identical figure.
    const one = await new CostingService(prisma).currentUnitCosts(org.organizationId, prisma, [t.truffle.id]);
    expect(one.get(t.truffle.id)?.unitCost).toBe(costs.get(t.truffle.id)?.unitCost);
  });

  it("expands one truffle into the raw materials of the sheet, a shared one counted once", async () => {
    const index = await loadRecipeIndex(prisma, org.organizationId);
    const { lines, missing } = expandRecipe(index.get(t.truffle.id)!, 1, index);
    expect(missing).toEqual([]);
    const grams = (id: string) => (lines.find((l) => l.ingredient.productId === id)?.quantity ?? 0) * 1000;
    expect(grams(t.raw.milk.id)).toBeCloseTo(103.91, 1);
    expect(grams(t.raw.egg.id)).toBeCloseTo(33.47, 1); // custard + dough
    expect(grams(t.raw.flour.id)).toBeCloseTo(95.12, 0);
    expect(grams(t.raw.margarine.id)).toBeCloseTo(77.22, 0);
    expect(lines.filter((l) => l.ingredient.productId === t.raw.egg.id)).toHaveLength(1);
    expect(lines.every((l) => l.ingredient.type !== ProductType.SEMI_FINISHED)).toBe(true);
    const total = lines.reduce((sum, l) => sum + l.quantity * l.ingredient.price, 0);
    expect(total).toBeCloseTo(663.02, 0);
    expect(recipeUnitCost(index.get(t.truffle.id)!, index)).toBeCloseTo(total, 6);
  });

  it("producing the finished product consumes the raw materials, never the semi-finished", async () => {
    const location = org.storeId;
    for (const r of Object.values(t.raw)) {
      await prisma.stockLevel.create({ data: { organizationId: org.organizationId, locationId: location, productId: r.id, quantity: 50, minQuantity: 0 } });
    }
    const recipe = await prisma.recipe.findUniqueOrThrow({ where: { productId: t.truffle.id } });
    const batch = await production.create(org.user, { recipeId: recipe.id, plannedQuantity: 10, locationId: location } as never);
    await production.start(org.user, batch.id);
    await production.complete(org.user, batch.id, { actualQuantity: 10 } as never);

    const moves = await prisma.stockMovement.findMany({ where: { batchId: batch.id } });
    const consumed = moves.filter((m) => m.type === "PRODUCTION_CONSUMPTION");
    expect(consumed.some((m) => [t.custard.id, t.diplomat.id, t.crumbs.id].includes(m.productId))).toBe(false);
    const milk = consumed.find((m) => m.productId === t.raw.milk.id)!;
    expect(milk.quantity.toNumber()).toBeCloseTo(1.0391, 3); // 10 × 103.91 g
    expect(consumed.filter((m) => m.productId === t.raw.egg.id)).toHaveLength(1);
    expect(consumed.some((m) => m.productId === t.raw.water.id)).toBe(true); // water is tracked here, so it is consumed too
    const level = await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: location, productId: t.raw.milk.id } } });
    expect(level.quantity.toNumber()).toBeCloseTo(50 - 1.0391, 3);
    const output = moves.find((m) => m.type === "PRODUCTION_OUTPUT")!;
    expect(output.productId).toBe(t.truffle.id);
    expect(output.unitCost?.toNumber()).toBeCloseTo(663.02, 0);
    const cost = await prisma.productionBatchCost.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(cost.amount.toNumber()).toBeGreaterThan(6620);
    expect(cost.amount.toNumber()).toBeLessThan(6640);
  });

  it("refuses a batch for a semi-finished product on its own", async () => {
    const recipe = await prisma.recipe.findUniqueOrThrow({ where: { productId: t.diplomat.id } });
    await expect(production.create(org.user, { recipeId: recipe.id, plannedQuantity: 1, locationId: org.storeId } as never)).rejects.toThrow(/без учёта склада отдельным заданием/);
  });

  it("will not archive or delete a recipe that another recipe uses, and says which", async () => {
    const recipe = await prisma.recipe.findUniqueOrThrow({ where: { productId: t.diplomat.id } });
    await expect(recipes.archive(org.organizationId, recipe.id, null)).rejects.toThrow(/Трайфл Наполеон/);
    await expect(recipes.remove(org.organizationId, recipe.id, null)).rejects.toThrow(/Трайфл Наполеон/);
  });
});

describe("rules on saving", () => {
  it("a semi-finished ingredient needs its own recipe first; packaging and finished goods are still not ingredients", async () => {
    const flour = await product("Мука-р", ProductType.RAW_MATERIAL, 100);
    const bare = await product("Крем без рецепта", ProductType.SEMI_FINISHED);
    const cake = await product("Торт-р", ProductType.FINISHED_GOOD, 1000, Unit.PCS);
    await expect(recipeOf(cake.id, 1, [[bare.id, 0.2]])).rejects.toThrow(/нет техкарты: Крем без рецепта/);
    const box = await product("Коробка-р", ProductType.PACKAGING, 50, Unit.PCS);
    await expect(recipeOf(cake.id, 1, [[box.id, 1]])).rejects.toThrow(/только сырьё и полуфабрикаты/);
    const other = await product("Готовое-р", ProductType.FINISHED_GOOD, 10, Unit.PCS);
    await expect(recipeOf(cake.id, 1, [[other.id, 1]])).rejects.toThrow(/только сырьё и полуфабрикаты/);
    await expect(recipeOf(box.id, 1, [[flour.id, 1]])).rejects.toThrow(/готовой продукции или полуфабриката/);
  });

  it("a recipe cannot use itself through its parts, and cannot nest more than four levels", async () => {
    const flour = await product("Мука-ц", ProductType.RAW_MATERIAL, 100);
    const a = await product("П/Ф A", ProductType.SEMI_FINISHED);
    const b = await product("П/Ф B", ProductType.SEMI_FINISHED);
    const ra = await recipeOf(a.id, 1, [[flour.id, 1]]);
    await recipeOf(b.id, 1, [[a.id, 1]]);
    // A uses B, which already uses A.
    await expect(recipes.update(org.user, ra.id, { items: [{ ingredientProductId: b.id, quantity: 1 }] } as never)).rejects.toThrow(/ссылается сама на себя/);
    await expect(recipes.update(org.user, ra.id, { items: [{ ingredientProductId: a.id, quantity: 1 }] } as never)).rejects.toThrow(/самого себя/);

    // Four recipe levels in a chain are allowed; a fifth is too deep.
    const chain: string[] = [];
    let previous = flour.id;
    for (let i = 0; i < 4; i++) {
      const p = await product(`Уровень ${i}`, ProductType.SEMI_FINISHED);
      await recipeOf(p.id, 1, [[previous, 1]]);
      chain.push(p.id);
      previous = p.id;
    }
    const top = await product("Верх", ProductType.FINISHED_GOOD, 100, Unit.PCS);
    await expect(recipeOf(top.id, 1, [[chain[3], 1]])).rejects.toThrow(/Слишком глубокая/);
    await expect(recipeOf(top.id, 1, [[chain[2], 1]])).resolves.toBeDefined();
  });

  it("findRecipeProblem reports loops and depth without touching the database", () => {
    const sem = new Set(["a", "b", "c"]);
    const node = (productId: string, ids: string[]) => ({ productId, yieldQuantity: 1, items: ids.map((id) => ({ quantity: 1, ingredient: { productId: id, name: id, type: sem.has(id) ? ProductType.SEMI_FINISHED : ProductType.RAW_MATERIAL, price: 1, trackInventory: true, averageUnitCost: null } })) });
    const index = new Map([["b", node("b", ["c"])], ["c", node("c", ["a"])]]);
    expect(findRecipeProblem("a", [{ ingredientProductId: "b" }], index, sem)).toMatchObject({ kind: "CYCLE" });
    expect(findRecipeProblem("a", [{ ingredientProductId: "x" }], index, sem)).toBeNull();
  });

  it("a semi-finished product with no active recipe leaves its parent's cost unknown, never zero", async () => {
    const flour = await product("Мука-н", ProductType.RAW_MATERIAL, 100);
    const sf = await product("П/Ф н", ProductType.SEMI_FINISHED);
    const cake = await product("Торт-н", ProductType.FINISHED_GOOD, 1000, Unit.PCS);
    const rs = await recipeOf(sf.id, 1, [[flour.id, 1]]);
    await recipeOf(cake.id, 1, [[sf.id, 1]]);
    await prisma.recipe.update({ where: { id: rs.id }, data: { isActive: false } }); // archived behind the guard's back
    const costs = await new CostingService(prisma).currentUnitCosts(org.organizationId);
    expect(costs.has(cake.id)).toBe(false);
    const card = (await recipes.findAllForOrganization(org.organizationId)).find((r) => r.productId === cake.id)!;
    expect(card.costComplete).toBe(false);
    expect(card.items[0].ingredientUnitCost).toBeNull();
  });
});

describe("the semi-finished product itself", () => {
  const products = () => new ProductsService(prisma);

  it("is created without stock tracking, with its own SKU prefix, cannot be consignment, and its stock can be switched on and off", async () => {
    const created = await products().create(org.organizationId, { name: "Крем-тест", unit: Unit.KG, type: ProductType.SEMI_FINISHED, price: 0 } as never);
    expect(created.sku.startsWith("SEM-")).toBe(true);
    expect(created.trackInventory).toBe(false);
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Деревня-sf" } });
    await expect(products().create(org.organizationId, { name: "Крем-реал", unit: Unit.KG, type: ProductType.SEMI_FINISHED, price: 0, consignmentSupplierId: supplier.id } as never)).rejects.toThrow(/под реализацию/);
    // Stock can be switched on by the owner (see stocked-semi-finished.spec.ts) — and off again while nothing is on the shelf.
    const on = await products().update(org.organizationId, created.id, { trackInventory: true } as never, null);
    expect(on.trackInventory).toBe(true);
    const off = await products().update(org.organizationId, created.id, { trackInventory: false } as never, null);
    expect(off.trackInventory).toBe(false);
  });

  it("a product that was already sold or moved cannot become one; one used in a recipe cannot stop being one", async () => {
    const sold = await product("Продавался", ProductType.FINISHED_GOOD, 10, Unit.PCS);
    await prisma.stockMovement.create({ data: { organizationId: org.organizationId, locationId: org.storeId, productId: sold.id, type: "RECEIPT", quantity: 1, reason: "t", createdById: org.user.id } as never });
    await expect(products().update(org.organizationId, sold.id, { type: ProductType.SEMI_FINISHED } as never, null)).rejects.toThrow(/уже продавался/);

    const flour = await product("Мука-т", ProductType.RAW_MATERIAL, 100);
    const sf = await product("П/Ф т", ProductType.SEMI_FINISHED);
    const cake = await product("Торт-т", ProductType.FINISHED_GOOD, 100, Unit.PCS);
    await recipeOf(sf.id, 1, [[flour.id, 1]]);
    await recipeOf(cake.id, 1, [[sf.id, 1]]);
    await expect(products().update(org.organizationId, sf.id, { type: ProductType.FINISHED_GOOD } as never, null)).rejects.toThrow(/используется в техкартах/);
  });
});

describe("never sold, never bought", () => {
  it("the API refuses a semi-finished product on a sale and on a purchase order", async () => {
    const sf = await product("П/Ф не продаётся", ProductType.SEMI_FINISHED);
    await expect(
      services.sales.create(org.user, { locationId: org.storeId, paymentMethod: "CASH", items: [{ productId: sf.id, quantity: 1, unitPrice: 10 }] } as never),
    ).rejects.toThrow(/Полуфабрикат не продаётся/);
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Пост-sf" } });
    await expect(
      services.procurement.create(org.user, { supplierId: supplier.id, locationId: org.storeId, items: [{ productId: sf.id, quantity: 1, unitCost: 10 }] } as never),
    ).rejects.toThrow(/Полуфабрикат нельзя закупать/);
  });
});
