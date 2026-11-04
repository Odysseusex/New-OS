import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// Приходная накладная (ТЗ §3.1): the supplier's document number, a comment and
// «оплачено сразу». Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
let org: IsolatedOrg;
let supplierId: string;
let flourId: string;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "receive-pay-now");
  supplierId = (await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Мельница" } })).id;
  flourId = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Мука", sku: "RP-1", unit: "KG", type: "RAW_MATERIAL", price: 400 } })).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const order = () =>
  services.procurement.create(org.user, {
    supplierId,
    locationId: org.warehouseId,
    supplierDocNumber: "Н-15",
    note: "к выходным",
    items: [{ productId: flourId, quantity: 10, unitCost: 400 }],
  } as never);

describe("receive with «оплачено сразу»", () => {
  it("refuses to pay before the purchasing cutover, and moves nothing then", async () => {
    const po = await order();
    expect(po).toMatchObject({ supplierDocNumber: "Н-15", note: "к выходным" });
    await expect(services.procurement.receive(org.user, po.id, { payNow: { accountId: org.bankAccountId } })).rejects.toThrow(/учёта закупок/);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PLACED");
  });

  it("receives, keeps the supplier's number and pays the delivery at once", async () => {
    await services.procurement.activateCutover(org.user);
    const po = await order();
    const r = await services.procurement.receive(org.user, po.id, {
      supplierDocNumber: "Н-16",
      items: [{ itemId: po.items[0].id, quantity: 9 }],
      payNow: { accountId: org.bankAccountId },
    });
    expect(r).toMatchObject({ status: "RECEIVED", supplierDocNumber: "Н-16", receivedTotal: 3600, amountPaid: 3600, balanceDue: 0 });
    expect(r.payments[0]).toMatchObject({ amount: 3600, note: "Оплачено при приёмке" });
  });
});
