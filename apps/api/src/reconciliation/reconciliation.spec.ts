import { ForbiddenException } from "@nestjs/common";
import { CashMovementType, PaymentMethod, ProductType, Role, summarizeReconciliation, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { businessDateOf, businessDayRange, ReconciliationService } from "./reconciliation.service";

// «Сверка дня» at one till: the shelf and the drawer against the ledgers.

describe("business day", () => {
  it("is an Almaty calendar day, not a UTC one", () => {
    const { start, end } = businessDayRange("2026-10-23");
    expect(start.toISOString()).toBe("2026-10-22T19:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-23T19:00:00.000Z");
    // 23:30 in Almaty is still that day; 00:10 is the next one.
    expect(businessDateOf(new Date("2026-10-23T18:30:00Z"))).toBe("2026-10-23");
    expect(businessDateOf(new Date("2026-10-23T19:10:00Z"))).toBe("2026-10-24");
  });

  it("refuses a malformed date", () => {
    expect(() => businessDayRange("23.10.2026")).toThrow("ГГГГ-ММ-ДД");
    expect(() => businessDayRange("2026-02-30")).toThrow();
  });
});

describe("summary arithmetic", () => {
  const money = { cashSales: 1000, cashRefunds: 0, tillMovements: [], cardSales: 500, cardRefunds: 0, transferSales: 0, transferRefunds: 0, onCredit: 0 };

  it("says nothing until something is counted", () => {
    const s = summarizeReconciliation({ money, openingCash: null, countedCash: null, countedCard: null, countedTransfer: null, lines: [{ closing: 5, countedQuantity: null, price: 100 }] });
    expect(s.moneyDifference).toBeNull();
    expect(s.goodsDifference).toBeNull();
    expect(s.result).toBeNull();
    expect(s.countedLines).toBe(0);
  });

  it("nets goods missing from the shelf against the same money extra in the drawer", () => {
    const s = summarizeReconciliation({
      money,
      openingCash: 0,
      countedCash: 1200, // 200 more than rung up
      countedCard: 500,
      countedTransfer: null,
      lines: [{ closing: 10, countedQuantity: 8, price: 100 }], // two loaves gone
    });
    expect(s.cashDifference).toBe(200);
    expect(s.cardDifference).toBe(0);
    expect(s.transferDifference).toBeNull();
    expect(s.shortageValue).toBe(200);
    expect(s.goodsDifference).toBe(-200);
    expect(s.result).toBe(0);
  });
});

describe("a day at the till", () => {
  const prisma = new PrismaService();
  const services = buildServices(prisma);
  const service = new ReconciliationService(prisma);
  let org: IsolatedOrg;
  let breadId: string;
  let cheeseId: string;
  const today = businessDateOf(new Date());

  beforeAll(async () => {
    await prisma.$connect();
    org = await createIsolatedOrg(prisma, "reconciliation");
    const id = org.organizationId;
    const supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Деревня" } })).id;
    breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "R-1", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } })).id;
    cheeseId = (
      await prisma.product.create({
        data: { organizationId: id, name: "Сыр деревенский", sku: "R-2", type: ProductType.FINISHED_GOOD, price: 1000, unit: Unit.PCS, consignmentSupplierId: supplierId },
      })
    ).id;

    // Yesterday: 10 loaves were already on the shelf.
    const old = await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 10 });
    await prisma.stockMovement.update({ where: { id: old.id }, data: { createdAt: new Date(businessDayRange(today).start.getTime() - 3600_000) } });

    // Today: morning deliveries, sales, a return, money paid out of the drawer.
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 20 });
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: cheeseId, quantity: 5 });
    const cashSale = await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [
        { productId: breadId, quantity: 3, unitPrice: 300 },
        { productId: cheeseId, quantity: 1, unitPrice: 1000 },
      ],
    });
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CARD, items: [{ productId: breadId, quantity: 2, unitPrice: 300 }] });
    await services.returns.create(org.user, cashSale.id, { items: [{ productId: breadId, quantity: 1 }] });
    await prisma.cashMovement.create({
      data: { organizationId: id, accountId: org.cashAccountId, type: CashMovementType.EXPENSE_PAYMENT, amount: 200, reason: "Пакеты", createdById: org.user.id },
    });
  });
  afterAll(async () => {
    const leftovers = await destroyOrg(prisma, org.organizationId);
    await prisma.$disconnect();
    expect(leftovers).toEqual([]);
  });

  it("knows what the shelf should hold, product by product", async () => {
    const day = await service.get(org.user, org.storeId, today);
    const bread = day.lines.find((l) => l.productId === breadId)!;
    expect([bread.opening, bread.received, bread.sold, bread.returned, bread.other, bread.closing]).toEqual([10, 20, 5, 1, 0, 26]);
    const cheese = day.lines.find((l) => l.productId === cheeseId)!;
    expect(cheese.consignment).toBe(true);
    expect(cheese.closing).toBe(4);
  });

  it("knows what the drawer and the terminal should hold", async () => {
    const day = await service.get(org.user, org.storeId, today);
    expect(day.money.cashSales).toBe(1900); // goods «под реализацию» are money in the drawer too
    expect(day.money.cashRefunds).toBe(300);
    expect(day.money.cardSales).toBe(600);
    expect(day.money.tillMovements).toEqual([{ type: CashMovementType.EXPENSE_PAYMENT, amount: -200 }]);
    const s = summarizeReconciliation({ ...day, openingCash: 5000, countedCash: null, countedCard: null, countedTransfer: null });
    expect(s.expectedCash).toBe(6400); // 5000 + 1900 − 300 − 200
    expect(s.expectedCard).toBe(600);
  });

  it("saves the counts, shows the loss, and keeps it in the history", async () => {
    const day = await service.save(org.user, {
      locationId: org.storeId,
      date: today,
      openingCash: 5000,
      countedCash: 6100,
      countedCard: 600,
      lines: [
        { productId: breadId, countedQuantity: 25 },
        { productId: cheeseId, countedQuantity: 4 },
      ],
    });
    expect(day.lines.find((l) => l.productId === breadId)!.countedQuantity).toBe(25);
    const s = summarizeReconciliation(day);
    expect(s.moneyDifference).toBe(-300);
    expect(s.goodsDifference).toBe(-300);
    expect(s.result).toBe(-600); // a loaf gone AND 300 missing from the drawer

    const history = await service.history(org.user, org.storeId);
    expect(history).toEqual([expect.objectContaining({ date: today, moneyDifference: -300, goodsDifference: -300, result: -600, savedByName: org.user.fullName })]);
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: org.organizationId, action: "dailyReconciliation.save" } });
    expect(audit).not.toBeNull();
  });

  it("a loaf sold without ringing it up, money still in the drawer, nets to zero", async () => {
    const day = await service.save(org.user, {
      locationId: org.storeId,
      date: today,
      openingCash: 5000,
      countedCash: 6700,
      countedCard: 600,
      lines: [{ productId: breadId, countedQuantity: 25 }],
    });
    const s = summarizeReconciliation(day);
    expect(s.cashDifference).toBe(300);
    expect(s.goodsDifference).toBe(-300);
    expect(s.result).toBe(0);
    // Saving again replaced the worksheet: the cheese is no longer counted.
    expect(day.lines.find((l) => l.productId === cheeseId)!.countedQuantity).toBeNull();
    expect(await service.history(org.user, org.storeId)).toHaveLength(1);
  });

  it("moves nothing: stock and the till are exactly as before", async () => {
    const level = await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: breadId } } });
    expect(level.quantity.toNumber()).toBe(26);
    const movements = await prisma.cashMovement.count({ where: { organizationId: org.organizationId, accountId: org.cashAccountId } });
    expect(movements).toBe(3); // the cash sale, its refund, the paid-out expense
  });

  it("refuses a day that has not come yet and a product counted twice", async () => {
    const future = businessDateOf(new Date(Date.now() + 3 * 24 * 3600_000));
    await expect(service.save(org.user, { locationId: org.storeId, date: future, lines: [] })).rejects.toThrow("ещё не наступил");
    await expect(
      service.save(org.user, {
        locationId: org.storeId,
        date: today,
        lines: [
          { productId: breadId, countedQuantity: 1 },
          { productId: breadId, countedQuantity: 2 },
        ],
      }),
    ).rejects.toThrow("дважды");
  });

  it("a manager of another location cannot see this till", async () => {
    const manager = { ...org.user, role: Role.STORE_MANAGER, locationId: org.warehouseId };
    await expect(service.get(manager, org.storeId, today)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
