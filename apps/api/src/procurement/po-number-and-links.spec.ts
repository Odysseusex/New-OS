import { summarizeReconciliation, WriteOffReason } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { FinanceCategoriesService } from "../finance/finance-categories.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// Purchase orders get our own number per organization; a stock row names the
// document it came from; finance articles carry an optional code; «Сверка дня»
// values a shortage at cost beside the price. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
let org: IsolatedOrg;
let supplierId: string;
let flour: string;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "po-number-links");
  supplierId = (await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Мельница" } })).id;
  flour = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Мука", sku: "PN-1", unit: "KG", type: "RAW_MATERIAL", price: 400 } })).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const order = () =>
  services.procurement.create(org.user, { supplierId, locationId: org.warehouseId, items: [{ productId: flour, quantity: 5, unitCost: 400 }] } as never);

it("numbers purchase orders 1, 2, … per organization and finds one by id", async () => {
  const a = await order();
  const b = await order();
  expect(a.number).toBe(1);
  expect(b.number).toBe(2);
  expect((await services.procurement.findOne(org.user, b.id)).number).toBe(2);
});

it("a stock row names its document: the order it was received on", async () => {
  const placed = await order();
  const line = placed.items[0];
  await services.procurement.receive(org.user, placed.id, { items: [{ itemId: line.id, receivedQuantity: 5, unitCost: 400 }] } as never);
  const rows = await services.inventory.getMovements(org.user, undefined, 50, { productId: flour });
  const receipt = rows.find((m) => m.document?.kind === "PURCHASE_ORDER");
  expect(receipt?.document).toEqual({ kind: "PURCHASE_ORDER", id: placed.id, label: `Заказ поставщику №${placed.number}` });

  await services.inventory.writeOff(org.user, { locationId: org.warehouseId, productId: flour, quantity: 1, writeOffReason: WriteOffReason.TASTING } as never);
  const manual = (await services.inventory.getMovements(org.user, undefined, 50, { productId: flour })).find((m) => m.type === "WRITE_OFF");
  expect(manual?.writeOffReason).toBe(WriteOffReason.TASTING);
  expect(manual?.document).toBeNull();
});

it("a finance article keeps its code; an empty code removes it", async () => {
  const categories = new FinanceCategoriesService(prisma);
  const c = await categories.create(org.organizationId, { name: "Аренда", kind: "EXPENSE", code: " 2.1.3 " } as never, org.user.id);
  expect(c.code).toBe("2.1.3");
  const renamed = await categories.update(org.organizationId, c.id, { name: "Аренда цеха" } as never, org.user.id);
  expect(renamed.code).toBe("2.1.3");
  const cleared = await categories.update(org.organizationId, c.id, { name: "Аренда цеха", code: "" } as never, org.user.id);
  expect(cleared.code).toBeNull();
});

it("«Сверка дня» values a shortage at cost beside the price", () => {
  const money = { cashSales: 0, cashRefunds: 0, tillMovements: [], cardSales: 0, cardRefunds: 0, transferSales: 0, transferRefunds: 0, onCredit: 0 } as never;
  const s = summarizeReconciliation({
    money,
    openingCash: null,
    countedCash: null,
    countedCard: null,
    countedTransfer: null,
    lines: [
      { closing: 10, countedQuantity: 8, price: 500, unitCost: 200 },
      { closing: 5, countedQuantity: 6, price: 300, unitCost: null },
    ],
  });
  expect(s.shortageValue).toBe(1000);
  expect(s.surplusValue).toBe(300);
  expect(s.shortageCost).toBe(400);
  expect(s.surplusCost).toBe(0);
  expect(s.goodsDifference).toBe(-700);
});

it("numbers checks 1, 2, … per organization and finds one by its number", async () => {
  const { PaymentMethod } = await import("@bakery-os/shared");
  const bread = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Хлеб", sku: "PN-9", unit: "PCS", type: "FINISHED_GOOD", price: 300 } })).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: bread, quantity: 5 } as never);
  const sell = () => services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bread, quantity: 1, unitPrice: 300 }] } as never);
  const first = await sell();
  const second = await sell();
  expect([first.number, second.number]).toEqual([1, 2]);
  const found = await services.sales.findAll(org.user, undefined, 10, 0, undefined, undefined, undefined, { number: 2 });
  expect(found.map((s) => s.id)).toEqual([second.id]);
});
