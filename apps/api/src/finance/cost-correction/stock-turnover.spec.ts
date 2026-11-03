import { ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../../test/support/isolated-org";
import { buildServices } from "../../../test/support/services";
import { StockTurnoverService } from "./stock-turnover.service";

// Оборотно-сальдовая ведомость по товарам from real documents. Own throwaway
// organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const turnover = new StockTurnoverService(prisma);
let org: IsolatedOrg;
let flourId: string;
let sugarId: string;
let supplierId: string;
let start: Date;
let between: Date;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "turnover");
  const { organizationId } = org;
  flourId = (await prisma.product.create({ data: { organizationId, name: "Мука", sku: "T-1", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 } })).id;
  sugarId = (await prisma.product.create({ data: { organizationId, name: "Сахар", sku: "T-2", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 250 } })).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId, name: "Мельница" } })).id;
  // Sugar was on the warehouse shelf before anything was recorded.
  await prisma.stockLevel.create({ data: { organizationId, locationId: org.warehouseId, productId: sugarId, quantity: 7 } });
  start = new Date(Date.now() - 1000);
  const buy = async (unitCost: number) => {
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost }] } as never);
    await services.procurement.receive(org.user, po.id);
  };
  await buy(400);
  await services.inventory.writeOff(org.user, { locationId: org.storeId, productId: flourId, quantity: 2, writeOffReason: "DAMAGED" as never });
  await new Promise((r) => setTimeout(r, 20));
  between = new Date();
  await new Promise((r) => setTimeout(r, 20));
  await buy(600);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("stock turnover statement", () => {
  it("opening + in − out = closing, and the closing quantity is the stock on the date", async () => {
    const t = await turnover.turnover(org.organizationId, start, new Date(), null);
    const flour = t.lines.find((l) => l.productId === flourId)!;
    expect(flour).toMatchObject({ openingQuantity: 0, inQuantity: 20, inValue: 10000, outQuantity: 2, outValue: 800, closingQuantity: 18, closingValue: 9200 });
    const level = await prisma.stockLevel.aggregate({ where: { productId: flourId }, _sum: { quantity: true } });
    expect(flour.closingQuantity).toBe(level._sum.quantity!.toNumber());
    expect(t.totals.closingValue).toBeCloseTo(t.totals.openingValue + t.totals.inValue - t.totals.outValue, 2);
  });

  it("a period that starts later opens with what was there", async () => {
    const t = await turnover.turnover(org.organizationId, between, new Date(), null);
    const flour = t.lines.find((l) => l.productId === flourId)!;
    expect(flour).toMatchObject({ openingQuantity: 8, openingValue: 3200, inQuantity: 10, inValue: 6000, outQuantity: 0, closingQuantity: 18, closingValue: 9200 });
  });

  it("stock with no history behind it opens at its starting average, at its own point", async () => {
    const all = await turnover.turnover(org.organizationId, start, new Date(), null);
    expect(all.lines.find((l) => l.productId === sugarId)).toMatchObject({ openingQuantity: 7, openingValue: 1750, closingQuantity: 7 });
    const store = await turnover.turnover(org.organizationId, start, new Date(), org.storeId);
    expect(store.lines.find((l) => l.productId === sugarId)).toBeUndefined();
    expect(store.lines.find((l) => l.productId === flourId)!.closingQuantity).toBe(18);
  });
});
