import { JwtService } from "@nestjs/jwt";
import { BakerNoteKind, BakerNoteStatus, LocationType, ProductType, Role, Unit, debtDateKey } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { AuthenticatedUser } from "../auth/auth.types";
import { AuthService } from "../auth/auth.service";
import { pinDigest, resetPinThrottle } from "../auth/till-pin";
import { MaterialRequisitionsService } from "../production/requisitions.service";
import { BakerNotesService } from "./baker-notes.service";
import { BakerDayService } from "./baker-day.service";
import { PrintJobsService } from "./print-jobs.service";

// «Накладные пекарей»: a baker's note is a draft with the right price put in by the server; it moves
// nothing until «Провести день», which bakes exactly «отгружено + холодильник − что было», then makes a
// transfer per point and a sale on account per wholesale customer.

process.env.FISCALIZATION_ENABLED = "false";
const prisma = new PrismaService();
const services = buildServices(prisma);
const notes = new BakerNotesService(prisma);
const printJobs = new PrintJobsService(prisma, notes);
const days = new BakerDayService(prisma, notes, services.production, new MaterialRequisitionsService(prisma, services.costing), services.sales);
const auth = new AuthService(prisma, new JwtService({ secret: process.env.JWT_SECRET ?? "dev-secret-change-me", signOptions: { expiresIn: "8h" } }));

let org: IsolatedOrg;
let workshopId: string;
let flourId: string;
let breadId: string;
let bunId: string;
let cakeId: string;
let customerId: string;
let baker: AuthenticatedUser;
let baker2: AuthenticatedUser;
const today = debtDateKey(new Date());
const level = async (locationId: string, productId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId } } }))?.quantity.toNumber() ?? 0;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "baker-notes");
  const id = org.organizationId;
  workshopId = (await prisma.location.create({ data: { organizationId: id, name: "Цех", type: LocationType.BAKERY_PRODUCTION, city: "Тест", address: "—" } })).id;
  const product = (name: string, sku: string, type: ProductType, price: number, unit: Unit) =>
    prisma.product.create({ data: { organizationId: id, name, sku, type, price, unit } });
  flourId = (await product("Мука", "BN-1", ProductType.RAW_MATERIAL, 400, Unit.KG)).id;
  breadId = (await product("Хлеб", "BN-2", ProductType.FINISHED_GOOD, 300, Unit.PCS)).id;
  bunId = (await product("Булочка с маком", "BN-3", ProductType.FINISHED_GOOD, 200, Unit.PCS)).id;
  cakeId = (await product("Торт без техкарты", "BN-4", ProductType.FINISHED_GOOD, 5000, Unit.PCS)).id;
  await prisma.recipe.create({ data: { organizationId: id, productId: breadId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 5 }] } } });
  await prisma.recipe.create({ data: { organizationId: id, productId: bunId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 1 }] } } });
  customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Керемет Батыс" } })).id;
  // The shop sells bread at 320; the wholesale customer has an agreed 250.
  await prisma.productLocationPrice.create({ data: { organizationId: id, productId: breadId, locationId: org.storeId, price: 320 } });
  await prisma.standingOrderLine.create({ data: { organizationId: id, customerId, productId: breadId, quantity: 0, unitPrice: 250 } });
  await services.inventory.receive(org.user, { locationId: workshopId, productId: flourId, quantity: 100, unitPrice: 400 });
  // Yesterday's fridge: 10 loaves on the workshop's books.
  await services.inventory.receive(org.user, { locationId: workshopId, productId: breadId, quantity: 10 });

  const person = async (name: string, email: string, pin: string): Promise<AuthenticatedUser> => {
    const row = await prisma.user.create({
      data: { organizationId: id, fullName: name, email, passwordHash: "hash-" + name, role: Role.PRODUCTION_STAFF, locationId: workshopId, pinDigest: pinDigest(id, pin) },
    });
    return { id: row.id, email: row.email, fullName: name, role: Role.PRODUCTION_STAFF, title: null, organizationId: id, regionId: null, locationId: workshopId };
  };
  baker = await person("Пекарь Айгуль", `baker1-${id}@iso.test`, "4821");
  baker2 = await person("Пекарь Марат", `baker2-${id}@iso.test`, "7730");
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

let shopNoteId: string;
let customerNoteId: string;

it("the catalogue gives recipients, real products and each recipient's prices", async () => {
  const catalog = await notes.catalog(baker);
  expect(catalog.sourceLocationId).toBe(workshopId);
  expect(catalog.recipients.map((r) => `${r.kind}:${r.name}`)).toEqual(["location:Точка А", "customer:Керемет Батыс"]);
  expect(catalog.products.map((p) => p.name)).toEqual(["Булочка с маком", "Торт без техкарты", "Хлеб"]);
  expect(catalog.prices[`location:${org.storeId}`]).toEqual({ [breadId]: 320 });
  expect(catalog.prices[`customer:${customerId}`]).toEqual({ [breadId]: 250 });
  expect(catalog.seesAll).toBe(false);
});

it("a note takes the point's price or the customer's agreed price and moves no stock", async () => {
  const shop = await notes.create(baker, { kind: BakerNoteKind.DELIVERY, locationId: org.storeId, lines: [{ productId: breadId, quantity: 30 }, { productId: bunId, quantity: 20 }] });
  expect(shop.lines.map((l) => [l.productName, l.quantity, l.unitPrice, l.subtotal])).toEqual([
    ["Хлеб", 30, 320, 9600],
    ["Булочка с маком", 20, 200, 4000],
  ]);
  expect(shop.total).toBe(13600);
  expect(shop.status).toBe(BakerNoteStatus.SENT);
  const wholesale = await notes.create(baker2, { kind: BakerNoteKind.DELIVERY, customerId, lines: [{ productId: breadId, quantity: 30 }] });
  expect(wholesale.lines[0].unitPrice).toBe(250);
  expect(wholesale.number).toBe(shop.number + 1);
  shopNoteId = shop.id;
  customerNoteId = wholesale.id;
  expect(await level(workshopId, breadId)).toBe(10);
  expect(await level(org.storeId, breadId)).toBe(0);
  expect(await prisma.sale.count({ where: { organizationId: org.organizationId } })).toBe(0);
});

it("refuses a product that is not sellable goods, a product twice and a note with no recipient", async () => {
  await expect(notes.create(baker, { kind: BakerNoteKind.DELIVERY, customerId, lines: [{ productId: flourId, quantity: 1 }] })).rejects.toThrow(/нет в программе/);
  await expect(
    notes.create(baker, { kind: BakerNoteKind.DELIVERY, customerId, lines: [{ productId: breadId, quantity: 1 }, { productId: breadId, quantity: 2 }] }),
  ).rejects.toThrow(/дважды/);
  await expect(notes.create(baker, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 1 }] })).rejects.toThrow(/получателя/);
  await expect(notes.create(baker, { kind: BakerNoteKind.DELIVERY, customerId, lines: [] })).rejects.toThrow(/хотя бы один/);
});

it("a baker corrects only their own note; the operator sees and corrects every note", async () => {
  await expect(notes.update(baker, customerNoteId, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 1 }] })).rejects.toThrow(/другого пекаря/);
  const fixed = await notes.update(baker2, customerNoteId, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 40 }] });
  expect(fixed.total).toBe(10000);
  expect((await notes.day(baker)).notes.map((n) => n.id)).toEqual([shopNoteId]);
  const all = await notes.day(org.user, today, workshopId);
  expect(all.notes.map((n) => n.id)).toEqual([shopNoteId, customerNoteId]);
  expect(all.notes.every((n) => n.editable)).toBe(true);
});

it("the door laptop («Выдача накладных») reads every note of the workshop but changes none", async () => {
  const row = await prisma.user.create({
    data: { organizationId: org.organizationId, fullName: "Выдача", email: `dispatch-${org.organizationId}@iso.test`, passwordHash: "hash-d", role: Role.DISPATCHER, locationId: org.storeId },
  });
  const door: AuthenticatedUser = { id: row.id, email: row.email, fullName: "Выдача", role: Role.DISPATCHER, title: null, organizationId: org.organizationId, regionId: null, locationId: org.storeId };
  // Tied to a shop, it still reads the workshop's day (it picks a workshop like an org-wide role).
  const day = await notes.day(door, today);
  expect(day.sourceLocationId).toBe(workshopId);
  expect(day.notes.map((n) => n.id)).toEqual([shopNoteId, customerNoteId]);
  expect(day.notes.some((n) => n.editable)).toBe(false);
  expect((await notes.findOne(door, customerNoteId)).editable).toBe(false);
  await expect(notes.update(door, customerNoteId, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 1 }] })).rejects.toThrow(/другого пекаря/);
  await expect(notes.cancel(door, customerNoteId)).rejects.toThrow(/другого пекаря/);
});

it("«На ноутбук выдачи»: a request from the office is printed by the door laptop exactly once", async () => {
  const row = await prisma.user.create({
    data: { organizationId: org.organizationId, fullName: "Ноутбук", email: `door-${org.organizationId}@iso.test`, passwordHash: "hash-n", role: Role.DISPATCHER, locationId: org.storeId },
  });
  const door: AuthenticatedUser = { id: row.id, email: row.email, fullName: "Ноутбук", role: Role.DISPATCHER, title: null, organizationId: org.organizationId, regionId: null, locationId: org.storeId };
  expect(printJobs.laptop(org.user).laptopSeenAt).toBeNull();
  const job = await printJobs.create(org.user, { noteIds: [customerNoteId, shopNoteId], pack: true });
  expect(job.claimedAt).toBeNull();
  await expect(printJobs.create(org.user, { noteIds: ["no-such-note"], pack: false })).rejects.toThrow(/не найдена/);

  const pending = await printJobs.pending(door);
  expect(pending.map((j) => j.id)).toEqual([job.id]);
  // The notes come in the order they were sent, with everything the накладная needs.
  expect(pending[0].notes.map((n) => n.id)).toEqual([customerNoteId, shopNoteId]);
  expect(pending[0].pack).toBe(true);
  expect(printJobs.laptop(org.user).laptopSeenAt).not.toBeNull();

  expect(await printJobs.claim(door, job.id)).toEqual({ claimed: true });
  expect(await printJobs.claim(door, job.id)).toEqual({ claimed: false });
  expect(await printJobs.pending(door)).toEqual([]);
  expect((await printJobs.findOne(org.user, job.id)).claimedAt).not.toBeNull();

  // The laptop's print reads «Напечатана» on both notes; a baker's later edit reads «Изменена после печати».
  const printed = await notes.day(org.user, today, workshopId);
  const shopAfter = printed.notes.find((n) => n.id === shopNoteId)!;
  expect(shopAfter.printCount).toBe(1);
  expect(shopAfter.printedByName).toBe("Ноутбук");
  expect(shopAfter.changedSincePrint).toBe(false);
  await notes.markPrinted(org.user, [shopNoteId]);
  expect((await notes.findOne(org.user, shopNoteId)).printCount).toBe(2);
  const edited = await notes.update(org.user, customerNoteId, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 41 }] });
  expect(edited.changedSincePrint).toBe(true);
  // Back as it was (the tests below count on 40), and the same lines read as printed again.
  const restored = await notes.update(org.user, customerNoteId, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 40 }] });
  expect(restored.changedSincePrint).toBe(false);

  // A request nobody printed for hours is not printed the next morning.
  const old = await printJobs.create(org.user, { noteIds: [shopNoteId], pack: false });
  await prisma.printJob.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 3 * 3600_000) } });
  expect(await printJobs.pending(door)).toEqual([]);
});

it("«Холодильник на завтра» is one sheet per day: saving again replaces it", async () => {
  const first = await notes.create(baker, { kind: BakerNoteKind.FRIDGE, lines: [{ productId: breadId, quantity: 8 }] });
  const second = await notes.create(baker2, { kind: BakerNoteKind.FRIDGE, lines: [{ productId: breadId, quantity: 5 }] });
  expect(second.id).toBe(first.id);
  expect((await notes.day(baker)).fridge?.lines.map((l) => l.quantity)).toEqual([5]);
});

it("the preview: output = shipped + fridge − what the books held, with the flour it takes", async () => {
  const preview = await days.preview(org.user, today, workshopId);
  expect(preview.output.map((l) => [l.productName, l.shipped, l.fridge, l.onHand, l.output])).toEqual([
    ["Булочка с маком", 20, 0, 0, 20],
    ["Хлеб", 70, 5, 10, 65],
  ]);
  expect(preview.release?.materials.map((m) => [m.name, m.quantity, m.shortage])).toEqual([["Мука", 34.5, 0]]);
  expect(preview.documents.map((d) => [d.recipient.name, d.total])).toEqual([["Точка А", 13600], ["Керемет Батыс", 10000]]);
  expect(preview.blockers).toEqual([]);
  expect(await prisma.productionBatch.count({ where: { organizationId: org.organizationId } })).toBe(0);
});

it("a product with no техкарта or not enough flour stops the day before anything is written", async () => {
  const extra = await notes.create(baker, { kind: BakerNoteKind.DELIVERY, customerId, lines: [{ productId: cakeId, quantity: 1 }] });
  let preview = await days.preview(org.user, today, workshopId);
  expect(preview.blockers.join(" ")).toMatch(/Нет действующей техкарты: Торт без техкарты/);
  await expect(days.post(org.user, { day: today, sourceLocationId: workshopId, signature: preview.signature })).rejects.toThrow(/техкарты/);
  await notes.update(baker, extra.id, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 500 }] });
  preview = await days.preview(org.user, today, workshopId);
  expect(preview.blockers.join(" ")).toMatch(/Не хватает сырья на производстве: Мука/);
  await notes.cancel(baker, extra.id);
  expect(await prisma.productionBatch.count({ where: { organizationId: org.organizationId } })).toBe(0);
});

it("«Провести день» is refused when something changed after the preview", async () => {
  const preview = await days.preview(org.user, today, workshopId);
  await notes.update(baker, shopNoteId, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 30 }, { productId: bunId, quantity: 20 }] });
  await expect(days.post(org.user, { day: today, sourceLocationId: workshopId, signature: preview.signature })).rejects.toThrow(/изменились/);
});

it("«Провести день»: release, a transfer to the shop, a sale on account at the note's prices", async () => {
  const preview = await days.preview(org.user, today, workshopId);
  const result = await days.post(org.user, { day: today, sourceLocationId: workshopId, signature: preview.signature });
  expect(result.released?.batches).toBe(2);
  expect(result.notes.map((n) => [n.recipientName, n.ok])).toEqual([["Точка А", true], ["Керемет Батыс", true]]);
  expect(result.notes[0].message).toMatch(/^Перемещение № \d+$/);
  expect(result.notes[1].message).toMatch(/^Чек № \d+$/);

  // The workshop keeps exactly the fridge; the shop has what its note said.
  expect(await level(workshopId, breadId)).toBe(5);
  expect(await level(workshopId, bunId)).toBe(0);
  expect(await level(org.storeId, breadId)).toBe(30);
  expect(await level(org.storeId, bunId)).toBe(20);
  expect(await level(workshopId, flourId)).toBe(65.5);

  const sale = await prisma.sale.findFirstOrThrow({ where: { organizationId: org.organizationId, customerId }, include: { items: true } });
  expect(sale.locationId).toBe(workshopId);
  expect(sale.totalAmount.toNumber()).toBe(10000);
  expect(sale.amountPaid.toNumber()).toBe(0);
  expect(sale.items.map((i) => [i.quantity.toNumber(), i.unitPrice.toNumber()])).toEqual([[40, 250]]);

  expect(result.day.notes.map((n) => [n.status, n.editable])).toEqual([[BakerNoteStatus.POSTED, false], [BakerNoteStatus.POSTED, false]]);
  expect(result.day.fridge?.status).toBe(BakerNoteStatus.POSTED);
  await expect(notes.update(baker, shopNoteId, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: breadId, quantity: 1 }] })).rejects.toThrow(/уже проведена/);
  await expect(notes.cancel(baker, shopNoteId)).rejects.toThrow(/уже проведена/);
});

it("a note sent after the day was posted bakes only its own goods on the next run", async () => {
  await expect(days.preview(org.user, today, workshopId)).resolves.toMatchObject({ blockers: [expect.stringMatching(/Нечего проводить/)] });
  await notes.create(baker, { kind: BakerNoteKind.DELIVERY, locationId: org.storeId, lines: [{ productId: breadId, quantity: 7 }] });
  const preview = await days.preview(org.user, today, workshopId);
  expect(preview.output.map((l) => [l.productName, l.shipped, l.fridge, l.onHand, l.output])).toEqual([["Хлеб", 7, 5, 5, 7]]);
  const result = await days.post(org.user, { day: today, sourceLocationId: workshopId, signature: preview.signature });
  expect(result.released?.batches).toBe(1);
  expect(await level(workshopId, breadId)).toBe(5);
  expect(await level(org.storeId, breadId)).toBe(37);
});

it("«Как вчера» returns the latest earlier note to the same recipient", async () => {
  expect((await notes.previous(baker, { locationId: org.storeId })).note).toBeNull();
  await prisma.bakerNote.update({ where: { id: shopNoteId }, data: { day: new Date(Date.now() - 2 * 86_400_000) } });
  expect((await notes.previous(baker, { customerId })).note).toBeNull();
  const { note } = await notes.previous(baker2, { locationId: org.storeId });
  expect(note?.id).toBe(shopNoteId);
  expect(note?.lines.map((l) => l.quantity)).toEqual([30, 20]);
  // A note of an earlier day that nobody posted is pointed out to whoever posts the day.
  const late = await notes.create(baker, { kind: BakerNoteKind.DELIVERY, customerId, lines: [{ productId: bunId, quantity: 3 }] });
  await prisma.bakerNote.update({ where: { id: late.id }, data: { day: new Date(Date.now() - 2 * 86_400_000) } });
  expect((await notes.day(org.user, today, workshopId)).pendingDays.map((p) => p.count)).toEqual([1]);
  expect((await notes.day(baker)).pendingDays).toEqual([]);
  expect((await notes.previous(baker, { customerId })).note?.id).toBe(late.id);
});

it("a baker's phone: connected once, then opened with any baker's PIN — and by nobody else's", async () => {
  resetPinThrottle();
  const { deviceToken } = await auth.bakerDevice(baker);
  const mine = await auth.bakerPinLogin(deviceToken, "4821");
  expect(mine.user.fullName).toBe("Пекарь Айгуль");
  expect((await auth.bakerPinLogin(deviceToken, "7730")).user.fullName).toBe("Пекарь Марат");
  await expect(auth.bakerPinLogin(deviceToken, "0000")).rejects.toThrow(/Неверный PIN/);
  // The owner's PIN does not open a baker's phone, and an ordinary login token is not a device key.
  await prisma.user.update({ where: { id: org.user.id }, data: { pinDigest: pinDigest(org.organizationId, "9911") } });
  await expect(auth.bakerPinLogin(deviceToken, "9911")).rejects.toThrow(/не у пекаря/);
  await expect(auth.bakerPinLogin(mine.accessToken, "4821")).rejects.toThrow(/подключить заново/);
  await expect(auth.bakerDevice(org.user)).rejects.toThrow(/только для пекаря/);
  // A changed password switches the phone off.
  await prisma.user.update({ where: { id: baker.id }, data: { passwordHash: "another" } });
  await expect(auth.bakerPinLogin(deviceToken, "4821")).rejects.toThrow(/подключить заново/);
});
