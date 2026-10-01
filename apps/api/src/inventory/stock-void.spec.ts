import { PaymentMethod, ProductType, Role, SystemAccountKey as K, Unit, WriteOffReason } from "@bakery-os/shared";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { QualityService } from "../quality/quality.service";
import { LedgerService } from "../ledger/ledger.service";
import { FinancialEventProjector } from "../finance/events/projector";
import { checkLedgerConsistency } from "../finance/integrity/ledger-consistency";
import { StockVoidService } from "./stock-void.service";

// Аннулирование: a receipt that never happened + the write-off that only removed
// it. Stock is already right; the void takes the fictitious loss out of every
// figure without moving a single unit and without editing or deleting a row.

const prisma = new PrismaService();
const services = buildServices(prisma);
const voids = new StockVoidService(prisma);
const quality = new QualityService(prisma);
const ledger = new LedgerService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let spreadId: string; // the product the mistake was made on
let otherId: string;
let warehouseOther: string;
const pairA: string[] = []; // ids: receipt 100 + write-off 100, receipt 10 + write-off 10  (history, before the ledger)
const pairB: string[] = []; // after the ledger started
let from: Date;
let to: Date;

const lastMovement = async (type: string) =>
  (await prisma.stockMovement.findFirstOrThrow({ where: { organizationId: org.organizationId, productId: spreadId, type: type as never }, orderBy: { createdAt: "desc" } })).id;
const stockOf = async (productId = spreadId) =>
  (await prisma.stockLevel.findMany({ where: { organizationId: org.organizationId, productId } })).reduce((s, l) => s + l.quantity.toNumber(), 0);
const pnl = () => services.finance.getProfitAndLoss(org.organizationId, from, to);
const mistake = async (quantity: number, into: string[]) => {
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: spreadId, quantity, reason: "Приход по ошибке" });
  into.push(await lastMovement("RECEIPT"));
  await services.inventory.writeOff(org.user, { locationId: org.storeId, productId: spreadId, quantity, writeOffReason: WriteOffReason.OTHER, reason: "Убираем фиктивный остаток" } as never);
  into.push(await lastMovement("WRITE_OFF"));
};

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "stock-void");
  const mk = (data: object) => prisma.product.create({ data: { organizationId: org.organizationId, unit: Unit.KG, type: ProductType.RAW_MATERIAL, ...data } as never });
  spreadId = (await mk({ name: "Спред растительно-сливочный «Пастушье 80» 82,5%, 12 кг", sku: "V-1", price: 100 })).id;
  otherId = (await mk({ name: "Масло", sku: "V-2", price: 50 })).id;
  warehouseOther = org.warehouseId;
  // History: two mistakes, as in real life (100 and 10).
  await mistake(100, pairA);
  await mistake(10, pairA);
  from = new Date(Date.now() - 3600_000);
  to = new Date(Date.now() + 3600_000);
});

afterAll(async () => {
  if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
  else process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("before the void: the mistake costs money on paper", () => {
  it("stock is already right (0), yet the P&L carries the write-offs as a loss", async () => {
    expect(await stockOf()).toBe(0);
    expect((await pnl()).inventoryLosses).toBe(11000); // (100 + 10) × 100
    expect((await quality.getSummary(org.user, from, to)).totalValue).toBe(11000);
  });

  it("lists the receipts and write-offs that can be selected, with the reason when one cannot", async () => {
    const list = await voids.candidates(org.user, spreadId);
    expect(list).toHaveLength(4);
    expect(list.every((c) => c.blockedReason === null && !c.voided)).toBe(true);
  });
});

describe("checking a selection", () => {
  it("a write-off alone does not net to zero — refused with the numbers", async () => {
    const preview = await voids.preview(org.user, { productId: spreadId, movementIds: [pairA[1]] });
    expect(preview.allowed).toBe(false);
    expect(preview.problems.join(" ")).toMatch(/не гасят друг друга/);
    expect(preview.problems.join(" ")).toMatch(/Нужны и приход, и списание/);
  });

  it("a receipt and a write-off of DIFFERENT size are refused", async () => {
    const preview = await voids.preview(org.user, { productId: spreadId, movementIds: [pairA[0], pairA[3]] }); // receipt 100, write-off 10
    expect(preview.allowed).toBe(false);
    expect(preview.locations[0]).toMatchObject({ received: 100, writtenOff: 10, net: 90 });
  });

  it("the whole history, balanced, is allowed and says exactly how much loss it removes", async () => {
    const preview = await voids.preview(org.user, { productId: spreadId, movementIds: pairA });
    expect(preview).toMatchObject({ allowed: true, problems: [], lossRemoved: 11000, writeOffsWithoutStampedCost: 0 });
    expect(preview.locations).toEqual([expect.objectContaining({ received: 110, writtenOff: 110, net: 0 })]);
  });

  it("another product, another organization's id and an unknown id are refused", async () => {
    const stray = await prisma.stockMovement.create({ data: { organizationId: org.organizationId, locationId: org.storeId, productId: otherId, type: "RECEIPT", quantity: 1, createdById: org.user.id } });
    expect((await voids.preview(org.user, { productId: spreadId, movementIds: [pairA[0], stray.id] })).problems.join(" ")).toMatch(/одному товару/);
    expect((await voids.preview(org.user, { productId: spreadId, movementIds: [...pairA, "no-such-id"] })).problems.join(" ")).toMatch(/не найдена/);
  });

  it("a receipt that has a purchase document behind it needs a supplier return, not a void", async () => {
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "П" } });
    const order = await services.procurement.create(org.user, { supplierId: supplier.id, locationId: org.storeId, items: [{ productId: spreadId, quantity: 5, unitCost: 100 }] } as never);
    await services.procurement.receive(org.user, order.id);
    const receipt = await prisma.stockMovement.findFirstOrThrow({ where: { purchaseOrderId: order.id } });
    const preview = await voids.preview(org.user, { productId: spreadId, movementIds: [receipt.id] });
    expect(preview.problems.join(" ")).toMatch(/закупочный документ/);
    // …and it stays blocked in the candidate list.
    expect((await voids.candidates(org.user, spreadId)).find((c) => c.id === receipt.id)?.blockedReason).toMatch(/возврат поставщику/);
    // Put the order's goods back to a clean slate for the rest of the suite.
    await services.inventory.writeOff(org.user, { locationId: org.storeId, productId: spreadId, quantity: 5, writeOffReason: WriteOffReason.OTHER } as never);
  });
});

describe("annulling", () => {
  it("only the owner or an admin may", async () => {
    const cashier = { ...org.user, role: Role.CASHIER };
    await expect(voids.create(cashier, { productId: spreadId, movementIds: pairA, reason: "Ошибка прихода" })).rejects.toThrow(/только владелец или администратор/);
    await expect(voids.candidates(cashier, spreadId)).rejects.toThrow(/только владелец/);
  });

  it("a reason is required", async () => {
    await expect(voids.create(org.user, { productId: spreadId, movementIds: pairA, reason: "  " })).rejects.toThrow(/причину/);
  });

  it("a closed month cannot be changed under its frozen report", async () => {
    const now = new Date();
    const periodId = (
      await prisma.financialPeriod.upsert({
        where: { organizationId_year_month: { organizationId: org.organizationId, year: now.getFullYear(), month: now.getMonth() + 1 } },
        update: { status: "CLOSED" },
        create: { organizationId: org.organizationId, year: now.getFullYear(), month: now.getMonth() + 1, periodStart: now, periodEnd: now, status: "CLOSED" },
      })
    ).id;
    try {
      await expect(voids.create(org.user, { productId: spreadId, movementIds: pairA, reason: "Ошибка прихода" })).rejects.toThrow(/закрыт.*переоткрывает/s);
    } finally {
      await prisma.financialPeriod.update({ where: { id: periodId }, data: { status: "OPEN" } });
    }
  });

  it("annuls the pair: no stock moves, no row is touched, the loss disappears everywhere", async () => {
    const before = {
      rows: await prisma.stockMovement.findMany({ where: { organizationId: org.organizationId, productId: spreadId }, orderBy: { id: "asc" } }),
      stock: await stockOf(),
    };
    const result = await voids.create(org.user, { productId: spreadId, movementIds: pairA, reason: "Приход был ошибочным: товара физически не было" });
    expect(result).toMatchObject({ productName: expect.stringContaining("Пастушье"), lossRemoved: 11000 });
    expect(result.movements).toHaveLength(4);

    // Not a single movement added, edited or deleted; stock untouched.
    const after = await prisma.stockMovement.findMany({ where: { organizationId: org.organizationId, productId: spreadId }, orderBy: { id: "asc" } });
    expect(after).toEqual(before.rows);
    expect(await stockOf()).toBe(before.stock);
    // (The fixture's hand-made stray row for ANOTHER product has no stock level; only this product is asserted.)
    expect((await checkLedgerConsistency(prisma, org.organizationId)).stock.drifts.filter((d) => d.productId === spreadId)).toEqual([]);

    // The loss is gone from the P&L, the quality report, the movement summary and the event projection.
    // (What remains is the one unrelated 5 kg write-off made earlier in this suite: 5 × 100.)
    const report = await pnl();
    expect(report.inventoryLosses).toBe(500);
    expect(report.inventoryLossLines).toEqual([expect.objectContaining({ amount: 500, count: 1 })]);
    expect((await quality.getSummary(org.user, from, to)).totalValue).toBe(500);
    expect((await quality.findWriteOffs(org.user, undefined, from, to)).filter((m) => pairA.includes(m.id))).toEqual([]);
    const summary = await services.inventory.movementsSummary(org.user, from, to);
    expect(summary.find((r) => r.type === "WRITE_OFF")?.totalQuantity ?? 0).toBe(5); // only the unrelated 5 remains
    const events = await new FinancialEventProjector(prisma).project(org.organizationId);
    expect(events.filter((e) => pairA.some((id) => e.key === `stock:${id}`))).toEqual([]);

    // The stock history still shows them, marked.
    const history = await services.inventory.getMovements(org.user, undefined, 200);
    expect(history.filter((m) => pairA.includes(m.id)).every((m) => m.voided === true)).toBe(true);
    expect(history.filter((m) => !pairA.includes(m.id)).every((m) => !m.voided)).toBe(true);
  });

  it("is on the audit trail with who, what and why", async () => {
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: org.organizationId, action: "stockVoid.create" } });
    expect(entry.actorId).toBe(org.user.id);
    expect(entry.reason).toMatch(/физически не было/);
    expect((entry.after as { movements: unknown[]; lossRemoved: number }).movements).toHaveLength(4);
    expect(AUDIT_ACTION_GROUPS.stockVoid).toEqual(["stockVoid.create"]);
    expect(await voids.list(org.user, spreadId)).toHaveLength(1);
  });

  it("cannot be done twice, and two simultaneous attempts produce one", async () => {
    await expect(voids.create(org.user, { productId: spreadId, movementIds: pairA, reason: "Ещё раз пробуем" })).rejects.toThrow(/Уже аннулировано/);
    const fresh: string[] = [];
    await mistake(7, fresh);
    const outcomes = await Promise.allSettled([1, 2, 3].map((n) => voids.create(org.user, { productId: spreadId, movementIds: fresh, reason: `Попытка номер ${n}` })));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.stockVoidLine.count({ where: { movementId: { in: fresh } } })).toBe(2);
  });

  it("a movement of the pair can never be selected again once annulled", async () => {
    const candidates = await voids.candidates(org.user, spreadId);
    expect(candidates.filter((c) => pairA.includes(c.id)).every((c) => c.voided && c.blockedReason === "Уже аннулировано")).toBe(true);
  });
});

describe("with the general ledger on", () => {
  it("an entry already posted for an annulled write-off is cancelled by a reversal; an unclassified receipt is closed out", async () => {
    await startLedger(ledger, org, 0);
    await new Promise((r) => setTimeout(r, 30));
    await mistake(40, pairB);
    // The write-off is in the book as a loss; the receipt (no document) waits, one-sided.
    expect(await glBalance(ledger, org, K.INVENTORY_LOSSES)).toBe(4000);
    const receiptEvent = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventKey: `stock:${pairB[0]}` } });
    expect(receiptEvent.status).toBe("NOT_POSTED");

    await voids.create(org.user, { productId: spreadId, movementIds: pairB, reason: "Ошибочный приход после запуска книги" });

    expect(await glBalance(ledger, org, K.INVENTORY_LOSSES)).toBe(0);
    expect(await glBalance(ledger, org, K.INVENTORY)).toBe(0);
    const writeOffEvent = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventKey: `stock:${pairB[1]}` } });
    expect(writeOffEvent.status).toBe("REVERSED");
    const closed = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventKey: `stock:${pairB[0]}` } });
    expect(closed).toMatchObject({ status: "NO_GL_EFFECT", statusReason: "SOURCE_CANCELLED" });
    // The original entry is untouched; a reversal sits beside it.
    expect(await prisma.journalEntry.count({ where: { organizationId: org.organizationId, kind: "REVERSAL" } })).toBe(1);
    expect((await ledger.getTrialBalance(org.organizationId, {})).totals.balanced).toBe(true);
  });

  it("history from before the ledger started is annulled without touching the book at all", async () => {
    expect(await prisma.journalEntry.count({ where: { organizationId: org.organizationId, accountingEvent: { sourceId: { in: pairA } } } })).toBe(0);
  });
});

describe("an ordinary sale line of the same product is not affected", () => {
  it("annulling movements never changes what real sales cost", async () => {
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: otherId, quantity: 10 });
    const finished = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Хлеб", sku: "V-3", unit: Unit.PCS, type: "FINISHED_GOOD", price: 500 } });
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: finished.id, quantity: 5 });
    const before = (await pnl()).revenue;
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: finished.id, quantity: 1, unitPrice: 500 }] } as never);
    expect((await pnl()).revenue).toBe(before + 500);
    expect(warehouseOther).toBeTruthy();
  });
});
