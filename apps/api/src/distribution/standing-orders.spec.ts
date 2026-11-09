import { LocationType, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { StandingOrdersService } from "./standing-orders.service";

// «Постоянный заказ»: one template per point or wholesale customer, replaced whole on save, with the agreed
// wholesale price kept even for a product not taken every day.

const prisma = new PrismaService();
const service = new StandingOrdersService(prisma);
let org: IsolatedOrg;
let breadId: string;
let bunId: string;
let customerId: string;
let shopId: string;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "standing-orders");
  const id = org.organizationId;
  breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "SO-1", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } })).id;
  bunId = (await prisma.product.create({ data: { organizationId: id, name: "Булка", sku: "SO-2", type: ProductType.FINISHED_GOOD, price: 200, unit: Unit.PCS } })).id;
  customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Мерей" } })).id;
  shopId = (await prisma.location.create({ data: { organizationId: id, name: "Магазин", type: LocationType.STORE, city: "Алматы", address: "—" } })).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("saves a customer's order with agreed prices and replaces it whole", async () => {
  await service.save(org.user, { customerId, lines: [{ productId: breadId, quantity: 50, unitPrice: 250 }, { productId: bunId, quantity: 0, unitPrice: 150 }] });
  let lines = await service.list(org.user);
  expect(lines.map((l) => [l.productId === breadId ? "bread" : "bun", l.quantity, l.unitPrice]).sort()).toEqual([
    ["bread", 50, 250],
    ["bun", 0, 150],
  ]);
  await service.save(org.user, { customerId, lines: [{ productId: bunId, quantity: 20 }] });
  lines = await service.list(org.user);
  expect(lines).toEqual([{ customerId, locationId: null, productId: bunId, quantity: 20, unitPrice: null }]);
  expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "standingOrder.update" } })).toBe(2);
});

it("keeps points and customers apart and refuses what does not fit", async () => {
  await service.save(org.user, { locationId: shopId, lines: [{ productId: breadId, quantity: 30 }, { productId: bunId, quantity: 0 }] });
  expect((await service.list(org.user)).filter((l) => l.locationId === shopId)).toEqual([
    { customerId: null, locationId: shopId, productId: breadId, quantity: 30, unitPrice: null },
  ]);
  await expect(service.save(org.user, { lines: [] })).rejects.toThrow(/либо точку, либо/);
  await expect(service.save(org.user, { customerId, locationId: shopId, lines: [] })).rejects.toThrow(/либо точку, либо/);
  await expect(service.save(org.user, { locationId: shopId, lines: [{ productId: breadId, quantity: 1, unitPrice: 10 }] })).rejects.toThrow(/только для оптового/);
  await expect(
    service.save(org.user, { customerId, lines: [{ productId: breadId, quantity: 1 }, { productId: breadId, quantity: 2 }] }),
  ).rejects.toThrow(/дважды/);
});

it("goes with the customer when the customer is deleted", async () => {
  await prisma.customer.delete({ where: { id: customerId } });
  expect((await service.list(org.user)).some((l) => l.customerId === customerId)).toBe(false);
});
