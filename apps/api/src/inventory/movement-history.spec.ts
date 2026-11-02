import { PaymentMethod, ProductType, StockMovementType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// Stock history with money on it: the cost stamped on every movement, and for
// a sale or a return what the buyer paid per unit.

describe("stock movement history", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  let org: IsolatedOrg;
  let flourId: string;
  let breadId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "movement-history");
    const id = org.organizationId;
    flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "MH-1", type: ProductType.RAW_MATERIAL, price: 300, unit: Unit.KG } })).id;
    breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "MH-2", type: ProductType.FINISHED_GOOD, price: 350, unit: Unit.PCS } })).id;
    await prisma.recipe.create({ data: { organizationId: id, productId: breadId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 5 }] } } });
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: flourId, quantity: 10 });
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 20 });
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("shows cost and sale price, and narrows by product, type and period", async () => {
    // One sale with the same loaf twice: full price and marked down.
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [
        { productId: breadId, quantity: 2, unitPrice: 350 },
        { productId: breadId, quantity: 2, unitPrice: 250, fullUnitPrice: 350 },
      ],
    });
    await services.returns.create(org.user, sale.id, { items: [{ productId: breadId, quantity: 1 }] });

    const bread = await services.inventory.getMovements(org.user, undefined, 1000, { productId: breadId });
    expect(bread.every((m) => m.productId === breadId)).toBe(true);
    const sold = bread.filter((m) => m.type === StockMovementType.SALE);
    expect(sold).toHaveLength(2);
    for (const m of sold) {
      expect(m.unitCost).toBe(150);
      expect(m.salePrice).toBe(300);
      expect(m.costAmount).toBe(300);
    }
    const returned = bread.find((m) => m.type === StockMovementType.SALE_RETURN)!;
    expect(returned.salePrice).not.toBeNull();

    const flour = await services.inventory.getMovements(org.user, undefined, 1000, { productId: flourId, type: StockMovementType.RECEIPT });
    expect(flour).toHaveLength(1);
    expect(flour[0].unitCost).toBe(300);
    expect(flour[0].costAmount).toBe(3000);
    expect(flour[0].salePrice).toBeNull();

    const future = await services.inventory.getMovements(org.user, undefined, 1000, { from: new Date(Date.now() + 3600_000) });
    expect(future).toEqual([]);
  });
});
