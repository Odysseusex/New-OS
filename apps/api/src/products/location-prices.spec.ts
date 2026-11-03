import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { ProductsService } from "./products.service";

// Склад → «Цены по точкам» lists our own goods only: goods «под реализацию»
// sell at one price everywhere — unless one already has a price at the point.

const prisma = new PrismaService();
const products = new ProductsService(prisma);
let org: IsolatedOrg;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "location-prices");
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("leaves goods «под реализацию» off the list unless they have a price at the point", async () => {
  const { organizationId } = org;
  const supplierId = (await prisma.supplier.create({ data: { organizationId, name: "Сельский магазин" } })).id;
  const mk = (name: string, sku: string, consignment: boolean) =>
    prisma.product.create({
      data: { organizationId, name, sku, unit: "PCS", type: "FINISHED_GOOD", price: 500, consignmentSupplierId: consignment ? supplierId : null },
    });
  const own = await mk("Батон", "LP-1", false);
  const theirs = await mk("Молоко", "LP-2", true);
  const priced = await mk("Сметана", "LP-3", true);
  await prisma.productLocationPrice.create({ data: { organizationId, locationId: org.storeId, productId: priced.id, price: 600 } });

  const ids = (await products.locationPrices(organizationId, org.storeId)).map((r) => r.productId);
  expect(ids).toContain(own.id);
  expect(ids).not.toContain(theirs.id);
  expect(ids).toContain(priced.id);
});
