import { ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// A batch that consumes a fraction finer than a gram: the shelf and the
// consumption row must lose the same amount, or stock drifts from its history.

describe("production consumption rounding", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  let org: IsolatedOrg;
  let yeastId: string;
  let recipeId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "production-rounding");
    const id = org.organizationId;
    yeastId = (await prisma.product.create({ data: { organizationId: id, name: "Дрожжи", sku: "PR-1", type: ProductType.RAW_MATERIAL, price: 1800, unit: Unit.KG } })).id;
    const bread = await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "PR-2", type: ProductType.FINISHED_GOOD, price: 350, unit: Unit.PCS } });
    // 0.29 kg per 40 loaves: 25 loaves need 0.18125 kg, 26 need 0.1885 kg.
    recipeId = (
      await prisma.recipe.create({ data: { organizationId: id, productId: bread.id, yieldQuantity: 40, items: { create: [{ ingredientProductId: yeastId, quantity: 0.29 }] } } })
    ).id;
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: yeastId, quantity: 5 });
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("takes off the shelf exactly what the consumption rows say", async () => {
    for (const quantity of [25, 26, 13, 7, 25, 31]) {
      const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: quantity });
      await services.production.start(org.user, batch.id);
      await services.production.complete(org.user, batch.id, { actualQuantity: quantity });
    }
    const consumed = await prisma.stockMovement.aggregate({
      where: { organizationId: org.organizationId, productId: yeastId, type: "PRODUCTION_CONSUMPTION" },
      _sum: { quantity: true },
    });
    const level = await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: yeastId } } });
    expect(level.quantity.toNumber()).toBeCloseTo(5 - consumed._sum.quantity!.toNumber(), 6);
    // Cost still follows the exact recipe: 25 loaves cost 25/40 × 0.29 × 1800.
    const first = await prisma.productionBatchCost.findFirstOrThrow({ where: { batch: { organizationId: org.organizationId, plannedQuantity: 25 } } });
    expect(first.amount.toNumber()).toBeCloseTo(326.25, 2);
  });
});
