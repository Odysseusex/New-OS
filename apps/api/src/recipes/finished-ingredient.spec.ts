import { CostBasis, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { RecipesService } from "./recipes.service";

// A finished good inside another recipe (owner, 09.11.2026): a plain croissant goes into a filled one. It is
// taken from the shelf at its batches' average cost, never at its sale price, and never expanded again.

const prisma = new PrismaService();
const recipes = new RecipesService(prisma);
const services = buildServices(prisma);
let org: IsolatedOrg;
let flourId: string;
let chickenId: string;
let croissantId: string;
let filledId: string;
let croissantRecipeId: string;
const level = async (productId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: org.warehouseId, productId } } }))?.quantity.toNumber() ?? 0;
const recipeOf = (productId: string, yieldQuantity: number, items: [string, number][]) =>
  recipes.create(org.user, { productId, yieldQuantity, items: items.map(([ingredientProductId, quantity]) => ({ ingredientProductId, quantity })) } as never);

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "finished-ingredient");
  const id = org.organizationId;
  const product = (name: string, sku: string, type: ProductType, price: number, unit: Unit) =>
    prisma.product.create({ data: { organizationId: id, name, sku, type, price, unit } });
  flourId = (await product("Мука", "FI-1", ProductType.RAW_MATERIAL, 400, Unit.KG)).id;
  chickenId = (await product("Куриный рулет", "FI-2", ProductType.RAW_MATERIAL, 3000, Unit.KG)).id;
  croissantId = (await product("Круассан классический", "FI-3", ProductType.FINISHED_GOOD, 900, Unit.PCS)).id;
  filledId = (await product("Сытный круассан", "FI-4", ProductType.FINISHED_GOOD, 1900, Unit.PCS)).id;
  await services.inventory.receive(org.user, { locationId: org.warehouseId, productId: flourId, quantity: 50, unitPrice: 400 });
  await services.inventory.receive(org.user, { locationId: org.warehouseId, productId: chickenId, quantity: 10, unitPrice: 3000 });
  // 10 croissants from 1 kg of flour → 40 ₸ each.
  croissantRecipeId = (await recipeOf(croissantId, 10, [[flourId, 1]])).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("a finished good can go into another recipe, priced at its own cost, not its sale price", async () => {
  // 10 filled: 10 croissants + 0.4 kg chicken (1 200 ₸) → 40 + 120 = 160 ₸ each.
  const filled = await recipeOf(filledId, 10, [[croissantId, 10], [chickenId, 0.4]]);
  expect(filled.unitCost).toBeCloseTo(160, 6);
  expect(filled.costComplete).toBe(true);
});

it("a release makes the plain croissants first, then takes them from the shelf for the filled ones", async () => {
  // Listed in the «wrong» order on purpose.
  const preview = await services.production.previewRelease(org.user, {
    locationId: org.warehouseId,
    lines: [{ productId: filledId, quantity: 10 }, { productId: croissantId, quantity: 30 }],
  });
  expect(preview.materials.find((m) => m.productId === croissantId)).toMatchObject({ quantity: 10, shortage: 0, fromStock: true });
  await services.production.release(org.user, {
    locationId: org.warehouseId,
    lines: [{ productId: filledId, quantity: 10 }, { productId: croissantId, quantity: 30 }],
  });
  expect(await level(croissantId)).toBe(20);
  expect(await level(filledId)).toBe(10);
  expect(await level(flourId)).toBe(47);
  expect(await level(chickenId)).toBeCloseTo(9.6, 6);
  const taken = await prisma.stockMovement.findFirstOrThrow({ where: { productId: croissantId, type: "PRODUCTION_CONSUMPTION" } });
  expect(taken.quantity.toNumber()).toBe(10);
  expect(taken.unitCost?.toNumber()).toBe(40);
  expect(taken.costBasis).toBe(CostBasis.PRODUCTION_AVERAGE);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: filledId } })).averageUnitCost?.toNumber()).toBe(160);
});

it("a recipe cannot go round in a circle through finished goods", async () => {
  await expect(
    recipes.update(org.user, croissantRecipeId, { items: [{ ingredientProductId: filledId, quantity: 1 }] } as never),
  ).rejects.toThrow(/ссылается сама на себя/);
});
