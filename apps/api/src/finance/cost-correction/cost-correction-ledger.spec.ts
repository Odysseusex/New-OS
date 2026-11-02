import { PaymentMethod, ProductType, SystemAccountKey as K, Unit } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../../test/support/isolated-org";
import { glBalance, startLedger } from "../../../test/support/ledger-fixture";
import { buildServices } from "../../../test/support/services";
import { monthOf, monthRange, previousMonth } from "../../common/reporting-period";
import { FinancialEventProjector } from "../events/projector";
import { checkEventInvariants } from "../events/invariants";
import { pnlFromEvents } from "../events/pnl-from-events";
import { LedgerService } from "../../ledger/ledger.service";
import { FinancialPeriodsService } from "../periods/periods.service";
import { CostCorrectionService } from "./cost-correction.service";
import { BalanceService } from "../balance/balance.service";
import { LedgerDiagnosticsService } from "../../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../../ledger/ledger-reports.service";

// Step 4: the correction recorded at close, with the general ledger ON. It
// moves cost of goods and inventory by the same amount, the P&L read from the
// documents and the one read from events move together, a second version
// replaces the first (whose entry is reversed, never edited), and a month that
// is being closed accepts this one posting. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const projector = new FinancialEventProjector(prisma);
const correction = new CostCorrectionService(prisma);
const periods = new FinancialPeriodsService(prisma, services.finance);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let flourId: string;
let breadId: string;
let recipeId: string;
let supplierId: string;
const { year, month } = monthOf(new Date());
const range = monthRange(year, month);

// The correction is dated at the month's last moment, so the month is read whole.
const pnl = () => services.finance.getProfitAndLoss(org.organizationId, range.start, range.end);
const eventsPnl = async () => pnlFromEvents(await projector.project(org.organizationId), range.start, range.end);
const setStatus = (status: "OPEN" | "CLOSING") =>
  prisma.financialPeriod.updateMany({ where: { organizationId: org.organizationId, year, month }, data: { status, closingStartedAt: status === "CLOSING" ? new Date() : null } });

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "cost-correction-gl");
  const { organizationId } = org;
  flourId = (await prisma.product.create({ data: { organizationId, name: "Мука", sku: "G-ING", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 } })).id;
  breadId = (await prisma.product.create({ data: { organizationId, name: "Хлеб", sku: "G-PRD", unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 500 } })).id;
  recipeId = (
    await prisma.recipe.create({ data: { organizationId, productId: breadId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 5 }] } } })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId, name: "Мельница" } })).id;
  await startLedger(ledger, org);
  await services.procurement.activateCutover(org.user);

  const buy = async (unitCost: number) => {
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost }] } as never);
    await services.procurement.receive(org.user, po.id);
    return po;
  };
  await buy(400);
  const batch = await services.production.create(org.user, { recipeId, plannedQuantity: 10, locationId: org.storeId } as never);
  await services.production.start(org.user, batch.id);
  await services.production.complete(org.user, batch.id, { actualQuantity: 10 } as never);
  await buy(600);
  await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 4, unitPrice: 500 }] } as never);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

describe("the correction recorded at close", () => {
  let firstId: string;

  it("moves cost of goods and inventory by the same amount, in the books and both P&Ls", async () => {
    const [cogsBefore, inventoryBefore, pnlBefore, eventsBefore] = await Promise.all([gl(K.COST_OF_GOODS_SOLD), gl(K.INVENTORY), pnl(), eventsPnl()]);
    // Recorded the way a close does it: while the month is CLOSING, when nothing
    // else may be posted into it — this one posting is accepted.
    await setStatus("CLOSING");
    let recorded;
    try {
      recorded = await correction.record(org.user, year, month);
    } finally {
      await setStatus("OPEN");
    }
    // 4 loaves stamped at today's recipe (5 kg at 533.33 ÷ 10 = 266.67) really cost 200 each.
    expect(recorded.cogsCorrection).toBeCloseTo(800 - 4 * 266.6667, 1);
    expect(recorded.status).toBe("POSTED");
    expect(recorded.version).toBe(1);
    const delta = recorded.totalCorrection;

    expect(await gl(K.COST_OF_GOODS_SOLD)).toBeCloseTo(cogsBefore + delta, 2);
    expect(await gl(K.INVENTORY)).toBeCloseTo(inventoryBefore - delta, 2);
    const after = await pnl();
    expect(after.cogs).toBeCloseTo(pnlBefore.cogs + delta, 2);
    expect(after.netProfit).toBeCloseTo(pnlBefore.netProfit - delta, 2);
    expect((await eventsPnl()).netProfit).toBeCloseTo(eventsBefore.netProfit - delta, 2);
    expect(after.byProduct.find((p) => p.productId === breadId)!.cogs).toBe(800);

    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    const row = await prisma.costCorrection.findFirstOrThrow({ where: { organizationId: org.organizationId } });
    firstId = row.id;
    const posted = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventKey: `costCorrection:${row.id}` } });
    expect(posted.status).toBe("POSTED");
    expect((await correction.forMonth(org.organizationId, year, month)).status).toBe("POSTED");
  });

  it("closing again writes the next version, and the first one's entry is reversed", async () => {
    const first = await prisma.purchaseOrder.findFirstOrThrow({ where: { organizationId: org.organizationId }, orderBy: { orderedAt: "asc" }, include: { items: true } });
    await services.procurement.revise(org.user, first.id, { items: [{ itemId: first.items[0].id, quantity: 10, unitCost: 300 }], reason: "Цена в накладной 300" });
    const second = await correction.record(org.user, year, month);
    expect(second.version).toBe(2);
    // A loaf really cost 5 × 300 ÷ 10 = 150.
    expect(await pnl().then((p) => p.byProduct.find((r) => r.productId === breadId)!.cogs)).toBe(600);
    const old = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventKey: `costCorrection:${firstId}` } });
    expect(old.status).toBe("REVERSED");
    const stamped = (await prisma.saleItem.findFirstOrThrow({ where: { productId: breadId, sale: { organizationId: org.organizationId } } })).unitCost!.toNumber();
    expect(await gl(K.COST_OF_GOODS_SOLD)).toBeCloseTo(600 + (Math.round(4 * stamped * 100) / 100 - 4 * stamped), 1);
    expect(checkEventInvariants(await projector.project(org.organizationId)).violations).toEqual([]);
    const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), new LedgerReportsService(prisma, services.finance), ledger);
    const report = await diagnostics.run(org.organizationId);
    expect(report.checks.filter((c) => c.status === "FAIL" && c.check !== "INVENTORY_SUBLEDGER").map((c) => c.check)).toEqual([]);
    const coverage = await diagnostics.coverage(org.organizationId);
    expect(coverage.rows.find((r) => r.key === "costCorrection")).toMatchObject({ posted: 1 });
  });

  it("a recorded correction is never rewritten", async () => {
    const rows = await prisma.costCorrection.findMany({ where: { organizationId: org.organizationId, year, month } });
    expect(rows).toHaveLength(2);
    await expect(prisma.$executeRaw`UPDATE "cost_corrections" SET "version" = 99 WHERE "id" = ${rows[0].id}`).rejects.toThrow(/append-only/);
  });

  it("closing a month records its correction (even a zero one) before the snapshot", async () => {
    const prev = previousMonth(year, month);
    const snapshot = await periods.close(org.user, prev.year, prev.month);
    expect(snapshot.version).toBe(1);
    const recorded = await correction.forMonth(org.organizationId, prev.year, prev.month);
    expect(recorded.status).toBe("POSTED");
    expect(recorded.totalCorrection).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "costCorrection.record" } })).toBe(3);
  });
});

function gl(key: K) {
  return glBalance(ledger, org, key);
}
