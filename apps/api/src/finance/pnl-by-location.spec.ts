import { PaymentMethod } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// ОПиУ with points as columns: each column is that point's own P&L and the
// columns add up to «Итого». Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
let org: IsolatedOrg;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "pnl-by-location");
  const id = org.organizationId;
  const bread = (await prisma.product.create({ data: { organizationId: id, name: "Батон", sku: "PL-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: bread, quantity: 10 } as never);
  await services.inventory.receive(org.user, { locationId: org.warehouseId, productId: bread, quantity: 10 } as never);
  await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bread, quantity: 3, unitPrice: 500 }] } as never);
  await services.sales.create(org.user, { locationId: org.warehouseId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bread, quantity: 1, unitPrice: 500 }] } as never);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("columns per point add up to the network total", async () => {
  const r = await services.finance.getPnlByLocation(org.organizationId, new Date(Date.now() - 3_600_000), new Date());
  const store = r.columns.find((c) => c.locationId === org.storeId)!;
  const warehouse = r.columns.find((c) => c.locationId === org.warehouseId)!;
  expect(store.figures.netRevenue).toBe(1500);
  expect(warehouse.figures.netRevenue).toBe(500);
  expect(r.total.netRevenue).toBe(2000);
  for (const key of ["netRevenue", "cogs", "grossProfit", "operatingProfit", "netProfit"] as const) {
    expect(r.columns.reduce((s, c) => s + c.figures[key], 0)).toBeCloseTo(r.total[key], 2);
  }
});
