import { PaymentMethod, ProductType, SystemAccountKey as K, Unit, WriteOffReason } from "@bakery-os/shared";
import { AccountingEventStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { CostingService } from "../costing/costing.service";
import { LedgerService } from "../ledger/ledger.service";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { BalanceService } from "../finance/balance/balance.service";
import { ProductsService } from "../products/products.service";
import { RecipesService } from "./recipes.service";

// A semi-finished product HELD AS STOCK (a cabbage filling cooked one day, used
// the next): its own batches, a moving weighted-average cost on the product, and
// the parent recipe taking it from stock instead of re-consuming the raw
// materials. The test amounts below are fixtures, not a norm for any real recipe.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const recipes = new RecipesService(prisma);
const products = new ProductsService(prisma);
const costing = new CostingService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let n = 0;
let supplierId: string;
let ids: { cabbage: string; carrot: string; oil: string; flour: string; filling: string; pie: string };
let pieRecipeId: string;
let fillingRecipeId: string;

const raw = (name: string, price: number) =>
  prisma.product.create({ data: { organizationId: org.organizationId, name, sku: `ST-${++n}`, unit: Unit.KG, type: ProductType.RAW_MATERIAL, price } });
const stockOf = async (productId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: org.storeId, productId } } }))?.quantity.toNumber() ?? 0;
const avgOf = async (productId: string) => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).averageUnitCost?.toNumber() ?? null;
const batch = async (recipeId: string, planned: number, actual: number) => {
  const created = await services.production.create(org.user, { recipeId, plannedQuantity: planned, locationId: org.storeId } as never);
  await services.production.start(org.user, created.id);
  await services.production.complete(org.user, created.id, { actualQuantity: actual } as never);
  return created.id;
};
const movesOf = (batchId: string) => prisma.stockMovement.findMany({ where: { batchId } });
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
const round2 = (v: number) => Math.round(v * 1e2) / 1e2;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "stocked-semi");
  await startLedger(ledger, org);
  supplierId = (await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Поставщик-ст" } })).id;
  const [cabbage, carrot, oil, flour] = await Promise.all([raw("Капуста", 100), raw("Морковь", 150), raw("Масло", 400), raw("Мука", 50)]);
  const filling = await products.create(org.organizationId, { name: "Начинка капустная", unit: Unit.KG, type: ProductType.SEMI_FINISHED, price: 0 } as never);
  const pie = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Пирожок с капустой", sku: `ST-${++n}`, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 300 } });
  ids = { cabbage: cabbage.id, carrot: carrot.id, oil: oil.id, flour: flour.id, filling: filling.id, pie: pie.id };
  // The raw materials are BOUGHT, so the ledger's inventory account holds them.
  await services.procurement.activateCutover(org.user);
  const po = await services.procurement.create(org.user, {
    supplierId,
    locationId: org.storeId,
    items: [
      { productId: ids.cabbage, quantity: 20, unitCost: 100 },
      { productId: ids.carrot, quantity: 3, unitCost: 150 },
      { productId: ids.oil, quantity: 3, unitCost: 400 },
      { productId: ids.flour, quantity: 5, unitCost: 50 },
    ],
  } as never);
  await services.procurement.receive(org.user, po.id);
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("setting it up", () => {
  it("a semi-finished product starts without stock; the owner switches stock on; nobody can receive it by hand", async () => {
    expect((await prisma.product.findUniqueOrThrow({ where: { id: ids.filling } })).trackInventory).toBe(false);
    // Without stock it has no batches of its own (the earlier behaviour).
    const virtual = await recipes.create(org.user, {
      productId: ids.filling,
      yieldQuantity: 2.55,
      items: [{ ingredientProductId: ids.cabbage, quantity: 2.9 }, { ingredientProductId: ids.carrot, quantity: 0.23 }, { ingredientProductId: ids.oil, quantity: 0.15 }],
    } as never);
    fillingRecipeId = virtual.id;
    await expect(services.production.create(org.user, { recipeId: fillingRecipeId, plannedQuantity: 1, locationId: org.storeId } as never)).rejects.toThrow(/без учёта склада/);

    const switched = await products.update(org.organizationId, ids.filling, { trackInventory: true } as never, null);
    expect(switched.trackInventory).toBe(true);
    await expect(services.inventory.receive(org.user, { productId: ids.filling, quantity: 1, locationId: org.storeId } as never)).rejects.toThrow(/только из производства/);
  });

  it("the pie's card warns «Не учтено: начинка» until the filling is in its recipe — no norm is invented", async () => {
    const card = await recipes.create(org.user, {
      productId: ids.pie,
      yieldQuantity: 36,
      uncountedNote: "начинка",
      items: [{ ingredientProductId: ids.flour, quantity: 1 }],
    } as never);
    pieRecipeId = card.id;
    expect(card.uncountedWarning).toBe("Не учтено: начинка");
    expect(card.unitCost).toBeCloseTo(50 / 36, 6); // flour only: the filling is NOT guessed
  });
});

describe("a filling batch: plan in, weighed yield out", () => {
  it("consumes the raw materials by the PLAN and values each kilo by the ACTUAL yield", async () => {
    const id = await batch(fillingRecipeId, 2.55, 2.4); // planned 2.55 kg, 2.4 kg came out
    const moves = await movesOf(id);
    const consumed = Object.fromEntries(moves.filter((m) => m.type === "PRODUCTION_CONSUMPTION").map((m) => [m.productId, m.quantity.toNumber()]));
    expect(consumed[ids.cabbage]).toBeCloseTo(2.9, 6); // not scaled down to the 2.4 that came out
    expect(consumed[ids.carrot]).toBeCloseTo(0.23, 6);
    expect(consumed[ids.oil]).toBeCloseTo(0.15, 6);
    const output = moves.find((m) => m.type === "PRODUCTION_OUTPUT")!;
    expect(output.quantity.toNumber()).toBe(2.4);
    const batchCost = 2.9 * 100 + 0.23 * 150 + 0.15 * 400; // 384.5
    expect(output.unitCost?.toNumber()).toBe(round4(batchCost / 2.4));
    expect(await stockOf(ids.filling)).toBe(2.4);
    expect(await avgOf(ids.filling)).toBe(round4(batchCost / 2.4)); // first batch: its own cost
    expect(await stockOf(ids.cabbage)).toBeCloseTo(20 - 2.9, 6);
  });

  it("the accounting event of the batch balances: raw → filling at cost, no ledger effect, no exception", async () => {
    const event = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventType: "PRODUCTION" } });
    expect(event.status).toBe(AccountingEventStatus.NO_GL_EFFECT);
  });

  it("stock value and cost agree: the costing interface values the filling at its average", async () => {
    const costs = await costing.currentUnitCosts(org.organizationId);
    expect(costs.get(ids.filling)?.unitCost).toBe(await avgOf(ids.filling));
    expect(costs.get(ids.filling)?.basis).toBe("PRODUCTION_AVERAGE");
    // A finished product is still «по техкарте», and a virtual semi-finished product too.
    expect(costs.get(ids.pie)?.basis).toBe("RECIPE_CURRENT");
  });
});

describe("the pies take the filling from stock, never the raw materials twice", () => {
  it("is refused while there is not enough filling", async () => {
    await recipes.update(org.user, pieRecipeId, {
      items: [{ ingredientProductId: ids.flour, quantity: 1 }, { ingredientProductId: ids.filling, quantity: 9 }],
    } as never);
    const created = await services.production.create(org.user, { recipeId: pieRecipeId, plannedQuantity: 36, locationId: org.storeId } as never);
    await services.production.start(org.user, created.id);
    await expect(services.production.complete(org.user, created.id, { actualQuantity: 36 } as never)).rejects.toThrow(/Недостаточно ингредиента «Начинка капустная»/);
    await services.production.cancel(org.user, created.id, { reason: "OTHER" } as never);
    expect(await stockOf(ids.flour)).toBe(5); // the failed batch changed nothing
  });

  it("once the measured amount is entered the warning goes, and the batch uses stock at the average", async () => {
    const entered = await recipes.update(org.user, pieRecipeId, {
      items: [{ ingredientProductId: ids.flour, quantity: 1 }, { ingredientProductId: ids.filling, quantity: 1.2 }], // a fixture amount
    } as never);
    expect(entered.uncountedWarning).toBeNull(); // a semi-finished ingredient is now in the recipe
    expect(entered.uncountedNote).toBe("начинка"); // the note itself is kept
    const avg = (await avgOf(ids.filling)) as number;
    expect(entered.unitCost).toBeCloseTo((50 + 1.2 * avg) / 36, 4);

    const rawBefore = { cabbage: await stockOf(ids.cabbage), carrot: await stockOf(ids.carrot), oil: await stockOf(ids.oil) };
    const id = await batch(pieRecipeId, 36, 36);
    const moves = await movesOf(id);
    const consumed = moves.filter((m) => m.type === "PRODUCTION_CONSUMPTION");
    // Cabbage, carrot and oil are NOT touched again; the filling and the flour are.
    expect(consumed.map((m) => m.productId).sort()).toEqual([ids.filling, ids.flour].sort());
    expect({ cabbage: await stockOf(ids.cabbage), carrot: await stockOf(ids.carrot), oil: await stockOf(ids.oil) }).toEqual(rawBefore);
    expect(await stockOf(ids.filling)).toBeCloseTo(2.4 - 1.2, 6);
    const fillingRow = consumed.find((m) => m.productId === ids.filling)!;
    expect(fillingRow.unitCost?.toNumber()).toBe(avg);
    expect(fillingRow.costBasis).toBe("PRODUCTION_AVERAGE");
    // What the pies cost = flour + the filling taken at its average; output balances consumption.
    const value = round2(50) + round2(1.2 * avg);
    const output = moves.find((m) => m.type === "PRODUCTION_OUTPUT")!;
    expect(round2(output.unitCost!.toNumber() * 36)).toBeCloseTo(value, 1);
    const event = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventKey: `batch:${id}:production` } });
    expect(event.status).toBe(AccountingEventStatus.NO_GL_EFFECT);
  });
});

describe("selling, spoiling and the books agree (one batch, one price)", () => {
  it("after sales and a write-off the stock valuation equals the general ledger's inventory", async () => {
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: ids.pie, quantity: 10, unitPrice: 300 }] } as never);
    await services.inventory.writeOff(org.user, { productId: ids.filling, quantity: 0.5, locationId: org.storeId, writeOffReason: WriteOffReason.EXPIRED } as never);
    expect(await stockOf(ids.filling)).toBeCloseTo(0.7, 6);

    const reports = new LedgerReportsService(prisma, services.finance);
    const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), reports, ledger);
    const result = await diagnostics.run(org.organizationId);
    const inventory = result.checks.find((c) => c.check === "INVENTORY_SUBLEDGER")!;
    expect(inventory.status).toBe("PASS");
    expect(Math.abs(inventory.difference ?? 99)).toBeLessThan(0.1);
    // Every other reconciliation holds too: trial balance, balance equation, P&L vs equity, payables, cash.
    expect(result.checks.filter((c) => c.status !== "PASS")).toEqual([]);

    // The P&L and the balance sheet say the same thing as the books.
    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    const stamped = (await prisma.stockMovement.findFirstOrThrow({ where: { productId: ids.pie, type: "PRODUCTION_OUTPUT" } })).unitCost!.toNumber();
    expect(pnl.revenue).toBe(3000); // 10 pies × 300 — the filling never appears as revenue
    expect(pnl.cogs).toBeCloseTo(10 * stamped, 1); // what the pies cost, filling included, once
    expect(pnl.inventoryLosses).toBeCloseTo(0.5 * (await avgOf(ids.filling))!, 1); // the spoiled filling, once
    expect(await glBalance(ledger, org, K.COST_OF_GOODS_SOLD)).toBeCloseTo(pnl.cogs, 1);
    expect(await glBalance(ledger, org, K.INVENTORY_LOSSES)).toBeCloseTo(pnl.inventoryLosses, 1);
    const sheet = await new BalanceService(prisma, services.finance).getBalanceSheet(org.organizationId, new Date());
    expect(sheet.status).not.toBe("NOT_BALANCED");
    expect(await glBalance(ledger, org, K.INVENTORY)).toBeCloseTo(inventory.expected as number, 1);
    // The write-off is a loss at the average, like any other write-off.
    const loss = await prisma.stockMovement.findFirstOrThrow({ where: { productId: ids.filling, type: "WRITE_OFF" } });
    expect(loss.unitCost?.toNumber()).toBe(await avgOf(ids.filling));
    // …and the row says WHY that price: the weighted average, not a recipe.
    expect(loss.costBasis).toBe("PRODUCTION_AVERAGE");
  });
});

describe("a second batch moves the price as a weighted average", () => {
  it("(old stock × old price + new batch × its cost) ÷ new quantity — one price for all stock", async () => {
    const before = { qty: await stockOf(ids.filling), avg: (await avgOf(ids.filling)) as number };
    const id = await batch(fillingRecipeId, 2.55, 2.55);
    const unit = round4((2.9 * 100 + 0.23 * 150 + 0.15 * 400) / 2.55);
    const expected = round4((before.qty * before.avg + 2.55 * unit) / (before.qty + 2.55));
    expect(await avgOf(ids.filling)).toBe(expected);
    expect((await movesOf(id)).find((m) => m.type === "PRODUCTION_OUTPUT")?.unitCost?.toNumber()).toBe(unit);
    // Stock value is exactly what it was plus what the batch cost.
    const valueAfter = (await stockOf(ids.filling)) * expected;
    expect(valueAfter).toBeCloseTo(before.qty * before.avg + 384.5, 1);
    const costs = await costing.currentUnitCosts(org.organizationId);
    expect(costs.get(ids.filling)?.unitCost).toBe(expected);
    // …and the pie's own cost follows the filling's new average (the existing "finished goods are valued at today's recipe cost" rule).
    expect(costs.get(ids.pie)?.unitCost).toBeCloseTo((50 + 1.2 * expected) / 36, 4);
  });

  it("the filling's own value is conserved to the cent; the only drift is the pies already on the shelf being revalued", async () => {
    const reports = new LedgerReportsService(prisma, services.finance);
    const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), reports, ledger);
    const inventory = (await diagnostics.run(org.organizationId)).checks.find((c) => c.check === "INVENTORY_SUBLEDGER")!;
    // 26 pies were made at the OLD average and are now valued at the NEW one — the
    // same effect a flour price change has on bread (finished goods carry today's
    // recipe cost). Nothing of the filling or the raw materials is lost.
    const costs = await costing.currentUnitCosts(org.organizationId);
    const pies = await stockOf(ids.pie);
    const stamped = (await prisma.stockMovement.findFirstOrThrow({ where: { productId: ids.pie, type: "PRODUCTION_OUTPUT" } })).unitCost!.toNumber();
    const revaluation = round2(pies * ((costs.get(ids.pie)?.unitCost as number) - stamped));
    // The diagnostic reports ledger − valuation, so a revaluation DOWN shows as a positive difference.
    expect(inventory.difference ?? 0).toBeCloseTo(-revaluation, 1);
  });
});

describe("two batches finishing at the same moment cannot corrupt the average", () => {
  it("equals the average of one after the other", async () => {
    const before = { qty: await stockOf(ids.filling), avg: (await avgOf(ids.filling)) as number };
    const make = async () => {
      const created = await services.production.create(org.user, { recipeId: fillingRecipeId, plannedQuantity: 1.02, locationId: org.storeId } as never);
      await services.production.start(org.user, created.id);
      return created.id;
    };
    const [a, b] = [await make(), await make()];
    await Promise.all([services.production.complete(org.user, a, { actualQuantity: 1 } as never), services.production.complete(org.user, b, { actualQuantity: 0.9 } as never)]);
    // Each batch cost 1.02/2.55 of a full one: 153.8.
    const cost = (2.9 * 100 + 0.23 * 150 + 0.15 * 400) * (1.02 / 2.55);
    const value = before.qty * before.avg + 2 * cost;
    const quantity = before.qty + 1.9;
    expect(await stockOf(ids.filling)).toBeCloseTo(quantity, 6);
    expect((await avgOf(ids.filling)) as number).toBeCloseTo(value / quantity, 2);
  });
});

describe("guards and backward compatibility", () => {
  it("switching stock off needs nothing on the shelf and no open batch; a type change away needs the stock gone too", async () => {
    await expect(products.update(org.organizationId, ids.filling, { trackInventory: false } as never, null)).rejects.toThrow(/Остаток полуфабриката не нулевой/);
    await expect(products.update(org.organizationId, ids.filling, { type: ProductType.RAW_MATERIAL } as never, null)).rejects.toThrow();
  });

  it("stock cannot be switched on or off while a planned or running batch would be made either way", async () => {
    const cream = await products.create(org.organizationId, { name: "Крем-переключатель", unit: Unit.KG, type: ProductType.SEMI_FINISHED, price: 0 } as never);
    await recipes.create(org.user, { productId: cream.id, yieldQuantity: 1, items: [{ ingredientProductId: ids.oil, quantity: 0.1 }] } as never);
    const cake = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Торт-переключатель", sku: `ST-${++n}`, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 900 } });
    const r = await recipes.create(org.user, { productId: cake.id, yieldQuantity: 1, items: [{ ingredientProductId: cream.id, quantity: 0.2 }] } as never);
    const open = await services.production.create(org.user, { recipeId: r.id, plannedQuantity: 1, locationId: org.storeId } as never);
    await expect(products.update(org.organizationId, cream.id, { trackInventory: true } as never, null)).rejects.toThrow(/незавершённые производственные задания/);
    await services.production.cancel(org.user, open.id, {} as never);
    await expect(products.update(org.organizationId, cream.id, { trackInventory: true } as never, null)).resolves.toMatchObject({ trackInventory: true });
  });

  it("an ordinary finished product still consumes by what it actually made, and valuation is untouched", async () => {
    const bread = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Хлеб-обычный", sku: `ST-${++n}`, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 100 } });
    const r = await recipes.create(org.user, { productId: bread.id, yieldQuantity: 10, items: [{ ingredientProductId: ids.flour, quantity: 2 }] } as never);
    const flourBefore = await stockOf(ids.flour);
    const id = await batch(r.id, 10, 5); // half of the plan came out
    const flour = (await movesOf(id)).find((m) => m.type === "PRODUCTION_CONSUMPTION")!;
    expect(flour.quantity.toNumber()).toBe(1); // 2 kg × 5 ÷ 10, exactly as before this feature
    expect(await stockOf(ids.flour)).toBe(flourBefore - 1);
    expect(await avgOf(bread.id)).toBeNull(); // no average anywhere but a stocked semi-finished product
    expect((await costing.currentUnitCosts(org.organizationId)).get(bread.id)?.unitCost).toBeCloseTo(100 / 10, 6); // 2 kg × 50 ÷ 10 pieces
  });

  it("a semi-finished product WITHOUT stock still expands into raw materials, as before", async () => {
    const sauce = await products.create(org.organizationId, { name: "Соус виртуальный", unit: Unit.KG, type: ProductType.SEMI_FINISHED, price: 0 } as never);
    await recipes.create(org.user, { productId: sauce.id, yieldQuantity: 1, items: [{ ingredientProductId: ids.oil, quantity: 0.5 }] } as never);
    const dish = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Блюдо-с-соусом", sku: `ST-${++n}`, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 500 } });
    const r = await recipes.create(org.user, { productId: dish.id, yieldQuantity: 2, items: [{ ingredientProductId: sauce.id, quantity: 0.4 }] } as never);
    const oilBefore = await stockOf(ids.oil);
    const id = await batch(r.id, 2, 2);
    const consumed = (await movesOf(id)).filter((m) => m.type === "PRODUCTION_CONSUMPTION");
    expect(consumed.map((m) => m.productId)).toEqual([ids.oil]);
    expect(await stockOf(ids.oil)).toBeCloseTo(oilBefore - 0.2, 6);
  });
});

describe("the revaluation of finished goods is the architecture's existing rule, not something this feature adds", () => {
  it("an ordinary price change on a raw material produces the same kind of ledger-vs-valuation difference", async () => {
    // Bread baked from flour at 50, sold none, then the flour price moves to 80:
    // the bread already on the shelf is valued at TODAY's recipe cost (CostingService),
    // the books carry it at what it cost when baked.
    const bread = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Хлеб-переоценка", sku: `ST-${++n}`, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 100 } });
    const r = await recipes.create(org.user, { productId: bread.id, yieldQuantity: 10, items: [{ ingredientProductId: ids.flour, quantity: 2 }] } as never);
    await batch(r.id, 10, 10);
    const reports = new LedgerReportsService(prisma, services.finance);
    const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), reports, ledger);
    const inventoryCheck = async () => (await diagnostics.run(org.organizationId)).checks.find((c) => c.check === "INVENTORY_SUBLEDGER")!;
    const stockValue = async () => {
      const costs = await costing.currentUnitCosts(org.organizationId);
      const levels = await prisma.stockLevel.findMany({ where: { organizationId: org.organizationId, quantity: { gt: 0 } } });
      return levels.reduce((sum, l) => sum + l.quantity.toNumber() * (costs.get(l.productId)?.unitCost ?? 0), 0);
    };
    const [checkBefore, valueBefore] = [await inventoryCheck(), await stockValue()];
    await prisma.product.update({ where: { id: ids.flour }, data: { price: 80 } });
    const [checkAfter, valueAfter] = [await inventoryCheck(), await stockValue()];
    // The books did not move; the valuation did (raw flour AND every product whose recipe uses it),
    // so the difference moved by exactly that — with no filling involved at all.
    expect(Math.abs(valueAfter - valueBefore)).toBeGreaterThan(50);
    expect(Math.abs((checkAfter.difference ?? 0) - (checkBefore.difference ?? 0))).toBeCloseTo(Math.abs(valueAfter - valueBefore), 0);
    await prisma.product.update({ where: { id: ids.flour }, data: { price: 50 } });
  });
});
