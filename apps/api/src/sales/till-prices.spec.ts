import { markdownPrice, PaymentMethod, ProductType, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// A cashier sells only at the till's prices: the point's own price, its fixed
// markdown, or a typed amount on «Произвольная сумма». Anything else did not
// come from the till screen and is refused.

describe("till prices are the server's, not the cashier's", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  let org: IsolatedOrg;
  let cashier: IsolatedOrg["user"];
  let cakeId: string;
  let openPriceId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "till-prices");
    const id = org.organizationId;
    cashier = { ...org.user, role: Role.CASHIER, locationId: org.storeId };
    cakeId = (await prisma.product.create({ data: { organizationId: id, name: "Медовик", sku: "TP-1", type: ProductType.FINISHED_GOOD, price: 900, unit: Unit.PCS } })).id;
    // This point sells it dearer than the catalogue.
    await prisma.productLocationPrice.create({ data: { organizationId: id, locationId: org.storeId, productId: cakeId, price: 1000 } });
    openPriceId = (
      await prisma.product.create({
        data: { organizationId: id, name: "Произвольная сумма", sku: "TP-OPEN", type: ProductType.FINISHED_GOOD, price: 0, unit: Unit.PCS, isOpenPrice: true, trackInventory: false },
      })
    ).id;
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: cakeId, quantity: 50 });
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  const sell = (user: IsolatedOrg["user"], items: { productId: string; quantity: number; unitPrice: number; fullUnitPrice?: number }[]) =>
    services.sales.create(user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items });

  it("accepts the point's price, its markdown and a typed open amount", async () => {
    expect((await sell(cashier, [{ productId: cakeId, quantity: 1, unitPrice: 1000 }])).totalAmount).toBe(1000);
    expect((await sell(cashier, [{ productId: cakeId, quantity: 1, unitPrice: markdownPrice(1000), fullUnitPrice: 1000 }])).totalAmount).toBe(markdownPrice(1000));
    expect((await sell(cashier, [{ productId: openPriceId, quantity: 1, unitPrice: 437 }])).totalAmount).toBe(437);
  });

  it("refuses a price the till never sends", async () => {
    for (const items of [
      [{ productId: cakeId, quantity: 1, unitPrice: 0 }],
      // The catalogue price, not this point's.
      [{ productId: cakeId, quantity: 1, unitPrice: 900 }],
      // A «markdown» deeper than the fixed one.
      [{ productId: cakeId, quantity: 1, unitPrice: 100, fullUnitPrice: 1000 }],
      // A markdown of an invented full price.
      [{ productId: cakeId, quantity: 1, unitPrice: markdownPrice(500), fullUnitPrice: 500 }],
    ]) {
      await expect(sell(cashier, items)).rejects.toThrow("не совпадает с ценой на этой точке");
    }
    // Nothing of the refused checks reached the shelf.
    const level = await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: cakeId } } });
    expect(level.quantity.toNumber()).toBe(48);
  });

  it("an owner may still agree a price (wholesale on «Продажи»)", async () => {
    expect((await sell(org.user, [{ productId: cakeId, quantity: 1, unitPrice: 800 }])).totalAmount).toBe(800);
  });
});
