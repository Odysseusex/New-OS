import { BakerNoteKind, BakerNoteStatus, LocationType, PaymentMethod, ProductType, Role, Unit, debtDateKey } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { AuthenticatedUser } from "../auth/auth.types";
import { pinDigest } from "../auth/till-pin";
import { LedgerService } from "../ledger/ledger.service";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { BalanceService } from "../finance/balance/balance.service";
import { MaterialRequisitionsService } from "../production/requisitions.service";
import { RecipesService } from "../recipes/recipes.service";
import { BakerNotesService } from "./baker-notes.service";
import { BakerDayService } from "./baker-day.service";
import { BakerAutoPostService } from "./baker-auto-post.service";

// «Проводить накладные пекарей сразу». The day of 26.11.2026: halves of a cake delivered in the morning
// were not on the shop's books at noon (the notes were posted at night), so a sale of a half «cut» a
// whole cake on paper. With the switch on a note posts itself, and the shop's books hold the halves.

const originalFiscal = process.env.FISCALIZATION_ENABLED;
const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const recipes = new RecipesService(prisma);
const notes = new BakerNotesService(prisma);
const requisitions = new MaterialRequisitionsService(prisma, services.costing);
const days = new BakerDayService(prisma, notes, services.production, requisitions, services.sales);
const auto = new BakerAutoPostService(prisma, notes, days, services.production, requisitions, services.sales, services.returns);

let org: IsolatedOrg;
let workshopId: string;
let customerId: string;
let baker: AuthenticatedUser;
let baker2: AuthenticatedUser;
let ids: { flour: string; cake: string; half: string; bread: string; orphan: string };
let n = 0;

const stock = async (productId: string, locationId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId } } }))?.quantity.toNumber() ?? 0;
const baked = async (productId: string) =>
  (
    await prisma.productionBatch.findMany({ where: { organizationId: org.organizationId, saleId: null, recipe: { productId } }, select: { actualQuantity: true } })
  ).reduce((s, b) => s + (b.actualQuantity?.toNumber() ?? 0), 0);
const debt = async () =>
  (await prisma.sale.findMany({ where: { organizationId: org.organizationId, customerId } })).reduce(
    (s, x) => s + x.totalAmount.toNumber() - x.amountPaid.toNumber() - x.creditedAmount.toNumber(),
    0,
  );
const toStore = (user: AuthenticatedUser, productId: string, quantity: number) =>
  notes.create(user, { kind: BakerNoteKind.DELIVERY, locationId: org.storeId, lines: [{ productId, quantity }] });
const setDelay = (delayMinutes: number, autoPost = true) => auto.saveSettings(org.user, { autoPost, delayMinutes });

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "baker-auto");
  const id = org.organizationId;
  await startLedger(ledger, org);
  workshopId = (await prisma.location.create({ data: { organizationId: id, name: "Цех", type: LocationType.BAKERY_PRODUCTION, city: "Тест", address: "—" } })).id;
  const product = (name: string, type: ProductType, price: number, unit: Unit = Unit.PCS) =>
    prisma.product.create({ data: { organizationId: id, name, sku: `BA-${++n}`, type, price, unit } });
  ids = {
    flour: (await product("Мука", ProductType.RAW_MATERIAL, 400, Unit.KG)).id,
    cake: (await product("Норвежский торт", ProductType.FINISHED_GOOD, 8000)).id,
    half: (await product("Норвежский торт 0.5", ProductType.FINISHED_GOOD, 4500)).id,
    bread: (await product("Хлеб", ProductType.FINISHED_GOOD, 300)).id,
    orphan: (await product("Пирожное без техкарты", ProductType.FINISHED_GOOD, 900)).id,
  };
  const supplier = await prisma.supplier.create({ data: { organizationId: id, name: "Поставщик муки" } });
  await services.procurement.activateCutover(org.user);
  const po = await services.procurement.create(org.user, { supplierId: supplier.id, locationId: workshopId, items: [{ productId: ids.flour, quantity: 500, unitCost: 400 }] } as never);
  await services.procurement.receive(org.user, po.id);
  const recipeOf = (productId: string, kg: number) => recipes.create(org.user, { productId, yieldQuantity: 1, items: [{ ingredientProductId: ids.flour, quantity: kg }] } as never);
  await recipeOf(ids.cake, 2);
  await recipeOf(ids.bread, 0.5);
  await recipes.setCutSource(org.user, ids.half, { sourceProductId: ids.cake, parts: 2 });
  customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Керемет Батыс" } })).id;

  const person = async (name: string, pin: string): Promise<AuthenticatedUser> => {
    const row = await prisma.user.create({
      data: { organizationId: id, fullName: name, email: `${pin}-${id}@iso.test`, passwordHash: "x", role: Role.PRODUCTION_STAFF, locationId: workshopId, pinDigest: pinDigest(id, pin) },
    });
    return { id: row.id, email: row.email, fullName: name, role: Role.PRODUCTION_STAFF, title: null, organizationId: id, regionId: null, locationId: workshopId };
  };
  baker = await person("Пекарь Гүлжамал", "4821");
  baker2 = await person("Кондитер Салтанат", "7730");

  // The shop has 2 whole cakes and no halves; the workshop has 2 whole cakes ready to be cut.
  await services.production.release(org.user, { locationId: workshopId, outputLocationId: org.storeId, lines: [{ productId: ids.cake, quantity: 2 }] });
  await services.production.release(org.user, { locationId: workshopId, lines: [{ productId: ids.cake, quantity: 2 }] });
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("is off by default: nothing posts by itself", async () => {
  const note = await toStore(baker, ids.bread, 4);
  expect(await auto.runDue()).toBe(0);
  expect((await notes.findOne(baker, note.id)).status).toBe(BakerNoteStatus.SENT);
  // Switching on does not sweep up what was sent before.
  await setDelay(0);
  expect(await auto.runDue()).toBe(0);
  await notes.cancel(baker, note.id);
});

it("a half sold BEFORE the note is posted still cuts a cake, as it always did", async () => {
  await setDelay(10);
  const note = await toStore(baker2, ids.half, 2);
  expect(await auto.runDue()).toBe(0); // the delay has not passed
  await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: ids.half, quantity: 1, unitPrice: 4500 }] } as never);
  expect([await stock(ids.half, org.storeId), await stock(ids.cake, org.storeId)]).toEqual([1, 1]);
  await notes.cancel(baker2, note.id);
});

it("26.11: the note posts itself, so the sale of a half takes a delivered half and cuts nothing", async () => {
  await setDelay(0);
  const cutsBefore = await prisma.productionBatch.count({ where: { organizationId: org.organizationId, saleId: { not: null } } });
  const note = await toStore(baker2, ids.half, 2);
  expect(await auto.runDue()).toBe(1);
  const posted = await notes.findOne(baker2, note.id);
  expect(posted.status).toBe(BakerNoteStatus.POSTED);
  expect(posted.postedByName).toBe("Автоматически");
  expect(posted.documents.map((d) => d.kind)).toEqual(["TRANSFER"]);
  const transfer = await prisma.materialRequisition.findFirstOrThrow({ where: { organizationId: org.organizationId, toLocationId: org.storeId }, orderBy: { createdAt: "desc" } });
  expect(transfer.note).toContain("автоматически (Кондитер Салтанат)");
  // The workshop cut one of its own cakes for the two halves.
  expect([await stock(ids.cake, workshopId), await stock(ids.half, workshopId)]).toEqual([1, 0]);
  expect([await stock(ids.half, org.storeId), await stock(ids.cake, org.storeId)]).toEqual([3, 1]);

  await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: ids.half, quantity: 1, unitPrice: 4500 }] } as never);
  expect([await stock(ids.half, org.storeId), await stock(ids.cake, org.storeId)]).toEqual([2, 1]);
  expect(await prisma.productionBatch.count({ where: { organizationId: org.organizationId, saleId: { not: null } } })).toBe(cutsBefore);
  // Nothing is posted twice.
  expect(await auto.runDue()).toBe(0);
});

it("a note that cannot be posted stays «Отправлена» with the reason and does not hold the others", async () => {
  const bad = await toStore(baker, ids.orphan, 3);
  const good = await toStore(baker, ids.bread, 30);
  expect(await auto.runDue()).toBe(1);
  const failed = await notes.findOne(baker, bad.id);
  expect(failed.status).toBe(BakerNoteStatus.SENT);
  expect(failed.autoPostFailed).toBe(true);
  expect(failed.postError).toMatch(/Нет действующей техкарты.*Пирожное без техкарты/);
  expect((await notes.findOne(baker, good.id)).status).toBe(BakerNoteStatus.POSTED);
  expect([await stock(ids.bread, org.storeId), await stock(ids.bread, workshopId)]).toEqual([30, 0]);
  // No second automatic attempt; a change by the baker arms it again.
  expect(await auto.runDue()).toBe(0);
  await notes.cancel(baker, bad.id);
});

it("a posted note to a point is corrected by a transfer for the difference", async () => {
  const day = await notes.day(baker, debtDateKey(new Date()));
  const note = day.notes.find((x) => x.lines[0]?.productId === ids.bread && x.status === BakerNoteStatus.POSTED)!;
  expect(note.correctable).toBe(true);
  await expect(auto.save(baker2, note.id, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: ids.bread, quantity: 31 }] })).rejects.toThrow();

  const plus = await auto.save(baker, note.id, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: ids.bread, quantity: 31 }] });
  expect(plus.lines[0].quantity).toBe(31);
  expect(plus.total).toBe(31 * 300);
  expect([await stock(ids.bread, org.storeId), await stock(ids.bread, workshopId), await baked(ids.bread)]).toEqual([31, 0, 31]);

  const minus = await auto.save(baker, note.id, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: ids.bread, quantity: 29 }] });
  expect(minus.status).toBe(BakerNoteStatus.POSTED);
  expect([await stock(ids.bread, org.storeId), await stock(ids.bread, workshopId), await baked(ids.bread)]).toEqual([29, 2, 31]);
  expect(minus.documents.map((d) => d.kind)).toEqual(["TRANSFER", "TRANSFER", "TRANSFER_BACK"]);
  expect(minus.revisions.map((r) => [r.byName, r.changes[0].before, r.changes[0].after])).toEqual([
    ["Пекарь Гүлжамал", 30, 31],
    ["Пекарь Гүлжамал", 31, 29],
  ]);
});

it("a posted note to a customer is corrected by another sale or a return; the debt follows", async () => {
  const note = await notes.create(baker, { kind: BakerNoteKind.DELIVERY, customerId, lines: [{ productId: ids.bread, quantity: 10 }] });
  expect(await auto.runDue()).toBe(1);
  // 2 loaves had come back to the workshop: only 8 are baked.
  expect([await baked(ids.bread), await stock(ids.bread, workshopId), await debt()]).toEqual([39, 0, 3000]);

  await auto.save(org.user, note.id, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: ids.bread, quantity: 11 }] });
  expect([await baked(ids.bread), await debt()]).toEqual([40, 3300]);

  const back = await auto.save(org.user, note.id, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: ids.bread, quantity: 9 }] });
  expect(back.lines[0].quantity).toBe(9);
  expect(back.total).toBe(2700);
  expect([await stock(ids.bread, workshopId), await debt()]).toEqual([2, 2700]);
  expect(back.documents.map((d) => d.kind)).toEqual(["SALE", "SALE", "SALE_RETURN", "SALE_RETURN"]);
  // No money moved: the debt was cancelled, nothing refunded.
  expect(await prisma.cashMovement.count({ where: { organizationId: org.organizationId, type: "SALE_REFUND" } })).toBe(0);
});

it("the night's «Провести день» bakes only the fridge, never again what went out during the day", async () => {
  await notes.create(baker, { kind: BakerNoteKind.FRIDGE, lines: [{ productId: ids.bread, quantity: 5 }] });
  const preview = await days.preview(org.user, debtDateKey(new Date()), workshopId);
  expect(preview.blockers).toEqual([]);
  expect(preview.documents).toEqual([]);
  const bread = preview.output.find((l) => l.productId === ids.bread)!;
  // 5 in the fridge, 2 already on the books → 3 to bake.
  expect([bread.shipped, bread.fridge, bread.onHand, bread.output]).toEqual([0, 5, 2, 3]);
  const before = await baked(ids.bread);
  await days.post(org.user, { day: preview.day, sourceLocationId: workshopId, signature: preview.signature });
  expect(await baked(ids.bread)).toBe(before + 3);
  expect(await stock(ids.bread, workshopId)).toBe(5);
});

it("switched off, a posted note cannot be changed any more", async () => {
  await setDelay(10, false);
  const day = await notes.day(org.user, debtDateKey(new Date()), workshopId);
  const note = day.notes.find((x) => x.status === BakerNoteStatus.POSTED)!;
  expect(day.autoPost).toBe(false);
  await expect(auto.save(org.user, note.id, { kind: BakerNoteKind.DELIVERY, lines: [{ productId: note.lines[0].productId, quantity: 1 }] })).rejects.toThrow("исправить её нельзя");
});

it("the books agree: stock, receivables and the general ledger", async () => {
  const reports = new LedgerReportsService(prisma, services.finance);
  const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), reports, ledger);
  const result = await diagnostics.run(org.organizationId);
  expect(result.checks.filter((c) => c.status !== "PASS")).toEqual([]);
});
