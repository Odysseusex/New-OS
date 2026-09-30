import { PaymentMethod, WriteOffReason } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { checkLedgerConsistency } from "../finance/integrity/ledger-consistency";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";

// Stocktake: create → snapshot → count → review → approve/cancel. StockLevel is
// never edited directly; approval writes ADJUSTMENT movements, and what was
// sold or received while people counted is kept.

const prisma = new PrismaService();
const services = buildServices(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let n = 0;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "stocktake");
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

async function product(stock: number, extra: object = {}) {
  n += 1;
  const p = await prisma.product.create({
    data: {
      organizationId: org.organizationId,
      name: `Товар ${n}`,
      sku: `ST-${n}`,
      unit: "PCS",
      type: "FINISHED_GOOD",
      price: 100,
      ...extra,
    },
  });
  if (stock > 0) await services.inventory.receive(org.user, { locationId: org.storeId, productId: p.id, quantity: stock });
  return p.id;
}
const level = async (productId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: org.storeId, productId } } }))
    ?.quantity.toNumber() ?? 0;
const sell = (productId: string, quantity: number) =>
  services.sales.create(org.user, {
    locationId: org.storeId,
    paymentMethod: PaymentMethod.CASH,
    items: [{ productId, quantity, unitPrice: 100 }],
  });
async function counted(stocktakeId: string, values: Record<string, number | null>) {
  const st = await services.stocktake.findOne(org.user, stocktakeId);
  for (const line of st.lines) {
    if (line.productId in values) {
      await services.stocktake.updateLine(org.user, stocktakeId, line.id, { countedQuantity: values[line.productId] });
    }
  }
}
async function fresh() {
  const open = await prisma.stocktake.findMany({ where: { organizationId: org.organizationId, status: { in: ["COUNTING", "REVIEW"] } } });
  for (const s of open) await services.stocktake.cancel(org.user, s.id, "очистка перед тестом");
}

describe("stocktake", () => {
  it("snapshots stock, keeps interim sales, and approval writes signed ADJUSTMENTs only", async () => {
    await fresh();
    const short = await product(10);
    const surplus = await product(4);
    const same = await product(6);
    const st = await services.stocktake.create(org.user, { locationId: org.storeId });
    expect(st.status).toBe("COUNTING");
    expect(st.lines.find((l) => l.productId === short)?.systemQuantity).toBe(10);

    // Sales made WHILE people count.
    await sell(short, 2);
    expect(await level(short)).toBe(8);

    await counted(st.id, { [short]: 9, [surplus]: 7, [same]: 6 });
    await services.stocktake.submit(org.user, st.id);
    const before = await prisma.stockMovement.count({ where: { organizationId: org.organizationId } });
    const approved = await services.stocktake.approve(org.user, st.id);

    expect(approved.status).toBe("APPROVED");
    // 9 counted vs 10 in the snapshot = −1, applied to the CURRENT 8 → 7 (the interim sale survives).
    expect(await level(short)).toBe(7);
    expect(await level(surplus)).toBe(7);
    expect(await level(same)).toBe(6);
    // Two adjustments; the line with no difference wrote nothing.
    expect(await prisma.stockMovement.count({ where: { organizationId: org.organizationId } })).toBe(before + 2);
    const moves = await prisma.stockMovement.findMany({ where: { stocktakeId: st.id }, orderBy: { quantity: "asc" } });
    expect(moves.map((m) => [m.type, m.quantity.toNumber()])).toEqual([["ADJUSTMENT", -1], ["ADJUSTMENT", 3]]);
    expect(approved.lines.filter((l) => l.movementId).length).toBe(2);
    expect((await checkLedgerConsistency(prisma, org.organizationId)).stock.drifts).toEqual([]);
  });

  it("two simultaneous approvals: exactly one applies the count", async () => {
    await fresh();
    const p = await product(10);
    const st = await services.stocktake.create(org.user, { locationId: org.storeId });
    await counted(st.id, { [p]: 6 });
    await services.stocktake.submit(org.user, st.id);
    const results = await Promise.allSettled([
      services.stocktake.approve(org.user, st.id),
      services.stocktake.approve(org.user, st.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await level(p)).toBe(6);
    expect(await prisma.stockMovement.count({ where: { stocktakeId: st.id } })).toBe(1);
  });

  it("a shortage larger than what is left is refused and the WHOLE approval rolls back", async () => {
    await fresh();
    const p = await product(5);
    const other = await product(3);
    const st = await services.stocktake.create(org.user, { locationId: org.storeId });
    await sell(p, 5); // shelf is empty by the time the count is approved
    await counted(st.id, { [other]: 5, [p]: 4 }); // −1 on an empty shelf, +2 elsewhere
    await services.stocktake.submit(org.user, st.id);

    await expect(services.stocktake.approve(org.user, st.id)).rejects.toThrow("пересчитайте позицию");
    const after = await prisma.stocktake.findUniqueOrThrow({ where: { id: st.id } });
    expect(after.status).toBe("REVIEW");
    expect(await prisma.stockMovement.count({ where: { stocktakeId: st.id } })).toBe(0);
    expect(await level(other)).toBe(3);
    expect(await level(p)).toBe(0);
    await services.stocktake.cancel(org.user, st.id, "тест откатa");
  });

  it("guards the workflow: one open count per location, states in order, no negative counts", async () => {
    await fresh();
    const p = await product(2);
    const st = await services.stocktake.create(org.user, { locationId: org.storeId });
    await expect(services.stocktake.create(org.user, { locationId: org.storeId })).rejects.toThrow("уже идёт инвентаризация");
    await expect(services.stocktake.submit(org.user, st.id)).rejects.toThrow("Не посчитано");
    await expect(services.stocktake.approve(org.user, st.id)).rejects.toThrow("на проверке");
    const line = st.lines.find((l) => l.productId === p)!;
    await expect(services.stocktake.updateLine(org.user, st.id, line.id, { countedQuantity: -1 })).rejects.toThrow("отрицательным");
    await services.stocktake.updateLine(org.user, st.id, line.id, { countedQuantity: 2 });
    await services.stocktake.submit(org.user, st.id);
    await expect(services.stocktake.updateLine(org.user, st.id, line.id, { countedQuantity: 1 })).rejects.toThrow("во время подсчёта");
    const reopened = await services.stocktake.reopen(org.user, st.id);
    expect(reopened.status).toBe("COUNTING");
    const cancelled = await services.stocktake.cancel(org.user, st.id, "не нужна");
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "не нужна" });
    expect(await prisma.stockMovement.count({ where: { stocktakeId: st.id } })).toBe(0);
  });

  it("uncounted lines are ignored; a category filter limits the snapshot; untracked products are excluded", async () => {
    await fresh();
    const cat = await prisma.category.create({ data: { organizationId: org.organizationId, name: "Только эта" } });
    const inCat = await product(5, { categoryId: cat.id });
    const outCat = await product(5);
    await product(0, { trackInventory: false });
    const st = await services.stocktake.create(org.user, { locationId: org.storeId, categoryId: cat.id });
    expect(st.lines.map((l) => l.productId)).toEqual([inCat]);
    await counted(st.id, { [inCat]: null });
    await expect(services.stocktake.submit(org.user, st.id)).rejects.toThrow("Не посчитано");
    await services.stocktake.cancel(org.user, st.id, "проверка фильтра");

    const all = await services.stocktake.create(org.user, { locationId: org.storeId });
    expect(all.lines.some((l) => l.productId === outCat)).toBe(true);
    expect(all.lines.every((l) => l.sku.startsWith("ST-"))).toBe(true);
    await counted(all.id, { [outCat]: 5 });
    await services.stocktake.submit(org.user, all.id);
    const approved = await services.stocktake.approve(org.user, all.id);
    expect(await prisma.stockMovement.count({ where: { stocktakeId: all.id } })).toBe(0);
    expect(approved.status).toBe("APPROVED");
  });

  it("reports snapshot drift when the cached level disagrees with the ledger", async () => {
    await fresh();
    const p = await product(5);
    await prisma.stockLevel.update({ where: { locationId_productId: { locationId: org.storeId, productId: p } }, data: { quantity: { increment: 2 } } });
    const st = await services.stocktake.create(org.user, { locationId: org.storeId });
    expect(st.snapshotDriftCount).toBeGreaterThanOrEqual(1);
    await counted(st.id, { [p]: 5 });
    await services.stocktake.submit(org.user, st.id);
    await services.stocktake.approve(org.user, st.id);
    // The count makes the shelf figure match what people physically counted. It does
    // NOT hide the pre-existing cache/ledger disagreement: the diagnostic keeps
    // reporting exactly that same difference, so the integrity problem stays visible
    // instead of being papered over by the count.
    expect(await level(p)).toBe(5);
    const rep = await checkLedgerConsistency(prisma, org.organizationId);
    const mine = rep.stock.drifts.filter((d) => d.productId === p);
    expect(mine).toHaveLength(1);
    expect(mine[0].difference).toBe(2);
  });

  it("every stocktake audit action has been written", async () => {
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.stocktake.filter((a) => !logged.has(a))).toEqual([]);
  });

  it("write-off then count: the write-off is history, the count only corrects what is still wrong", async () => {
    await fresh();
    const p = await product(10);
    const st = await services.stocktake.create(org.user, { locationId: org.storeId });
    await services.inventory.writeOff(org.user, { locationId: org.storeId, productId: p, quantity: 3, writeOffReason: WriteOffReason.DAMAGED });
    await counted(st.id, { [p]: 10 }); // counted the pre-write-off shelf
    await services.stocktake.submit(org.user, st.id);
    await services.stocktake.approve(org.user, st.id);
    expect(await level(p)).toBe(7); // diff 0 → nothing applied
  });
});
