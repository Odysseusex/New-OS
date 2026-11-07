import { PaymentMethod, ProductType, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// The till's cards: how many of each product went today at this point, and the shelf — which the
// till's own staff never see (they count it blind in «Сверка дня»).

describe("till product stats", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  let org: IsolatedOrg;
  let breadId: string;
  let cakeId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "till-stats");
    const id = org.organizationId;
    breadId = (await prisma.product.create({ data: { organizationId: id, name: "Батон", sku: "TS-1", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } })).id;
    cakeId = (await prisma.product.create({ data: { organizationId: id, name: "Медовик", sku: "TS-2", type: ProductType.FINISHED_GOOD, price: 900, unit: Unit.PCS } })).id;
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 10 });
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: cakeId, quantity: 4 });
    await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: breadId, quantity: 3, unitPrice: 300 }],
    } as never);
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("counts today's and the month's sales per product, with the shelf for a manager", async () => {
    const rows = await services.sales.tillStats(org.user, org.storeId);
    const bread = rows.find((r) => r.productId === breadId)!;
    const cake = rows.find((r) => r.productId === cakeId)!;
    expect(bread).toMatchObject({ soldToday: 3, sold30Days: 3, stock: 7 });
    expect(cake).toMatchObject({ soldToday: 0, sold30Days: 0, stock: 4 });
  });

  it("withholds the shelf from a cashier and keeps them to their own point", async () => {
    const cashier = { ...org.user, role: Role.CASHIER, locationId: org.storeId };
    const rows = await services.sales.tillStats(cashier, org.storeId);
    expect(rows.find((r) => r.productId === breadId)).toMatchObject({ soldToday: 3, stock: null });
    expect(rows.every((r) => r.stock === null)).toBe(true);
    await expect(services.sales.tillStats(cashier, "another-point")).rejects.toThrow();
  });
});
