import {
  ALL_FLOUR_KEY,
  defaultScaleBaseKey,
  factorForBase,
  factorForOutput,
  ProductType,
  RecipeBreakdownLineDto,
  scaleBaseOptions,
  scaleRecipe,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { RecipesService } from "./recipes.service";

// The baker's calculator: «47 деревенского» or «замес на 25 кг муки» → what goes
// on the scales, fillings laid out into the same list, split into mixes the
// mixer can take.

const line = (name: string, quantity: number, unit: Unit = Unit.KG): RecipeBreakdownLineDto => ({
  productId: name,
  name,
  type: ProductType.RAW_MATERIAL,
  fromStock: false,
  unit,
  quantity,
});

// «Деревенский»: 36 loaves from 10 kg of flour.
const village = {
  yieldQuantity: 36,
  lines: [line("Мука пшеничная в/с", 8), line("Мука ржаная", 2), line("Вода", 6.5, Unit.L), line("Соль", 200, Unit.G), line("Дрожжи", 0.1), line("Яйцо", 4, Unit.PCS)],
};

describe("scaling arithmetic", () => {
  it("scales to any number of pieces", () => {
    const scaled = scaleRecipe(village, factorForOutput(47, 36), ALL_FLOUR_KEY, null);
    expect(scaled.outputQuantity).toBeCloseTo(47, 9);
    const flour = scaled.lines.find((l) => l.name === "Мука пшеничная в/с")!;
    expect(flour.scaled).toBeCloseTo((8 * 47) / 36, 9); // 10.444 kg
    expect(scaled.lines.find((l) => l.name === "Соль")!.scaled).toBeCloseTo((200 * 47) / 36, 9); // in grams, as entered
  });

  it("counts the baker's percentage against all the flour together", () => {
    expect(defaultScaleBaseKey(village.lines)).toBe(ALL_FLOUR_KEY);
    const scaled = scaleRecipe(village, 1, ALL_FLOUR_KEY, null);
    const pct = (name: string) => scaled.lines.find((l) => l.name === name)!.bakersPercent;
    expect(pct("Мука пшеничная в/с")).toBeCloseTo(80, 9);
    expect(pct("Мука ржаная")).toBeCloseTo(20, 9);
    expect(pct("Вода")).toBeCloseTo(65, 9);
    expect(pct("Соль")).toBeCloseTo(2, 9);
    expect(pct("Яйцо")).toBeNull(); // pieces have no mass
  });

  it("scales from the weight of flour in the mix", () => {
    const factor = factorForBase(village.lines, ALL_FLOUR_KEY, 25);
    const scaled = scaleRecipe(village, factor, ALL_FLOUR_KEY, null);
    expect(scaled.outputQuantity).toBeCloseTo(90, 9); // 25 kg of flour = 2.5 recipes
    expect(scaled.lines.find((l) => l.name === "Вода")!.scaled).toBeCloseTo(16.25, 9);
  });

  it("splits into equal mixes the mixer can take, leaving pieces out of the mass", () => {
    // 47 loaves ≈ 21.976 kg of dough: a 20 kg mixer takes it in two.
    const scaled = scaleRecipe(village, factorForOutput(47, 36), ALL_FLOUR_KEY, 20);
    expect(scaled.totalMassKg).toBeCloseTo((16.8 * 47) / 36, 9);
    expect(scaled.mixes).toBe(2);
    expect(scaled.perMixKg).toBeCloseTo(scaled.totalMassKg / 2, 9);
    expect(scaled.lines.find((l) => l.name === "Дрожжи")!.perMix).toBeCloseTo((0.1 * 47) / 36 / 2, 9);
    expect(scaled.excludedFromMass).toEqual(["Яйцо"]);
    // Fits in one: no split.
    const small = scaleRecipe(village, factorForOutput(36, 36), ALL_FLOUR_KEY, 20);
    expect(small.mixes).toBe(1);
    expect(small.lines.every((l) => l.perMix === null)).toBe(true);
    // No capacity stated: never split.
    expect(scaleRecipe(village, 10, ALL_FLOUR_KEY, null).mixes).toBe(1);
  });

  it("leaves a ready filling from stock out of the mix and the percentages", () => {
    const withFilling = { yieldQuantity: 36, lines: [line("Мука", 2), { ...line("Начинка", 1.8), type: ProductType.SEMI_FINISHED, fromStock: true }] };
    const scaled = scaleRecipe(withFilling, 1, defaultScaleBaseKey(withFilling.lines), 10);
    expect(scaled.totalMassKg).toBe(2);
    expect(scaled.excludedFromMass).toEqual(["Начинка"]);
    expect(scaled.lines[1].scaled).toBe(1.8); // still on the list, to take from stock
    expect(scaled.lines[1].bakersPercent).toBeNull();
    expect(scaleBaseOptions(withFilling.lines).map((o) => o.key)).toEqual(["Мука"]);
  });

  it("falls back to one flour, then to the heaviest ingredient, as the base", () => {
    expect(defaultScaleBaseKey([line("Сахар", 1), line("Мука", 0.5)])).toBe("Мука");
    expect(defaultScaleBaseKey([line("Сахар", 1), line("Масло", 2)])).toBe("Масло");
    expect(defaultScaleBaseKey([line("Яйцо", 5, Unit.PCS)])).toBeNull();
    expect(scaleBaseOptions(village.lines).map((o) => o.key)[0]).toBe(ALL_FLOUR_KEY);
  });

  it("gives nothing for a nonsense amount rather than a negative or infinite list", () => {
    expect(factorForOutput(-3, 36)).toBe(0);
    expect(factorForOutput(10, 0)).toBe(0);
    expect(factorForBase(village.lines, "нет такого", 10)).toBe(0);
    const scaled = scaleRecipe(village, Number.NaN, ALL_FLOUR_KEY, 20);
    expect(scaled.lines.every((l) => l.scaled === 0)).toBe(true);
    expect(scaled.mixes).toBe(1);
  });
});

describe("breakdown from the database", () => {
  const prisma = new PrismaService();
  const recipes = new RecipesService(prisma);
  let org: IsolatedOrg;
  let n = 0;

  const product = (name: string, type: ProductType, unit: Unit = Unit.KG, extra: object = {}) =>
    prisma.product.create({
      data: { organizationId: org.organizationId, name, sku: `BD-${++n}`, unit, type, price: 100, trackInventory: type !== ProductType.SEMI_FINISHED, ...extra } as never,
    });
  const recipeOf = (productId: string, yieldQuantity: number, items: [string, number][], extra: object = {}) =>
    recipes.create(org.user, { productId, yieldQuantity, items: items.map(([ingredientProductId, quantity]) => ({ ingredientProductId, quantity })), ...extra } as never);

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "recipe-breakdown");
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("lays a filling out into raw materials in ONE list, merging what both parts use", async () => {
    const flour = await product("Мука в/с", ProductType.RAW_MATERIAL);
    const sugar = await product("Сахар", ProductType.RAW_MATERIAL);
    const cabbage = await product("Капуста", ProductType.RAW_MATERIAL);
    const egg = await product("Яйцо", ProductType.RAW_MATERIAL, Unit.PCS);
    const filling = await product("Начинка капустная", ProductType.SEMI_FINISHED);
    const pie = await product("Пирожок с капустой", ProductType.FINISHED_GOOD, Unit.PCS);
    // 1 kg of filling from 1.2 kg cabbage and 0.05 kg sugar.
    await recipeOf(filling.id, 1, [[cabbage.id, 1.2], [sugar.id, 0.05]]);
    // 36 pies: 2 kg flour, 0.1 kg sugar, 6 eggs, 1.8 kg filling; mixer 10 kg.
    const pieRecipe = await recipeOf(pie.id, 36, [[flour.id, 2], [sugar.id, 0.1], [egg.id, 6], [filling.id, 1.8]], { mixCapacityKg: 10 });
    expect(pieRecipe.mixCapacityKg).toBe(10);

    const b = await recipes.breakdown(org.organizationId, pieRecipe.id);
    expect(b.yieldQuantity).toBe(36);
    expect(b.mixCapacityKg).toBe(10);
    expect(b.missing).toEqual([]);
    const byName = Object.fromEntries(b.lines.map((l) => [l.name, l]));
    expect(Object.keys(byName).sort()).toEqual(["Капуста", "Мука в/с", "Сахар", "Яйцо"]);
    expect(byName["Капуста"].quantity).toBeCloseTo(2.16, 9); // 1.8 × 1.2
    expect(byName["Сахар"].quantity).toBeCloseTo(0.19, 9); // 0.1 in the dough + 1.8 × 0.05 in the filling
    expect(byName["Яйцо"].unit).toBe(Unit.PCS);
    expect(b.lines.every((l) => !l.fromStock)).toBe(true);
  });

  it("keeps a STOCKED filling as one line taken from stock, as production does", async () => {
    const cabbage = await product("Капуста 2", ProductType.RAW_MATERIAL);
    const flour = await product("Мука 2", ProductType.RAW_MATERIAL);
    const filling = await product("Начинка на складе", ProductType.SEMI_FINISHED, Unit.KG, { trackInventory: true });
    const pie = await product("Пирожок 2", ProductType.FINISHED_GOOD, Unit.PCS);
    await recipeOf(filling.id, 1, [[cabbage.id, 1.2]]);
    const r = await recipeOf(pie.id, 36, [[flour.id, 2], [filling.id, 1.8]]);
    const b = await recipes.breakdown(org.organizationId, r.id);
    expect(b.lines.map((l) => [l.name, l.quantity, l.fromStock])).toEqual([
      ["Мука 2", 2, false],
      ["Начинка на складе", 1.8, true],
    ]);
  });

  it("names a filling that has no recipe instead of silently leaving it out", async () => {
    const flour = await product("Мука 3", ProductType.RAW_MATERIAL);
    const cream = await product("Крем без рецепта", ProductType.SEMI_FINISHED);
    const cake = await product("Торт", ProductType.FINISHED_GOOD, Unit.PCS);
    const creamRecipe = await recipeOf(cream.id, 1, [[flour.id, 1]]);
    const r = await recipeOf(cake.id, 1, [[flour.id, 0.3], [cream.id, 0.5]]);
    // The cream's card switched off afterwards (directly — the archive action itself refuses while it is used).
    await prisma.recipe.update({ where: { id: creamRecipe.id }, data: { isActive: false } });
    const b = await recipes.breakdown(org.organizationId, r.id);
    expect(b.missing).toEqual(["Крем без рецепта"]);
    expect(b.lines.map((l) => l.name)).toEqual(["Мука 3"]);
  });

  it("can clear the mixer capacity, and records the change", async () => {
    const flour = await product("Мука 4", ProductType.RAW_MATERIAL);
    const bread = await product("Хлеб 4", ProductType.FINISHED_GOOD, Unit.PCS);
    const r = await recipeOf(bread.id, 10, [[flour.id, 5]], { mixCapacityKg: 20 });
    const updated = await recipes.update(org.user, r.id, { mixCapacityKg: null } as never);
    expect(updated.mixCapacityKg).toBeNull();
    expect(updated.revisions[0]?.summary).toContain("вместимость замеса");
    const untouched = await recipes.update(org.user, r.id, { mixCapacityKg: undefined, yieldQuantity: 10 } as never);
    expect(untouched.mixCapacityKg).toBeNull();
  });

  it("refuses an archived recipe and one of another organization", async () => {
    const flour = await product("Мука 5", ProductType.RAW_MATERIAL);
    const bread = await product("Хлеб 5", ProductType.FINISHED_GOOD, Unit.PCS);
    const r = await recipeOf(bread.id, 10, [[flour.id, 5]]);
    await expect(recipes.breakdown("other-org", r.id)).rejects.toThrow("Рецептура не найдена");
    await recipes.archive(org.organizationId, r.id);
    await expect(recipes.breakdown(org.organizationId, r.id)).rejects.toThrow("в архиве");
  });
});
