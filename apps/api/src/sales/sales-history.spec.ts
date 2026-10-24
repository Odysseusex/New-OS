import { PaymentMethod, ProductType, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// The till's «История продаж»: the whole day, and «every check with this
// product» so a cashier can show what they actually rang up.

describe("sales history at the till", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  let org: IsolatedOrg;
  let honeyCakeId: string;
  let breadId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "sales-history");
    const id = org.organizationId;
    honeyCakeId = (await prisma.product.create({ data: { organizationId: id, name: "Медовик", sku: "H-1", type: ProductType.FINISHED_GOOD, price: 900, unit: Unit.PCS } })).id;
    breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "H-2", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } })).id;
    for (const [locationId, productId] of [
      [org.storeId, honeyCakeId],
      [org.storeId, breadId],
      [org.warehouseId, honeyCakeId],
    ]) {
      await services.inventory.receive(org.user, { locationId, productId, quantity: 50 });
    }

    await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [
        { productId: honeyCakeId, quantity: 2, unitPrice: 900 },
        { productId: breadId, quantity: 1, unitPrice: 300 },
      ],
    });
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CARD, items: [{ productId: breadId, quantity: 3, unitPrice: 300 }] });
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CARD, items: [{ productId: honeyCakeId, quantity: 1, unitPrice: 900 }] });
    // Another point's sale of the same product.
    await services.sales.create(org.user, { locationId: org.warehouseId, paymentMethod: PaymentMethod.CASH, items: [{ productId: honeyCakeId, quantity: 5, unitPrice: 900 }] });
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("lists only the checks holding the product, with how much of it each had", async () => {
    const list = await services.sales.findAll(org.user, org.storeId, 2000, 0, undefined, undefined, honeyCakeId);
    expect(list.map((s) => s.productQuantity).sort()).toEqual([1, 2]);
    expect(list.every((s) => s.locationId === org.storeId)).toBe(true);
    // Without a product: no quantity, every check.
    const all = await services.sales.findAll(org.user, org.storeId, 2000);
    expect(all).toHaveLength(3);
    expect(all.every((s) => s.productQuantity === undefined)).toBe(true);
  });

  it("a cashier sees only their own point, whatever is asked for", async () => {
    const cashier = { ...org.user, role: Role.CASHIER, locationId: org.storeId };
    await expect(services.sales.findAll(cashier, org.warehouseId, 2000, 0, undefined, undefined, honeyCakeId)).rejects.toThrow("другой точки");
    const list = await services.sales.findAll(cashier, undefined, 2000, 0, undefined, undefined, honeyCakeId);
    expect(list).toHaveLength(2);
    expect(list.every((s) => s.locationId === org.storeId)).toBe(true);
  });

  it("an absurd limit is capped, not refused", async () => {
    const list = await services.sales.findAll(org.user, undefined, 1_000_000);
    expect(list).toHaveLength(4);
  });
});
