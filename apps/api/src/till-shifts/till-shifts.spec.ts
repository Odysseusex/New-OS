import { CashAccountType, PaymentMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { TillShiftsService } from "./till-shifts.service";

// Кассовая смена, the ТЗ's own example (§5.4): open with 20 000 ₸ in the drawer,
// 2 croissants × 900 and an eclair 1 200 paid by Kaspi QR, Z-report: cash 20 000,
// Kaspi 3 000. Plus внесение/выемка, the counted difference and the switch that
// makes a shift required. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const shifts = new TillShiftsService(prisma, services.cash);
let org: IsolatedOrg;
let croissantId: string;
let eclairId: string;
let safeId: string;
let cashier: IsolatedOrg["user"];

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "till-shift");
  const id = org.organizationId;
  croissantId = (await prisma.product.create({ data: { organizationId: id, name: "Круассан", sku: "TS-1", unit: "PCS", type: "FINISHED_GOOD", price: 900 } })).id;
  eclairId = (await prisma.product.create({ data: { organizationId: id, name: "Эклер", sku: "TS-2", unit: "PCS", type: "FINISHED_GOOD", price: 1200 } })).id;
  for (const productId of [croissantId, eclairId]) await services.inventory.receive(org.user, { locationId: org.storeId, productId, quantity: 10 } as never);
  safeId = (await prisma.cashAccount.create({ data: { organizationId: id, name: "Сейф", type: CashAccountType.CASH, locationId: org.warehouseId, currentBalance: 100000 } })).id;
  const user = await prisma.user.create({
    data: { organizationId: id, fullName: "Кассир Айгерим", email: `cashier-${id}@iso.test`, passwordHash: "x", role: Role.CASHIER, locationId: org.storeId },
  });
  cashier = { ...org.user, id: user.id, fullName: user.fullName, role: Role.CASHIER, locationId: org.storeId };
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const sell = (items: { productId: string; quantity: number; unitPrice: number }[], paymentMethod: PaymentMethod) =>
  services.sales.create(cashier, { locationId: org.storeId, paymentMethod, items } as never);

describe("till shift", () => {
  it("is not required until switched on; once on, a cashier cannot sell without an open shift", async () => {
    const before = await shifts.state(cashier, undefined);
    expect(before).toMatchObject({ required: false, shift: null, nextNumber: 1 });
    expect(before.tillAccount?.id).toBe(org.cashAccountId);
    expect(before.otherAccounts.map((a) => a.id)).toContain(safeId);

    await shifts.setRequired(org.user, true);
    await expect(sell([{ productId: eclairId, quantity: 1, unitPrice: 1200 }], PaymentMethod.CASH)).rejects.toThrow(/Смена не открыта/);
  });

  it("runs the ТЗ example: open with 20 000, Kaspi QR sale of 3 000, Z-report cash 20 000 and Kaspi 3 000", async () => {
    const shift = await shifts.open(cashier, { locationId: org.storeId, openingCash: 20000 });
    expect(shift).toMatchObject({ number: 1, openingCash: 20000, closedAt: null, openedByName: "Кассир Айгерим" });
    await expect(shifts.open(cashier, { locationId: org.storeId, openingCash: 0 })).rejects.toThrow(/уже открыта/);

    await sell(
      [
        { productId: croissantId, quantity: 2, unitPrice: 900 },
        { productId: eclairId, quantity: 1, unitPrice: 1200 },
      ],
      PaymentMethod.TRANSFER,
    );
    const x = (await shifts.state(cashier, undefined)).report!;
    expect(x).toMatchObject({ checks: 1, revenue: 3000, cashSales: 0, expectedCash: 20000 });
    expect(x.tenders.find((t) => t.method === PaymentMethod.TRANSFER)).toMatchObject({ sales: 3000, refunds: 0 });

    const z = await shifts.close(cashier, shift.id, { countedCash: 20000 });
    expect(z).toMatchObject({ expectedCash: 20000, countedCash: 20000, difference: 0 });
    expect(z.report.tenders.find((t) => t.method === PaymentMethod.TRANSFER)!.sales).toBe(3000);
    await expect(shifts.close(cashier, shift.id, { countedCash: 1 })).rejects.toThrow(/закрыта/);
    // A closed shift is a record: the database refuses to change it.
    await expect(prisma.tillShift.update({ where: { id: shift.id }, data: { note: "x" } })).rejects.toThrow();
  });

  it("counts cash sales, внесение and выемка into the expected cash, and records a shortage", async () => {
    await prisma.cashAccount.update({ where: { id: org.cashAccountId }, data: { currentBalance: 20000 } });
    const shift = await shifts.open(cashier, { locationId: org.storeId, openingCash: 20000 });
    expect(shift.number).toBe(2);
    await sell([{ productId: eclairId, quantity: 2, unitPrice: 1200 }], PaymentMethod.CASH); // +2 400 cash

    await expect(shifts.moveCash(cashier, shift.id, { direction: "OUT", amount: 1000, accountId: safeId, comment: "" })).rejects.toThrow(/комментарий/);
    await shifts.moveCash(cashier, shift.id, { direction: "IN", amount: 5000, accountId: safeId, comment: "Размен" });
    const x = await shifts.moveCash(cashier, shift.id, { direction: "OUT", amount: 10000, accountId: safeId, comment: "Инкассация в сейф" });
    expect(x.cashMoves.map((m) => [m.amount, m.counterpart, m.comment])).toEqual([
      [5000, "Сейф", "Размен"],
      [-10000, "Сейф", "Инкассация в сейф"],
    ]);
    // 20 000 + 2 400 + 5 000 − 10 000
    expect(x.expectedCash).toBe(17400);
    expect((await prisma.cashAccount.findUniqueOrThrow({ where: { id: safeId } })).currentBalance.toNumber()).toBe(105000);

    const z = await shifts.close(cashier, shift.id, { countedCash: 17000, note: "Не хватает 400" });
    expect(z).toMatchObject({ expectedCash: 17400, countedCash: 17000, difference: -400, note: "Не хватает 400" });
    const history = await shifts.list(org.user, org.storeId, new Date(Date.now() - 3600_000), new Date());
    expect(history.map((s) => [s.number, s.difference])).toEqual([
      [2, -400],
      [1, 0],
    ]);

    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.tillShifts.filter((a) => !logged.has(a))).toEqual([]);
  });
});
