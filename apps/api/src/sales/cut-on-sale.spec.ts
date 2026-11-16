import { debtDateKey, PaymentMethod, ProductType, Role, SystemAccountKey as K, Unit } from "@bakery-os/shared";
import { AccountingEventStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { LedgerService } from "../ledger/ledger.service";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { BalanceService } from "../finance/balance/balance.service";
import { ProductsService } from "../products/products.service";
import { RecipesService } from "../recipes/recipes.service";
import { InventoryService } from "../inventory/inventory.service";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
import { CostCorrectionService } from "../finance/cost-correction/cost-correction.service";
import { StockTurnoverService } from "../finance/cost-correction/stock-turnover.service";
import { CashMovementsService } from "../finance/cash-movements.service";
import { FiscalService } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { FakeFiscalProvider } from "../fiscal/fake-fiscal.provider";
import { PromotionsService } from "../promotions/promotions.service";
import { SalesService } from "./sales.service";

// Half a cake is its own product with its own price (owner, 16.11.2026), but nobody bakes halves:
// a cashier cuts a whole cake when a buyer asks. «Нарезается из товара» on the half's card links it
// to the whole; from then on a sale of a half the shelf does not have cuts a whole one by itself —
// the whole leaves stock, two halves arrive at half its cost each, the one not sold stays in stock.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const recipes = new RecipesService(prisma);
const products = new ProductsService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let cashier: IsolatedOrg["user"];
let ids: { flour: string; cake: string; half: string; slice: string; pie: string; plain: string };
let n = 0;

const product = (name: string, type: ProductType, price: number, unit: Unit = Unit.PCS) =>
  prisma.product.create({ data: { organizationId: org.organizationId, name, sku: `CUT-${++n}`, type, price, unit } });
const stockOf = async (productId: string, locationId = org.storeId) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId } } }))?.quantity.toNumber() ?? 0;
const avgOf = async (productId: string) => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).averageUnitCost?.toNumber() ?? null;
const sell = (user: IsolatedOrg["user"], items: { productId: string; quantity: number; unitPrice: number }[]) =>
  services.sales.create(user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items } as never);
const cutBatches = () =>
  prisma.productionBatch.findMany({
    where: { organizationId: org.organizationId, saleId: { not: null } },
    include: { stockMovements: true, costs: true },
    orderBy: { createdAt: "asc" },
  });

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "cut-on-sale");
  cashier = { ...org.user, role: Role.CASHIER, locationId: org.storeId };
  await startLedger(ledger, org);
  const flour = await product("Мука", ProductType.RAW_MATERIAL, 400, Unit.KG);
  const cake = await product("Торт Медовик", ProductType.FINISHED_GOOD, 8000);
  const half = await product("Торт Медовик ½", ProductType.FINISHED_GOOD, 4500);
  const slice = await product("Торт Медовик кусочек", ProductType.FINISHED_GOOD, 1200);
  const pie = await product("Пирог яблочный", ProductType.FINISHED_GOOD, 3000);
  const plain = await product("Булочка", ProductType.FINISHED_GOOD, 200);
  ids = { flour: flour.id, cake: cake.id, half: half.id, slice: slice.id, pie: pie.id, plain: plain.id };

  // The flour is BOUGHT, so the ledger's inventory account holds it.
  const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Поставщик-нарезка" } });
  await services.procurement.activateCutover(org.user);
  const po = await services.procurement.create(org.user, {
    supplierId: supplier.id,
    locationId: org.warehouseId,
    items: [{ productId: ids.flour, quantity: 100, unitCost: 400 }],
  } as never);
  await services.procurement.receive(org.user, po.id);

  // A cake = 2 kg of flour → 800 ₸; a pie = 1 kg → 400 ₸; a bun = 0.1 kg → 40 ₸.
  const recipeOf = (productId: string, kg: number) =>
    recipes.create(org.user, { productId, yieldQuantity: 1, items: [{ ingredientProductId: ids.flour, quantity: kg }] } as never);
  await recipeOf(ids.cake, 2);
  await recipeOf(ids.pie, 1);
  await recipeOf(ids.plain, 0.1);
  // Baked at the warehouse, put straight on the shop's shelf.
  await services.production.release(org.user, {
    locationId: org.warehouseId,
    outputLocationId: org.storeId,
    lines: [
      { productId: ids.cake, quantity: 5 },
      { productId: ids.plain, quantity: 10 },
    ],
  });
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("«Нарезается из товара»: the half is tied to the whole on its card", () => {
  it("refuses what cannot be a part or a whole", async () => {
    await expect(recipes.setCutSource(org.user, ids.half, { sourceProductId: ids.half })).rejects.toThrow(/из самого себя/);
    await expect(recipes.setCutSource(org.user, ids.flour, { sourceProductId: ids.cake })).rejects.toThrow(/только готовая продукция/);
    await expect(recipes.setCutSource(org.user, ids.half, { sourceProductId: ids.flour })).rejects.toThrow(/только из готовой продукции/);
    await expect(recipes.setCutSource(org.user, ids.half, { sourceProductId: ids.cake, parts: 1 })).rejects.toThrow(/от 2 до 100/);
    await expect(recipes.setCutSource(org.user, ids.half, { sourceProductId: ids.cake, parts: 2.5 })).rejects.toThrow(/от 2 до 100/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: ids.half } })).makeOnSale).toBe(false);
  });

  it("links: the half gets a техкарта «1 whole → 2 halves», costs half the whole, and the list says so", async () => {
    const linked = await recipes.setCutSource(org.user, ids.half, { sourceProductId: ids.cake });
    expect(linked).toEqual({ makeOnSale: true, cutFrom: { productId: ids.cake, productName: "Торт Медовик", parts: 2 } });

    const recipe = (await recipes.findAllForOrganization(org.organizationId)).find((r) => r.productId === ids.half)!;
    expect(recipe.makeOnSale).toBe(true);
    expect(recipe.yieldQuantity).toBe(2);
    expect(recipe.items.map((i) => [i.ingredientProductId, i.quantity])).toEqual([[ids.cake, 1]]);
    expect(recipe.unitCost).toBeCloseTo(400, 6); // half of the cake's 800
    expect(recipe.versions).toHaveLength(1);

    const list = await products.findAllForOrganization(org.organizationId);
    expect(list.find((p) => p.id === ids.half)).toMatchObject({ makeOnSale: true, cutFrom: { productId: ids.cake, parts: 2 } });
    expect(list.find((p) => p.id === ids.cake)).toMatchObject({ makeOnSale: false, cutFrom: null });
    // Saving the same link again changes nothing (no second version, no second audit row).
    await recipes.setCutSource(org.user, ids.half, { sourceProductId: ids.cake, parts: 2 });
    expect(await prisma.recipeVersion.count({ where: { recipe: { productId: ids.half } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "product.cutSource" } })).toBe(1);
  });

  it("a slice is the same thing with another number of parts; no chains", async () => {
    const linked = await recipes.setCutSource(org.user, ids.slice, { sourceProductId: ids.cake, parts: 8 });
    expect(linked.cutFrom?.parts).toBe(8);
    // A part is always cut from a whole, never from another part — in either direction.
    await expect(recipes.setCutSource(org.user, ids.slice, { sourceProductId: ids.half })).rejects.toThrow(/сам нарезается из другого товара/);
    await expect(recipes.setCutSource(org.user, ids.cake, { sourceProductId: ids.pie })).rejects.toThrow(/уже нарезается/);
  });

  it("a техкарта with a composition of its own is replaced only when the person says so", async () => {
    // The pie has its own recipe from flour; turning it into «a part of the cake» must be confirmed.
    await expect(recipes.setCutSource(org.user, ids.pie, { sourceProductId: ids.cake, parts: 4 })).rejects.toThrow(/уже есть техкарта с другим составом/);
    const before = (await recipes.findAllForOrganization(org.organizationId)).find((r) => r.productId === ids.pie)!;
    expect(before.items.map((i) => i.ingredientProductId)).toEqual([ids.flour]);
    expect(before.makeOnSale).toBe(false);

    const replaced = await recipes.setCutSource(org.user, ids.pie, { sourceProductId: ids.cake, parts: 4, replace: true });
    expect(replaced.cutFrom).toEqual({ productId: ids.cake, productName: "Торт Медовик", parts: 4 });
    // History keeps the old composition as version 1.
    const versions = await prisma.recipeVersion.findMany({ where: { recipe: { productId: ids.pie } }, orderBy: { number: "asc" } });
    expect(versions).toHaveLength(2);

    // Unlinking only stops the automatic cut: the техкарта stays an ordinary one.
    expect(await recipes.setCutSource(org.user, ids.pie, { sourceProductId: null })).toEqual({ makeOnSale: false, cutFrom: null });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: ids.pie } })).makeOnSale).toBe(false);
    expect((await products.findAllForOrganization(org.organizationId)).find((p) => p.id === ids.pie)?.cutFrom).toBeNull();
    expect(await prisma.recipe.count({ where: { productId: ids.pie, isActive: true } })).toBe(1);
  });

  it("every step is in the audit log", async () => {
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId }, select: { action: true } })).map((a) => a.action));
    expect(AUDIT_ACTION_GROUPS.cutSource.filter((a) => !logged.has(a))).toEqual([]);
  });
});

describe("a sale of a half cuts a whole cake by itself", () => {
  it("first half: one cake leaves the shelf, two halves arrive at half its cost, one is sold", async () => {
    expect(await stockOf(ids.cake)).toBe(5);
    expect(await stockOf(ids.half)).toBe(0);
    const sale = await sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }]);

    expect(await stockOf(ids.cake)).toBe(4);
    expect(await stockOf(ids.half)).toBe(1); // the other half is on the shelf, in the books
    expect(await avgOf(ids.half)).toBe(400);

    const [batch] = await cutBatches();
    expect(batch).toMatchObject({ saleId: sale.id, status: "COMPLETED", locationId: org.storeId });
    expect(batch.actualQuantity?.toNumber()).toBe(2);
    const taken = batch.stockMovements.find((m) => m.type === "PRODUCTION_CONSUMPTION")!;
    const made = batch.stockMovements.find((m) => m.type === "PRODUCTION_OUTPUT")!;
    expect([taken.productId, taken.quantity.toNumber(), taken.unitCost?.toNumber()]).toEqual([ids.cake, 1, 800]);
    expect([made.productId, made.quantity.toNumber(), made.unitCost?.toNumber()]).toEqual([ids.half, 2, 400]);
    expect(taken.reason).toBe("Нарезка при продаже: Торт Медовик ½");
    expect(made.reason).toBe("Нарезка при продаже");
    expect(batch.costs[0].amount.toNumber()).toBe(800);

    // The half is sold at what it cost: half of the cake.
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect([line.unitCost?.toNumber(), line.costBasis]).toEqual([400, "PRODUCTION_AVERAGE"]);
    const event = await prisma.accountingEvent.findFirstOrThrow({ where: { organizationId: org.organizationId, eventKey: `batch:${batch.id}:production` } });
    expect(event.status).toBe(AccountingEventStatus.NO_GL_EFFECT); // cake → halves at cost: nothing gained, nothing lost
  });

  it("second half: it is on the shelf, so nothing is cut", async () => {
    await sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }]);
    expect(await stockOf(ids.cake)).toBe(4);
    expect(await stockOf(ids.half)).toBe(0);
    expect(await cutBatches()).toHaveLength(1);
  });

  it("three halves in one check: two cakes are cut, one half stays", async () => {
    await sell(cashier, [
      { productId: ids.half, quantity: 2, unitPrice: 4500 },
      { productId: ids.half, quantity: 1, unitPrice: 4500 },
      { productId: ids.plain, quantity: 1, unitPrice: 200 },
    ]);
    expect(await stockOf(ids.cake)).toBe(2);
    expect(await stockOf(ids.half)).toBe(1);
    expect(await stockOf(ids.plain)).toBe(9);
    const batches = await cutBatches();
    expect(batches).toHaveLength(2);
    expect(batches[1].actualQuantity?.toNumber()).toBe(4);
  });

  it("a returned half goes back on the shelf as a half", async () => {
    const sale = await sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }]);
    expect(await stockOf(ids.half)).toBe(0);
    await services.returns.create(org.user, sale.id, { reason: "Передумал", restocked: true, items: [{ productId: ids.half, quantity: 1 }] } as never);
    expect(await stockOf(ids.half)).toBe(1);
    expect(await stockOf(ids.cake)).toBe(2); // the cake does not grow back together
    expect(await cutBatches()).toHaveLength(2);
  });

  it("a whole and a half cannot both come from the last cake of a point that does not go below zero", async () => {
    await prisma.stockLevel.updateMany({ where: { locationId: org.storeId, productId: ids.half }, data: { quantity: 0 } });
    await prisma.stockLevel.updateMany({ where: { locationId: org.storeId, productId: ids.cake }, data: { quantity: 1 } });
    const before = await prisma.sale.count({ where: { organizationId: org.organizationId } });
    await expect(
      sell(cashier, [
        { productId: ids.cake, quantity: 1, unitPrice: 8000 },
        { productId: ids.half, quantity: 1, unitPrice: 4500 },
      ]),
    ).rejects.toThrow(/Недостаточно товара «Торт Медовик»/);
    // Nothing of the refused check stays: no sale, no cut, the cake is whole.
    expect(await prisma.sale.count({ where: { organizationId: org.organizationId } })).toBe(before);
    expect(await stockOf(ids.cake)).toBe(1);
    expect(await stockOf(ids.half)).toBe(0);
    expect(await cutBatches()).toHaveLength(2);

    await prisma.stockLevel.updateMany({ where: { locationId: org.storeId, productId: ids.cake }, data: { quantity: 0 } });
    await expect(sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }])).rejects.toThrow(
      "Недостаточно товара «Торт Медовик ½» на складе точки: нет и «Торт Медовик», чтобы нарезать",
    );
    // Put the shelf back as the movements say (2 cakes, 1 half) for the checks below.
    await prisma.stockLevel.updateMany({ where: { locationId: org.storeId, productId: ids.cake }, data: { quantity: 2 } });
    await prisma.stockLevel.updateMany({ where: { locationId: org.storeId, productId: ids.half }, data: { quantity: 1 } });
  });

  it("two tills selling the last half at once cut one cake between them, not two", async () => {
    await sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }]); // shelf: 2 cakes, 0 halves
    expect([await stockOf(ids.cake), await stockOf(ids.half)]).toEqual([2, 0]);
    await Promise.all([
      sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }]),
      sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }]),
    ]);
    expect([await stockOf(ids.cake), await stockOf(ids.half)]).toEqual([1, 0]);
    expect(await cutBatches()).toHaveLength(3);
  });
});

describe("the books, the reports and the day's worksheet", () => {
  it("the production journal and the output reports do not count a cut as baking", async () => {
    const journal = await services.production.findAll(org.user);
    expect(journal.some((b) => b.productId === ids.half)).toBe(false);
    expect(journal.filter((b) => b.productId === ids.cake)).toHaveLength(1);
    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const output = await services.production.output(org.user, from, to);
    expect(output.rows.map((r) => r.productId).sort()).toEqual([ids.cake, ids.plain].sort());
    expect(output.totalCost).toBe(5 * 800 + 10 * 40); // the cakes once, not again as halves
    const summary = await services.production.summaryByProduct(org.user, from, to);
    expect(summary.byProduct.some((r) => r.productId === ids.half)).toBe(false);
  });

  it("the stock history names the check behind a cut", async () => {
    const inventory = new InventoryService(prisma);
    const rows = await inventory.getMovements(org.user, undefined, 50, { productId: ids.half });
    const made = rows.filter((r) => r.type === "PRODUCTION_OUTPUT");
    expect(made).toHaveLength(3);
    for (const row of made) {
      expect(row.document?.kind).toBe("SALE");
      expect(row.document?.label).toMatch(/^Нарезка по чеку №\d+$/);
      expect(row.reason).toBe("Нарезка при продаже");
    }
  });

  it("«Сверка дня» adds up for the cake and for the half", async () => {
    const worksheet = await new ReconciliationService(prisma, services.costing).get(org.user, org.storeId, debtDateKey(new Date()));
    const cake = worksheet.lines.find((l) => l.productId === ids.cake)!;
    const half = worksheet.lines.find((l) => l.productId === ids.half)!;
    expect(cake.closing).toBe(1);
    expect(half.closing).toBe(0);
    // 4 cakes cut = 8 halves in; 9 sold, 1 returned.
    expect([half.received, half.sold, half.returned]).toEqual([8, 9, 1]);
    expect(cake.other).toBe(-4);
  });

  it("stock × cost equals the ledger's inventory, and the P&L took each half at half a cake", async () => {
    const reports = new LedgerReportsService(prisma, services.finance);
    const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), reports, ledger);
    const result = await diagnostics.run(org.organizationId);
    expect(result.checks.filter((c) => c.status !== "PASS")).toEqual([]);
    const inventory = result.checks.find((c) => c.check === "INVENTORY_SUBLEDGER")!;
    expect(Math.abs(inventory.difference ?? 99)).toBeLessThan(0.1);
    expect(await glBalance(ledger, org, K.INVENTORY)).toBeCloseTo(inventory.expected as number, 1);

    const pnl = await services.finance.getProfitAndLoss(org.organizationId, new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000));
    // 9 halves sold, 1 returned → 8 × 4 500; 1 bun × 200.
    expect(pnl.revenue).toBe(8 * 4500 + 200);
    expect(pnl.cogs).toBeCloseTo(8 * 400 + 40, 1);
    expect(pnl.inventoryLosses).toBe(0); // cutting a cake is not a loss
    expect(await glBalance(ledger, org, K.COST_OF_GOODS_SOLD)).toBeCloseTo(pnl.cogs, 1);
    const sheet = await new BalanceService(prisma, services.finance).getBalanceSheet(org.organizationId, new Date());
    expect(sheet.status).not.toBe("NOT_BALANCED");
  });
});

describe("the month-end walk and the turnover statement", () => {
  it("the cost correction finds nothing to correct, and the statement closes on the shelf", async () => {
    const [year, month] = debtDateKey(new Date()).split("-").map(Number);
    const correction = await new CostCorrectionService(prisma).preview(org.organizationId, year, month);
    expect(correction.totalCorrection).toBe(0);
    expect(correction.unstampedLines).toBe(0);

    const statement = await new StockTurnoverService(prisma).turnover(org.organizationId, new Date(Date.now() - 3600_000), new Date(), null);
    const cake = statement.lines.find((l) => l.productId === ids.cake)!;
    const half = statement.lines.find((l) => l.productId === ids.half)!;
    // 5 baked, 4 cut; 8 halves cut and 1 returned in, 9 sold.
    expect([cake.inQuantity, cake.outQuantity, cake.closingQuantity]).toEqual([5, 4, 1]);
    expect([half.inQuantity, half.outQuantity, half.closingQuantity]).toEqual([9, 9, 0]);
    expect(cake.closingValue).toBeCloseTo(800, 1);
    expect(half.closingValue).toBeCloseTo(0, 1);
  });
});

describe("with the fiscal cash register on", () => {
  it("the receipt is punched for a half that will be cut, and refused BEFORE punching when there is no cake", async () => {
    process.env.FISCALIZATION_ENABLED = "true";
    try {
      await prisma.product.update({ where: { id: ids.half }, data: { ntin: "0200000000001" } });
      await prisma.location.update({ where: { id: org.storeId }, data: { lat: 43.238, lng: 76.945 } });
      const fiscal = new FiscalService(prisma, new FakeFiscalProvider(), new FiscalSettings());
      const sales = new SalesService(prisma, new CashMovementsService(prisma), fiscal, new FiscalSettings(), new PromotionsService(prisma));
      const sellFiscal = () =>
        sales.create(cashier, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: ids.half, quantity: 1, unitPrice: 4500 }] } as never);
      expect([await stockOf(ids.cake), await stockOf(ids.half)]).toEqual([1, 0]);

      const sale = await sellFiscal(); // no half on the shelf, one cake: allowed, and cut
      expect(sale.fiscalReceipt).not.toBeNull();
      expect([await stockOf(ids.cake), await stockOf(ids.half)]).toEqual([0, 1]);
      await sellFiscal(); // the other half
      const receipts = await prisma.fiscalReceipt.count({ where: { organizationId: org.organizationId } });
      await expect(sellFiscal()).rejects.toThrow("нет и «Торт Медовик», чтобы нарезать");
      // A legally binding receipt is never issued for a half there is nothing to cut from.
      expect(await prisma.fiscalReceipt.count({ where: { organizationId: org.organizationId } })).toBe(receipts);
    } finally {
      delete process.env.FISCALIZATION_ENABLED;
    }
  });
});

describe("a point that may go below zero (before the first stock count)", () => {
  it("the cut takes the WHOLE into the minus — the half really came from a cake the books do not have yet", async () => {
    await services.inventory.setAllowNegativeStock(org.user, true);
    try {
      await prisma.stockLevel.updateMany({ where: { locationId: org.storeId, productId: ids.cake }, data: { quantity: 0 } });
      await sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }]);
      expect(await stockOf(ids.cake)).toBe(-1);
      expect(await stockOf(ids.half)).toBe(1);

      // An old minus on the half is the stock count's business: it does not make the sale cut extra cakes.
      await prisma.stockLevel.updateMany({ where: { locationId: org.storeId, productId: ids.half }, data: { quantity: -3 } });
      await sell(cashier, [{ productId: ids.half, quantity: 1, unitPrice: 4500 }]);
      expect(await stockOf(ids.cake)).toBe(-2);
      expect(await stockOf(ids.half)).toBe(-2); // −3 + 2 cut − 1 sold
    } finally {
      await services.inventory.setAllowNegativeStock(org.user, false);
    }
  });
});

describe("an ordinary product and a switched-off link", () => {
  it("a product that is not «made on sale» is sold exactly as before", async () => {
    const before = (await cutBatches()).length;
    await sell(cashier, [{ productId: ids.plain, quantity: 2, unitPrice: 200 }]);
    expect(await stockOf(ids.plain)).toBe(7);
    expect(await cutBatches()).toHaveLength(before);
  });

  it("making the half somebody else's goods, or not counted in stock, takes the link off", async () => {
    await recipes.setCutSource(org.user, ids.slice, { sourceProductId: ids.cake, parts: 8 });
    const updated = await products.update(org.organizationId, ids.slice, { trackInventory: false } as never, org.user.id);
    expect(updated).toMatchObject({ makeOnSale: false, cutFrom: null });
  });
});
