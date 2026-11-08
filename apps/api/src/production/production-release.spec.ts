import { ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { splitReleaseConsumption } from "./production.service";

// «Выпуск за день»: the operator enters what came out; each line becomes a completed batch in one
// transaction — raw materials off at the norm, output on the shelf. Nothing is written by the preview,
// and one line short of flour stops the whole release.

const prisma = new PrismaService();
const services = buildServices(prisma);
let org: IsolatedOrg;
let flourId: string;
let sugarId: string;
let breadId: string;
let bunId: string;
const level = async (locationId: string, productId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId } } }))?.quantity.toNumber() ?? 0;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "production-release");
  const id = org.organizationId;
  const product = (name: string, sku: string, type: ProductType, price: number, unit: Unit) =>
    prisma.product.create({ data: { organizationId: id, name, sku, type, price, unit } });
  flourId = (await product("Мука", "PR-1", ProductType.RAW_MATERIAL, 400, Unit.KG)).id;
  sugarId = (await product("Сахар", "PR-2", ProductType.RAW_MATERIAL, 600, Unit.KG)).id;
  breadId = (await product("Хлеб", "PR-3", ProductType.FINISHED_GOOD, 300, Unit.PCS)).id;
  bunId = (await product("Булочка", "PR-4", ProductType.FINISHED_GOOD, 200, Unit.PCS)).id;
  // 10 loaves: 5 kg flour. 10 buns: 1 kg flour + 0.5 kg sugar.
  await prisma.recipe.create({ data: { organizationId: id, productId: breadId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 5 }] } } });
  await prisma.recipe.create({
    data: { organizationId: id, productId: bunId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 1 }, { ingredientProductId: sugarId, quantity: 0.5 }] } },
  });
  await services.inventory.receive(org.user, { locationId: org.warehouseId, productId: flourId, quantity: 100, unitPrice: 400 });
  await services.inventory.receive(org.user, { locationId: org.warehouseId, productId: sugarId, quantity: 10, unitPrice: 600 });
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const batchCount = () => prisma.productionBatch.count({ where: { organizationId: org.organizationId } });

it("preview shows the raw materials, cost and what is missing — and writes nothing", async () => {
  const preview = await services.production.previewRelease(org.user, {
    locationId: org.warehouseId,
    lines: [{ productId: breadId, quantity: 100 }, { productId: bunId, quantity: 200 }],
  });
  const flour = preview.materials.find((m) => m.productId === flourId)!;
  expect(flour.quantity).toBe(70); // 50 + 20
  expect(flour.onHand).toBe(100);
  expect(flour.shortage).toBe(0);
  expect(preview.materials.find((m) => m.productId === sugarId)!.quantity).toBe(10);
  expect(preview.totalCost).toBe(70 * 400 + 10 * 600);
  expect(await batchCount()).toBe(0);
});

it("one line short of flour stops the whole release", async () => {
  const preview = await services.production.previewRelease(org.user, { locationId: org.warehouseId, lines: [{ productId: breadId, quantity: 300 }] });
  expect(preview.materials[0].shortage).toBe(50);
  await expect(
    services.production.release(org.user, { locationId: org.warehouseId, lines: [{ productId: bunId, quantity: 10 }, { productId: breadId, quantity: 300 }] }),
  ).rejects.toThrow(/«Хлеб»: Недостаточно ингредиента «Мука»/);
  expect(await batchCount()).toBe(0);
  expect(await level(org.warehouseId, flourId)).toBe(100);
});

it("refuses a product without a recipe and a product twice", async () => {
  const flourLine = { productId: flourId, quantity: 1 };
  await expect(services.production.release(org.user, { locationId: org.warehouseId, lines: [flourLine] })).rejects.toThrow(/Нет действующей техкарты: Мука/);
  await expect(
    services.production.release(org.user, { locationId: org.warehouseId, lines: [{ productId: breadId, quantity: 1 }, { productId: breadId, quantity: 2 }] }),
  ).rejects.toThrow(/дважды/);
});

it("releases every line as a completed batch, output straight to the shop, with the real flour used", async () => {
  const result = await services.production.release(org.user, {
    locationId: org.warehouseId,
    outputLocationId: org.storeId,
    lines: [{ productId: breadId, quantity: 100 }, { productId: bunId, quantity: 200 }],
    // 72 kg of flour went instead of 70: the 2 kg over the norm are shared 50:20.
    consumption: [{ productId: flourId, quantity: 72 }],
  });
  expect(result.batchIds).toHaveLength(2);
  const batches = await prisma.productionBatch.findMany({ where: { id: { in: result.batchIds } } });
  expect(batches.every((b) => b.status === "COMPLETED")).toBe(true);
  expect(await level(org.warehouseId, flourId)).toBe(28);
  expect(await level(org.warehouseId, sugarId)).toBe(0);
  expect(await level(org.storeId, breadId)).toBe(100);
  expect(await level(org.storeId, bunId)).toBe(200);
  const overuse = await prisma.stockMovement.findMany({ where: { batchId: { in: result.batchIds }, writeOffReason: "PRODUCTION_OVERUSE" } });
  expect(overuse.map((m) => m.quantity.toNumber()).sort()).toEqual([0.571, 1.429]);
  expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "production.release" } })).toBe(1);
});

it("splits the real use over the batches by their norm, rounding on the last", () => {
  const norms = [new Map([["f", { quantity: 1 }]]), new Map([["f", { quantity: 2 }]]), new Map<string, { quantity: number }>()];
  expect(splitReleaseConsumption(norms, [{ productId: "f", quantity: 4 }])).toEqual([
    [{ productId: "f", quantity: 1.333 }],
    [{ productId: "f", quantity: 2.667 }],
    [],
  ]);
  expect(() => splitReleaseConsumption(norms, [{ productId: "x", quantity: 1 }])).toThrow(/нет такого сырья/);
});
