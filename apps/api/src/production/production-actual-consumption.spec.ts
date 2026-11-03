import { ProductType, SystemAccountKey as K, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { BalanceService } from "../finance/balance/balance.service";
import { FinancialEventProjector } from "../finance/events/projector";
import { checkEventInvariants } from "../finance/events/invariants";
import { checkLedgerConsistency } from "../finance/integrity/ledger-consistency";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { LedgerService } from "../ledger/ledger.service";

// The baker says how much raw material was really used. The product's cost
// stays the recipe norm (D1); above the norm is «Перерасход» (a write-off, an
// inventory loss), below it «Экономия» (stock comes back). The shelf, the
// deviation report, the P&L and the general ledger agree. Ledger ON.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balanceService = new BalanceService(prisma, services.finance);
const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, balanceService, reports, ledger);
const projector = new FinancialEventProjector(prisma);

let org: IsolatedOrg;
let flourId: string;
let sugarId: string;
let waterId: string;
let recipeId: string;
const level = async (productId: string) =>
  (await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId } } })).quantity.toNumber();

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "actual-consumption");
  const id = org.organizationId;
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "AC-1", type: ProductType.RAW_MATERIAL, price: 400, unit: Unit.KG } })).id;
  sugarId = (await prisma.product.create({ data: { organizationId: id, name: "Сахар", sku: "AC-2", type: ProductType.RAW_MATERIAL, price: 600, unit: Unit.KG } })).id;
  waterId = (await prisma.product.create({ data: { organizationId: id, name: "Вода", sku: "AC-3", type: ProductType.RAW_MATERIAL, price: 0, unit: Unit.L, trackInventory: false } })).id;
  const cake = await prisma.product.create({ data: { organizationId: id, name: "Торт", sku: "AC-4", type: ProductType.FINISHED_GOOD, price: 9000, unit: Unit.PCS } });
  // 10 cakes: 5 kg flour, 2 kg sugar, 3 l water.
  recipeId = (
    await prisma.recipe.create({
      data: {
        organizationId: id,
        productId: cake.id,
        yieldQuantity: 10,
        items: { create: [{ ingredientProductId: flourId, quantity: 5 }, { ingredientProductId: sugarId, quantity: 2 }, { ingredientProductId: waterId, quantity: 3 }] },
      },
    })
  ).id;
  await startLedger(ledger, org, 2);
  // Bought through an order, so the stock is in the books as well.
  await services.procurement.activateCutover(org.user);
  const supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Мельница" } })).id;
  const po = await services.procurement.create(org.user, {
    supplierId,
    locationId: org.storeId,
    items: [{ productId: flourId, quantity: 20, unitCost: 400 }, { productId: sugarId, quantity: 10, unitCost: 600 }],
  } as never);
  await services.procurement.receive(org.user, po.id);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const run = async (quantity: number, consumption?: { productId: string; quantity: number }[]) => {
  const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: quantity });
  await services.production.start(org.user, batch.id);
  return services.production.complete(org.user, batch.id, { actualQuantity: quantity, consumption } as never);
};

describe("actual raw material in production", () => {
  it("shows the norm per unit, tracked ingredients only", async () => {
    const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: 4 });
    const norm = await services.production.norm(org.user, batch.id);
    expect(norm.consumesByPlan).toBe(false);
    expect(norm.lines.map((l) => [l.name, l.perUnit]).sort()).toEqual([["Мука", 0.5], ["Сахар", 0.2]]);
    await services.production.cancel(org.user, batch.id, {} as never);
  });

  it("without figures it consumes the norm, as before", async () => {
    await run(4);
    expect(await level(flourId)).toBe(18);
    expect(await level(sugarId)).toBe(9.2);
  });

  it("over the norm is a write-off, under it comes back; the cost stays the norm", async () => {
    // 4 cakes: norm 2 kg flour / 0.8 kg sugar; really 2.3 kg flour, 0.7 kg sugar.
    const done = await run(4, [{ productId: flourId, quantity: 2.3 }, { productId: sugarId, quantity: 0.7 }]);
    expect(await level(flourId)).toBeCloseTo(15.7, 3);
    expect(await level(sugarId)).toBeCloseTo(8.5, 3);
    // Ingredients at the norm: 2 × 400 + 0.8 × 600 = 1 280.
    const cost = await prisma.productionBatchCost.findFirstOrThrow({ where: { batchId: done.id } });
    expect(cost.amount.toNumber()).toBe(1280);

    const moves = await prisma.stockMovement.findMany({ where: { batchId: done.id }, orderBy: { type: "asc" } });
    const overuse = moves.find((m) => m.type === "WRITE_OFF")!;
    expect(overuse).toMatchObject({ writeOffReason: "PRODUCTION_OVERUSE", productId: flourId });
    expect(overuse.quantity.toNumber()).toBe(0.3);
    const saving = moves.find((m) => m.type === "ADJUSTMENT")!;
    expect(saving.productId).toBe(sugarId);
    expect(saving.quantity.toNumber()).toBe(0.1);

    // An ingredient that is not in the recipe is refused; so is more than the shelf holds.
    await expect(run(1, [{ productId: waterId, quantity: 1 }])).rejects.toThrow(/нет такого сырья/);
    await expect(run(1, [{ productId: flourId, quantity: 500 }])).rejects.toThrow(/Недостаточно ингредиента «Мука»/);
  });

  it("the deviation report reads it back", async () => {
    const report = await services.production.deviations(org.user, new Date(Date.now() - 3600_000), new Date());
    // The two refused attempts were left running (started, never completed).
    expect(report.batchesCount).toBe(2);
    expect(report.overuseValue).toBe(120); // 0.3 kg × 400
    expect(report.savingValue).toBe(60); // 0.1 kg × 600
    expect(report.lines.map((l) => [l.ingredientName, l.norm, l.actual, l.deviation, l.deviationValue]).sort()).toEqual([
      ["Мука", 2, 2.3, 0.3, 120],
      ["Сахар", 0.8, 0.7, -0.1, -60],
    ]);
    const flour = report.byIngredient.find((r) => r.ingredientId === flourId)!;
    expect(flour).toMatchObject({ norm: 4, actual: 4.3, deviation: 0.3, deviationValue: 120 });
  });

  it("the P&L, the events and the ledger agree", async () => {
    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    const diag = await diagnostics.run(org.organizationId);
    expect(diag.checks.filter((c) => c.status !== "PASS")).toEqual([]);
    const consistency = await checkLedgerConsistency(prisma, org.organizationId);
    expect(consistency.cash.drifts).toEqual([]);
    // Net loss of the overuse and the saving: 120 − 60.
    expect(await glBalance(ledger, org, K.INVENTORY_LOSSES)).toBe(60);
  });
});
