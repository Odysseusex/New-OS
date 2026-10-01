import { ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { CostingService } from "../costing/costing.service";
import { RecipesService } from "./recipes.service";

// D1: the recipe's yield is the normal sellable output AFTER normal technological
// loss. The recipe card, the costing service and every report must agree on what
// one unit costs — and none of them takes the loss off a second time.

const prisma = new PrismaService();
let org: IsolatedOrg;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "recipe-cost");
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("a recipe with 10 % technological loss still costs ingredients ÷ yield, on the card and in the costing service alike", async () => {
  const flour = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Мука", sku: "RC-1", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 } });
  const bread = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Хлеб", sku: "RC-2", unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 500 } });
  await prisma.recipe.create({
    data: { organizationId: org.organizationId, productId: bread.id, yieldQuantity: 4, lossPercent: 10, items: { create: [{ ingredientProductId: flour.id, quantity: 2 }] } },
  });
  const [card] = (await new RecipesService(prisma).findAllForOrganization(org.organizationId)).filter((r) => r.productId === bread.id);
  const costing = await new CostingService(prisma).currentUnitCosts(org.organizationId);

  expect(card.totalIngredientCost).toBe(200);
  expect(card.unitCost).toBe(50); // not 200 ÷ (4 × 0.9) = 55.56
  expect(card.unitCost).toBe(costing.get(bread.id)?.unitCost);
  expect(card.marginPercent).toBe(90);
  // The percentage is still kept (it helps suggest a yield) — it just does not change the cost.
  expect(card.lossPercent).toBe(10);
});
