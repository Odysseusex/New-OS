import { markdownPrice, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// Отчёты → Продажи: what went at a markdown, and goods «под реализацию», each
// product by product and each kept apart from our own revenue.

describe("sales report: markdown and consignment by product", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  let org: IsolatedOrg;
  let breadId: string;
  let cheeseId: string;

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "report-breakdown");
    const id = org.organizationId;
    const supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Деревня" } })).id;
    breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "RB-1", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } })).id;
    cheeseId = (
      await prisma.product.create({
        data: { organizationId: id, name: "Сыр деревенский", sku: "RB-2", type: ProductType.FINISHED_GOOD, price: 1000, unit: Unit.PCS, consignmentSupplierId: supplierId },
      })
    ).id;
    for (const productId of [breadId, cheeseId]) {
      await services.inventory.receive(org.user, { locationId: org.storeId, productId, quantity: 50 });
    }
    const sell = (items: { productId: string; quantity: number; unitPrice: number; fullUnitPrice?: number }[]) =>
      services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items });
    await sell([{ productId: breadId, quantity: 2, unitPrice: 300 }]);
    await sell([
      { productId: breadId, quantity: 3, unitPrice: markdownPrice(300), fullUnitPrice: 300 },
      { productId: cheeseId, quantity: 1, unitPrice: 1000 },
    ]);
    // A basket of only the supplier's goods: not one of our sales, still their goods sold.
    await sell([{ productId: cheeseId, quantity: 2, unitPrice: 1000 }]);
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("shows the markdown and the consignment goods apart from our revenue", async () => {
    const report = await services.sales.report(org.user, new Date(Date.now() - 3600_000), new Date(), org.storeId);
    const md = markdownPrice(300);
    expect(report.totalRevenue).toBe(600 + 3 * md);
    expect(report.markdownRevenue).toBe(3 * md);
    expect(report.markdownByProduct).toEqual([
      { productId: breadId, productName: "Хлеб", quantity: 3, revenue: 3 * md, markdownLoss: 3 * (300 - md) },
    ]);
    expect(report.consignmentRevenue).toBe(3000);
    expect(report.consignmentByProduct).toEqual([
      { productId: cheeseId, productName: "Сыр деревенский", supplierName: "Деревня", quantity: 3, revenue: 3000 },
    ]);
    // The supplier's cheese is never among our products.
    expect(report.byProduct.map((p) => p.productId)).toEqual([breadId]);
  });
});
