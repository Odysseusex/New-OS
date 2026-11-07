import { LocationType, PaymentMethod, ProductType, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { ProductsService } from "../products/products.service";

// Somebody else's goods may be tied to ONE point of sale: there they are received and sold, anywhere else the
// till does not offer them and the server refuses them.

describe("consignment goods tied to one point", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const products = new ProductsService(prisma);
  let org: IsolatedOrg;
  let shopId: string;
  let honeyId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "consignment-point");
    const id = org.organizationId;
    shopId = (await prisma.location.create({ data: { organizationId: id, name: "Сельский магазин", type: LocationType.STORE, city: "Алматы", address: "—" } })).id;
    const supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Пасека" } })).id;
    const honey = await products.create(id, {
      name: "Мёд горный",
      type: ProductType.FINISHED_GOOD,
      unit: Unit.PCS,
      price: 2400,
      consignmentSupplierId: supplierId,
      consignmentLocationId: shopId,
    });
    honeyId = honey.id;
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("is stored on the card", async () => {
    const card = (await products.findAllForOrganization(org.organizationId)).find((p) => p.id === honeyId)!;
    expect(card.consignmentLocationId).toBe(shopId);
    expect(card.consignmentLocationName).toBe("Сельский магазин");
  });

  it("is offered, received and sold only at its point", async () => {
    const at = async (locationId: string) => (await products.findAllForOrganization(org.organizationId, false, locationId)).some((p) => p.id === honeyId);
    expect(await at(shopId)).toBe(true);
    expect(await at(org.storeId)).toBe(false);

    await expect(services.inventory.receive(org.user, { locationId: org.storeId, productId: honeyId, quantity: 5 })).rejects.toThrow(/закреплён за точкой/);
    await expect(
      services.inventory.applyBatch(org.user, "receive", { locationId: org.storeId, lines: [{ productId: honeyId, quantity: 5 }] }),
    ).rejects.toThrow(/закреплён за точкой/);
    await services.inventory.receive(org.user, { locationId: shopId, productId: honeyId, quantity: 5 });

    const sell = (locationId: string) =>
      services.sales.create({ ...org.user, role: Role.OWNER }, { locationId, paymentMethod: PaymentMethod.CASH, items: [{ productId: honeyId, quantity: 1, unitPrice: 2400 }] } as never);
    await expect(sell(org.storeId)).rejects.toThrow(/закреплён за точкой/);
    expect((await sell(shopId)).totalAmount).toBe(2400);
  });

  it("one click ties every consignment product to one point, own goods untouched", async () => {
    const id = org.organizationId;
    const supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Молочка" } })).id;
    const milk = await products.create(id, { name: "Сметана", type: ProductType.FINISHED_GOOD, unit: Unit.PCS, price: 900, consignmentSupplierId: supplierId });
    const bread = await products.create(id, { name: "Батон свой", type: ProductType.FINISHED_GOOD, unit: Unit.PCS, price: 300 });
    await expect(products.setConsignmentLocationForAll(id, org.warehouseId, org.user.id)).rejects.toThrow(/точкой продаж/);
    expect((await products.setConsignmentLocationForAll(id, org.storeId, org.user.id)).updated).toBe(2);
    expect((await products.setConsignmentLocationForAll(id, org.storeId, org.user.id)).updated).toBe(0);
    const cards = await products.findAllForOrganization(id);
    expect(cards.find((p) => p.id === milk.id)!.consignmentLocationId).toBe(org.storeId);
    expect(cards.find((p) => p.id === honeyId)!.consignmentLocationId).toBe(org.storeId);
    expect(cards.find((p) => p.id === bread.id)!.consignmentLocationId).toBeNull();
    expect((await products.setConsignmentLocationForAll(id, shopId, org.user.id)).updated).toBe(2);
  });

  it("only a point of sale can hold them, and our own goods have no such point", async () => {
    await expect(products.update(org.organizationId, honeyId, { consignmentLocationId: org.warehouseId }, org.user.id)).rejects.toThrow(/точкой продаж/);
    const own = await products.update(org.organizationId, honeyId, { consignmentSupplierId: null }, org.user.id);
    expect(own.consignmentLocationId).toBeNull();
  });
});
