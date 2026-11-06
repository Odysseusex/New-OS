import { LocationType, PaymentMethod, ProductType, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { ProductsService } from "./products.service";

// One price list for several own shops: a point linked to another charges that point's prices
// (till, catalogue, price screen); its own stored prices come back when it is unlinked.

describe("a point charging another point's prices", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const products = new ProductsService(prisma);
  let org: IsolatedOrg;
  let shopId: string;
  let cakeId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "price-source");
    const id = org.organizationId;
    shopId = (await prisma.location.create({ data: { organizationId: id, name: "Вторая точка", type: LocationType.STORE, city: "Алматы", address: "—" } })).id;
    cakeId = (await prisma.product.create({ data: { organizationId: id, name: "Медовик", sku: "PS-1", type: ProductType.FINISHED_GOOD, price: 900, unit: Unit.PCS } })).id;
    await products.setLocationPrice(id, org.storeId, cakeId, 1000, org.user.id);
    await products.setLocationPrice(id, shopId, cakeId, 1200, org.user.id);
    await services.inventory.receive(org.user, { locationId: shopId, productId: cakeId, quantity: 10 });
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  const cashier = () => ({ ...org.user, role: Role.CASHIER, locationId: shopId });
  const sell = (unitPrice: number) =>
    services.sales.create(cashier(), { locationId: shopId, paymentMethod: PaymentMethod.CASH, items: [{ productId: cakeId, quantity: 1, unitPrice }] } as never);
  const tillPrice = async () => (await products.findAllForOrganization(org.organizationId, false, shopId)).find((p) => p.id === cakeId)!.effectivePrice;

  it("linked: the till, the catalogue and the price screen use the source's price", async () => {
    const src = await products.setPriceSource(org.organizationId, shopId, org.storeId, org.user.id);
    expect(src.sourceLocationId).toBe(org.storeId);
    expect((await products.priceSource(org.organizationId, org.storeId)).followers.map((f) => f.id)).toEqual([shopId]);
    expect(await tillPrice()).toBe(1000);
    expect((await products.locationPrices(org.organizationId, shopId)).find((r) => r.productId === cakeId)!.locationPrice).toBe(1000);
    expect((await sell(1000)).totalAmount).toBe(1000);
    await expect(sell(1200)).rejects.toThrow();
    // A price change at the source applies to both at once.
    await products.setLocationPrice(org.organizationId, org.storeId, cakeId, 1100, org.user.id);
    expect(await tillPrice()).toBe(1100);
  });

  it("the follower's own price list cannot be edited, and chains are refused", async () => {
    await expect(products.setLocationPrice(org.organizationId, shopId, cakeId, 500, org.user.id)).rejects.toThrow(/берутся с точки/);
    await expect(products.setPriceSource(org.organizationId, org.storeId, shopId, org.user.id)).rejects.toThrow();
    await expect(products.setPriceSource(org.organizationId, shopId, shopId, org.user.id)).rejects.toThrow(/сама у себя/);
  });

  it("unlinked: the point's own prices come back as they were", async () => {
    await products.setPriceSource(org.organizationId, shopId, null, org.user.id);
    expect(await tillPrice()).toBe(1200);
    expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "location.priceSource" } })).toBe(2);
  });
});
