import { ProductType, Role, ShelfCountStatus, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { AuthenticatedUser } from "../auth/auth.types";
import { pathAllowedForRole } from "../common/role-scope";
import { businessDateOf, ReconciliationService } from "./reconciliation.service";
import { ShelfCountService } from "./shelf-count.service";

// «Пересчёт» on the cashiers' phones: two phones under one login add up per product, the sheet is blind,
// and «Отправить» puts the totals into the day's «Сверка дня» without touching its money or the stock.

const prisma = new PrismaService();
const services = buildServices(prisma);
const reconciliation = new ReconciliationService(prisma, services.costing);
const counts = new ShelfCountService(prisma, reconciliation);

let org: IsolatedOrg;
let counter: AuthenticatedUser;
let breadId: string;
let bunId: string;
const today = businessDateOf(new Date());
let n = 0;
const entry = (deviceId: string, productId: string, kind: "ADD" | "SET", quantity: number, clientId = `c${++n}`) =>
  counts.addEntry(counter, { clientId, deviceId, productId, kind, quantity });

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "shelf-count");
  const id = org.organizationId;
  const product = (name: string, sku: string) => prisma.product.create({ data: { organizationId: id, name, sku, type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } });
  breadId = (await product("Багет", "SC-1")).id;
  bunId = (await product("Булочка", "SC-2")).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 10 });
  const row = await prisma.user.create({ data: { organizationId: id, fullName: "Пересчёт Мерей", email: `count-${id}@iso.test`, passwordHash: "x", role: Role.SHELF_COUNTER, locationId: org.storeId } });
  counter = { id: row.id, email: row.email, fullName: row.fullName, role: Role.SHELF_COUNTER, title: null, organizationId: id, regionId: null, locationId: org.storeId };
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("the phone login reaches its own screen only, and the sheet says nothing of the books", async () => {
  expect(pathAllowedForRole(Role.SHELF_COUNTER, "/count/entries", "POST")).toBe(true);
  expect(pathAllowedForRole(Role.SHELF_COUNTER, "/reconciliation", "GET")).toBe(false);
  expect(pathAllowedForRole(Role.SHELF_COUNTER, "/sales", "GET")).toBe(false);
  const sheet = await counts.get(counter);
  expect(sheet.products.map((p) => p.name)).toEqual(expect.arrayContaining(["Багет", "Булочка"]));
  expect(JSON.stringify(sheet)).not.toMatch(/closing|opening|price|unitCost/);
  await expect(counts.get({ ...org.user, role: Role.OWNER })).rejects.toThrow("Пересчёт остатков");
});

it("two phones add up; a resent entry counts once; «Исправить» sets the total", async () => {
  await entry("phone-a", breadId, "ADD", 5, "same");
  await entry("phone-a", breadId, "ADD", 5, "same"); // bad signal: sent twice
  await entry("phone-b", breadId, "ADD", 3);
  await entry("phone-b", bunId, "ADD", 4);
  await entry("phone-a", bunId, "SET", 0); // «Нет на полке»
  const sheet = await counts.get(counter);
  const total = (id: string) => sheet.entries.filter((e) => e.productId === id).reduce((s, e) => s + e.quantity, 0);
  expect([total(breadId), total(bunId)]).toEqual([8, 0]);
  expect(sheet.entries.filter((e) => e.productId === breadId).map((e) => [e.deviceId, e.quantity])).toEqual([
    ["phone-a", 5],
    ["phone-b", 3],
  ]);
});

it("«Отправить» writes the totals into «Сверка дня», keeps its money, moves no stock and locks the sheet", async () => {
  await reconciliation.save(org.user, { locationId: org.storeId, date: today, countedCash: 12000, lines: [] });
  const sent = await counts.send(counter);
  expect(sent.status).toBe(ShelfCountStatus.SENT);
  const day = await reconciliation.get(org.user, org.storeId, today);
  expect(day.countedCash).toBe(12000);
  expect(day.lines.find((l) => l.productId === breadId)?.countedQuantity).toBe(8);
  expect(day.lines.find((l) => l.productId === bunId)?.countedQuantity).toBe(0);
  expect((await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: breadId } } })).quantity.toNumber()).toBe(10);
  await expect(entry("phone-a", breadId, "ADD", 1)).rejects.toThrow("уже отправлен");
  await expect(counts.send(counter)).rejects.toThrow("уже отправлен");
  expect(await counts.status(org.user, org.storeId, today)).toMatchObject({ status: ShelfCountStatus.SENT, countedProducts: 2, devices: 2 });
});

it("a manager can hand the sheet back; the next send replaces the phones' figures", async () => {
  await counts.reopen(org.user, org.storeId, today);
  await entry("phone-a", breadId, "SET", 9);
  await counts.send(counter);
  const day = await reconciliation.get(org.user, org.storeId, today);
  expect(day.lines.find((l) => l.productId === breadId)?.countedQuantity).toBe(9);
});
