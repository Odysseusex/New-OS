import { BAKER_DAY_ROLES, LocationType, Role, SupplierIntakePayment, SupplierIntakeStatus } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { AuthenticatedUser } from "../auth/auth.types";
import { ROLES_KEY } from "../common/decorators/roles.decorator";
import { pathAllowedForRole } from "../common/role-scope";
import { NotificationsService } from "../notifications/notifications.service";
import { InventoryService } from "../inventory/inventory.service";
import { CustomersService } from "../customers/customers.service";
import { BakerController } from "./baker.controller";
import { SupplierIntakesService } from "./supplier-intakes.service";

// «Приход от поставщика»: a baker's photographs of a supplier's накладная are a DRAFT — no stock, no
// money, no debt. «Помощник» reads the waiting ones with their pictures through the API and marks each
// «Проведён» (naming the document) or «Отклонён» (with a reason); a baker cannot mark anything.

const prisma = new PrismaService();
const intakes = new SupplierIntakesService(prisma);
// A real 1×1 JPEG padded so it is not «too small to be a photo».
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1500, 7), Buffer.from([0xff, 0xd9])]);
const photo = `data:image/jpeg;base64,${JPEG.toString("base64")}`;

let org: IsolatedOrg;
let workshopId: string;
let baker: AuthenticatedUser;
let baker2: AuthenticatedUser;
let assistant: AuthenticatedUser;
let orderId: string;

const person = async (name: string, role: Role, locationId: string | null): Promise<AuthenticatedUser> => {
  const row = await prisma.user.create({
    data: { organizationId: org.organizationId, fullName: name, email: `${role}-${Math.random().toString(36).slice(2)}@iso.test`, passwordHash: "x", role, locationId },
  });
  return { id: row.id, email: row.email, fullName: name, role, title: null, organizationId: org.organizationId, regionId: null, locationId };
};
const footprint = async () => {
  const id = org.organizationId;
  const [movements, levels, cash, orders, expenses, journal] = await Promise.all([
    prisma.stockMovement.count({ where: { organizationId: id } }),
    prisma.stockLevel.count({ where: { organizationId: id } }),
    prisma.cashMovement.count({ where: { organizationId: id } }),
    prisma.purchaseOrder.count({ where: { organizationId: id } }),
    prisma.expense.count({ where: { organizationId: id } }),
    prisma.journalEntry.count({ where: { organizationId: id } }),
  ]);
  return { movements, levels, cash, orders, expenses, journal };
};

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "supplier-intakes");
  workshopId = (await prisma.location.create({ data: { organizationId: org.organizationId, name: "Производство", type: LocationType.BAKERY_PRODUCTION, city: "Тест", address: "—" } })).id;
  baker = await person("Гулжамал апа", Role.PRODUCTION_STAFF, workshopId);
  baker2 = await person("Салтанат", Role.PRODUCTION_STAFF, workshopId);
  assistant = await person("Помощник", Role.ASSISTANT, null);
  const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Мукомол" } });
  orderId = (await prisma.purchaseOrder.create({ data: { organizationId: org.organizationId, supplierId: supplier.id, locationId: workshopId, number: 7, totalCost: 0, createdById: org.user.id } })).id;
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

let firstId: string;
let secondId: string;

it("an intake with its photos is a draft: no stock, no money, no order, no entry", async () => {
  const before = await footprint();
  const created = await intakes.create(baker, { locationId: workshopId, payment: SupplierIntakePayment.KASPI, supplierName: " Мукомол ", total: 125000.5 });
  expect(created.status).toBe(SupplierIntakeStatus.UPLOADING);
  await expect(intakes.send(baker, created.id)).rejects.toThrow(/хотя бы одно фото/);
  await intakes.addPhoto(baker, created.id, photo);
  const withTwo = await intakes.addPhoto(baker, created.id, photo);
  expect(withTwo.photos).toHaveLength(2);
  const sent = await intakes.send(baker, created.id);
  expect(sent).toMatchObject({ status: SupplierIntakeStatus.SENT, locationName: "Производство", payment: SupplierIntakePayment.KASPI, supplierName: "Мукомол", total: 125000.5, createdByName: "Гулжамал апа" });
  expect(sent.photos[0].path).toBe(`/baker/intakes/${created.id}/photos/${sent.photos[0].id}`);
  await expect(intakes.addPhoto(baker, created.id, photo)).rejects.toThrow(/уже отправлен/);
  firstId = created.id;
  secondId = (await intakes.create(baker2, { locationId: org.storeId, payment: SupplierIntakePayment.CREDIT })).id;
  await intakes.addPhoto(baker2, secondId, photo);
  await intakes.send(baker2, secondId);
  expect(await footprint()).toEqual(before);
});

it("refuses what is not a photo, a ninth photo and a foreign point", async () => {
  const draft = await intakes.create(baker, { locationId: workshopId, payment: SupplierIntakePayment.CASH });
  await expect(intakes.addPhoto(baker, draft.id, "data:text/html;base64,PGI+")).rejects.toThrow(/не фотография/);
  await expect(intakes.addPhoto(baker2, draft.id, photo)).rejects.toThrow(/другого пекаря/);
  for (let i = 0; i < 8; i += 1) await intakes.addPhoto(baker, draft.id, photo);
  await expect(intakes.addPhoto(baker, draft.id, photo)).rejects.toThrow(/Не больше 8/);
  await expect(intakes.create(baker, { locationId: "no-such-point", payment: SupplierIntakePayment.CASH })).rejects.toThrow(/куда привезли/);
  // Never sent: nobody else sees it, and it is in no list.
  await expect(intakes.findOne(assistant, draft.id)).rejects.toThrow(/не найден/);
  expect((await intakes.list(assistant, { pending: "true" })).map((i) => i.id)).toEqual([firstId, secondId]);
});

it("a baker sees only their own intakes; the operator's roles see everyone's and get a notification", async () => {
  expect((await intakes.mine(baker)).map((i) => i.id)).toEqual([firstId]);
  await expect(intakes.findOne(baker, secondId)).rejects.toThrow(/другого пекаря/);
  await expect(intakes.photo(baker, secondId, "x")).rejects.toThrow(/другого пекаря/);
  expect((await intakes.list(org.user, {})).map((i) => i.id)).toEqual([secondId, firstId]);
  const notifications = new NotificationsService(prisma, new InventoryService(prisma), new CustomersService(prisma));
  const mine = (await notifications.getNotifications(org.user)).filter((n) => n.type === "SUPPLIER_INTAKE");
  expect(mine.map((n) => [n.title, n.message])).toEqual([
    ["Приход от Салтанат", "1 фото, Точка А, В долг"],
    ["Приход от Гулжамал апа", "2 фото, Производство, Kaspi · Мукомол"],
  ]);
  expect((await notifications.getNotifications(baker)).filter((n) => n.type === "SUPPLIER_INTAKE")).toEqual([]);
});

it("«Помощник» may reach these routes, reads the waiting intakes and their pictures", async () => {
  for (const [method, path] of [
    ["GET", "/api/baker/intakes?pending=true"],
    ["GET", `/api/baker/intakes/${firstId}`],
    ["GET", `/api/baker/intakes/${firstId}/photos/abc`],
    ["POST", `/api/baker/intakes/${firstId}/resolve`],
  ]) {
    expect([path, pathAllowedForRole(Role.ASSISTANT, path, method)]).toEqual([path, true]);
  }
  expect(pathAllowedForRole(Role.ASSISTANT, `/api/baker/intakes/${firstId}`, "DELETE")).toBe(false);
  const rolesOf = (method: keyof BakerController) => Reflect.getMetadata(ROLES_KEY, BakerController.prototype[method]) as Role[];
  expect(rolesOf("listIntakes")).toEqual(BAKER_DAY_ROLES);
  expect(rolesOf("resolveIntake")).toEqual(BAKER_DAY_ROLES);
  expect(BAKER_DAY_ROLES).toContain(Role.ASSISTANT);
  // A baker is not among those who mark an intake.
  expect(BAKER_DAY_ROLES).not.toContain(Role.PRODUCTION_STAFF);

  const waiting = await intakes.list(assistant, { pending: "true" });
  expect(waiting.map((i) => [i.number, i.createdByName, i.photos.length])).toEqual([
    [1, "Гулжамал апа", 2],
    [2, "Салтанат", 1],
  ]);
  const picture = await intakes.photo(assistant, firstId, waiting[0].photos[0].id);
  expect(picture.mime).toBe("image/jpeg");
  expect(picture.bytes.equals(JPEG)).toBe(true);
});

it("marking «Проведён» names the document, «Отклонён» needs a reason — once, and it still moves nothing", async () => {
  const before = await footprint();
  await expect(intakes.resolve(assistant, firstId, { status: SupplierIntakeStatus.POSTED })).rejects.toThrow(/Укажите документ/);
  await expect(intakes.resolve(assistant, firstId, { status: SupplierIntakeStatus.POSTED, purchaseOrderId: "nope" })).rejects.toThrow(/не найден/);
  const posted = await intakes.resolve(assistant, firstId, { status: SupplierIntakeStatus.POSTED, purchaseOrderId: orderId, document: "6 позиций" });
  expect(posted).toMatchObject({ status: SupplierIntakeStatus.POSTED, document: "Заказ поставщику № 7 · 6 позиций", purchaseOrderId: orderId, resolvedByName: "Помощник" });
  await expect(intakes.resolve(assistant, firstId, { status: SupplierIntakeStatus.REJECTED, reason: "передумал" })).rejects.toThrow(/уже отмечен/);

  await expect(intakes.resolve(assistant, secondId, { status: SupplierIntakeStatus.REJECTED, reason: " " })).rejects.toThrow(/причину/);
  const rejected = await intakes.resolve(assistant, secondId, { status: SupplierIntakeStatus.REJECTED, reason: "Фото смазано, не видно цен" });
  expect(rejected).toMatchObject({ status: SupplierIntakeStatus.REJECTED, rejectReason: "Фото смазано, не видно цен", document: null });
  // The baker reads the outcome in their own list.
  expect((await intakes.mine(baker2)).map((i) => [i.status, i.rejectReason])).toEqual([[SupplierIntakeStatus.REJECTED, "Фото смазано, не видно цен"]]);
  expect(await intakes.list(assistant, { pending: "true" })).toEqual([]);
  expect(await footprint()).toEqual(before);
  expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: { in: ["supplierIntake.send", "supplierIntake.resolve"] } } })).toBe(4);
});
