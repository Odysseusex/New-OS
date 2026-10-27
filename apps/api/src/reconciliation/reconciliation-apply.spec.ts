import { PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { CostingService } from "../costing/costing.service";
import { businessDateOf, ReconciliationService } from "./reconciliation.service";

// «Применить к остаткам»: the counted differences go into stock once, as the
// difference (later sales are not undone), and the worksheet keeps the shortage.

describe("applying a day's count to stock", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const service = new ReconciliationService(prisma, new CostingService(prisma));
  let org: IsolatedOrg;
  let cakeId: string;
  let breadId: string;
  let pieId: string;
  const today = businessDateOf(new Date());
  const level = async (productId: string) =>
    (await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId } } })).quantity.toNumber();

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "reconciliation-apply");
    const id = org.organizationId;
    const product = async (name: string, sku: string, price: number) =>
      (await prisma.product.create({ data: { organizationId: id, name, sku, type: ProductType.FINISHED_GOOD, price, unit: Unit.PCS } })).id;
    cakeId = await product("Медовик", "RA-1", 8900);
    breadId = await product("Хлеб", "RA-2", 350);
    pieId = await product("Пирожок", "RA-3", 280);
    for (const productId of [cakeId, breadId, pieId]) await services.inventory.receive(org.user, { locationId: org.storeId, productId, quantity: 10 });
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 2, unitPrice: 350 }] });
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("refuses an unsaved worksheet", async () => {
    await expect(service.apply(org.user, org.storeId, today)).rejects.toThrow("Сначала сохраните");
  });

  it("writes the differences once and keeps showing what was found", async () => {
    // Cake: 1 missing. Bread: 8 expected, 9 on the shelf. Pie: not counted.
    await service.save(org.user, {
      locationId: org.storeId,
      date: today,
      lines: [
        { productId: cakeId, countedQuantity: 9 },
        { productId: breadId, countedQuantity: 9 },
      ],
    });
    // A sale after the evening count (say, the next morning): not undone by the apply.
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CARD, items: [{ productId: cakeId, quantity: 1, unitPrice: 8900 }] });
    const sale = await prisma.sale.findFirstOrThrow({ where: { organizationId: org.organizationId, paymentMethod: "CARD" } });
    await prisma.sale.update({ where: { id: sale.id }, data: { soldAt: new Date(Date.now() + 2 * 24 * 3600_000) } });
    await prisma.stockMovement.updateMany({ where: { saleId: sale.id }, data: { createdAt: new Date(Date.now() + 2 * 24 * 3600_000) } });

    const day = await service.apply(org.user, org.storeId, today);
    expect(day.appliedAt).not.toBeNull();
    expect(day.appliedByName).toBe(org.user.fullName);
    expect(await level(cakeId)).toBe(8); // 10 − 1 sold later − 1 missing
    expect(await level(breadId)).toBe(9); // 8 + 1 found
    expect(await level(pieId)).toBe(10); // not counted: untouched

    const moves = await prisma.stockMovement.findMany({ where: { organizationId: org.organizationId, type: "ADJUSTMENT" } });
    expect(moves.map((m) => [m.productId, m.quantity.toNumber()]).sort()).toEqual([[breadId, 1], [cakeId, -1]].sort());
    expect(moves.every((m) => m.reason?.startsWith("Сверка дня"))).toBe(true);

    // The worksheet still shows the shortage it found, not a corrected zero.
    const cake = day.lines.find((l) => l.productId === cakeId)!;
    expect(cake.closing - (cake.countedQuantity ?? 0)).toBe(1);

    await expect(service.apply(org.user, org.storeId, today)).rejects.toThrow("уже проведены");
  });

  it("locks the counts but not the money", async () => {
    await expect(
      service.save(org.user, { locationId: org.storeId, date: today, lines: [{ productId: cakeId, countedQuantity: 7 }, { productId: breadId, countedQuantity: 9 }] }),
    ).rejects.toThrow("пересчёт товаров изменить нельзя");
    const day = await service.save(org.user, {
      locationId: org.storeId,
      date: today,
      countedCash: 700,
      lines: [
        { productId: cakeId, countedQuantity: 9 },
        { productId: breadId, countedQuantity: 9 },
      ],
    });
    expect(day.countedCash).toBe(700);
  });
});
