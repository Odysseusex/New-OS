import { CostBasis, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// A P&L product row, opened up: the detail must add up to the row it came from,
// and show where the cost came from and how it moved.

describe("product P&L detail", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  let org: IsolatedOrg;
  let flourId: string;
  let breadId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "product-pnl-detail");
    const id = org.organizationId;
    flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "PD-1", type: ProductType.RAW_MATERIAL, price: 300, unit: Unit.KG } })).id;
    breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "PD-2", type: ProductType.FINISHED_GOOD, price: 350, unit: Unit.PCS } })).id;
    // 5 kg of flour for 10 loaves: 150 ₸ a loaf, 200 ₸ once flour costs 400.
    await prisma.recipe.create({ data: { organizationId: id, productId: breadId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 5 }] } } });
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 20 });
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("adds up to the P&L row and explains the cost", async () => {
    const from = new Date(Date.now() - 3600_000);
    const first = await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: breadId, quantity: 3, unitPrice: 350 }],
    });
    await prisma.product.update({ where: { id: flourId }, data: { price: 400 } });
    await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: breadId, quantity: 2, unitPrice: 250, fullUnitPrice: 350 }],
    });
    await services.returns.create(org.user, first.id, { items: [{ productId: breadId, quantity: 1 }] });
    const to = new Date(Date.now() + 3600_000);

    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    const row = pnl.byProduct.find((p) => p.productId === breadId)!;
    const detail = await services.finance.getProductPnlDetail(org.organizationId, breadId, from, to);

    expect(detail.quantitySold).toBe(row.quantitySold);
    expect(detail.revenue).toBe(row.revenue);
    expect(detail.cogs).toBe(row.cogs);
    expect(detail.grossProfit).toBe(row.grossProfit);
    expect(detail.marginPercent).toBeCloseTo(row.marginPercent!, 6);

    // 3 × 350 + 2 × 250 − 350 returned; cost 3 × 150 + 2 × 200 − 150 back on the shelf.
    expect(detail.revenue).toBe(1200);
    expect(detail.cogs).toBe(700);
    expect(detail.salesQuantity).toBe(5);
    expect(detail.returnsQuantity).toBe(1);
    expect(detail.returnsCogs).toBe(150);
    expect(detail.discounts).toBe(200);
    expect(detail.averagePrice).toBe(300);
    expect(detail.averageUnitCost).toBe(175);
    expect(detail.currentUnitCost).toBe(200);
    expect(detail.currentCostBasis).toBe(CostBasis.RECIPE_CURRENT);

    expect(detail.costSources).toEqual([{ source: CostBasis.RECIPE_CURRENT, quantity: 5, cogs: 850 }]);
    expect(detail.unitCosts.map((u) => [u.unitCost, u.quantity])).toEqual([
      [150, 3],
      [200, 2],
    ]);
    expect(detail.prices.map((p) => [p.unitPrice, p.fullUnitPrice, p.quantity])).toEqual([
      [350, null, 3],
      [250, 350, 2],
    ]);
    expect(detail.byLocation).toEqual([
      { locationId: org.storeId, locationName: expect.any(String), quantity: 4, revenue: 1200, cogs: 700, hasCostData: true },
    ]);
  });

  it("refuses a product of another organization", async () => {
    const other = await createIsolatedOrg(prisma, "product-pnl-detail-other");
    try {
      await expect(services.finance.getProductPnlDetail(other.organizationId, breadId, new Date(0), new Date())).rejects.toThrow("Товар не найден");
    } finally {
      await destroyOrg(prisma, other.organizationId);
    }
  });
});
