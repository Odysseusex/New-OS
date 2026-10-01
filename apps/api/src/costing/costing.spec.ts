import { CostBasis, PaymentMethod, ProductType, ProductionCostComponent, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { CostingService } from "./costing.service";

// Cost snapshots: what a unit cost is stamped onto the sale line / stock
// movement when it happens, and read back from there — never recomputed from
// today's prices. Runs in its own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let flourId: string;
let breadId: string;
let recipeId: string;
let from: Date;
let to: Date;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "costing");
  const mk = (data: object) => prisma.product.create({ data: { organizationId: org.organizationId, unit: Unit.PCS, ...data } as never });
  flourId = (await mk({ name: "Мука", sku: "C-1", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 })).id;
  breadId = (await mk({ name: "Хлеб", sku: "C-2", type: ProductType.FINISHED_GOOD, price: 500 })).id;
  recipeId = (
    await prisma.recipe.create({
      data: {
        organizationId: org.organizationId,
        productId: breadId,
        yieldQuantity: 4,
        items: { create: [{ ingredientProductId: flourId, quantity: 2 }] },
      },
    })
  ).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: flourId, quantity: 100 });
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 50 });
  from = new Date(Date.now() - 3600_000);
  to = new Date(Date.now() + 3600_000);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

const sell = (quantity: number, unitPrice = 500) =>
  services.sales.create(org.user, {
    locationId: org.storeId,
    paymentMethod: PaymentMethod.CASH,
    items: [{ productId: breadId, quantity, unitPrice }],
  });
const setFlour = (price: number) => prisma.product.update({ where: { id: flourId }, data: { price } });
const pnl = () => services.finance.getProfitAndLoss(org.organizationId, from, to);

describe("cost snapshots on write", () => {
  it("a sale stamps its unit cost and basis on the line and the SALE movement", async () => {
    const sale = await sell(2);
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.unitCost?.toNumber()).toBe(50);
    expect(item.costBasis).toBe(CostBasis.RECIPE_CURRENT);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { saleId: sale.id, type: "SALE" } });
    expect(movement.unitCost?.toNumber()).toBe(50);
    expect(movement.costBasis).toBe(CostBasis.RECIPE_CURRENT);
  });

  it("a later ingredient price change moves neither the stamp nor the reported cost of that sale", async () => {
    const before = await pnl();
    await setFlour(300);
    try {
      const after = await pnl();
      expect(after.cogs).toBe(before.cogs);
      expect(after.costCoverage.fallbackLines).toBe(0);
      // …while a NEW sale is stamped at the new price.
      const sale = await sell(1);
      const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
      expect(item.unitCost?.toNumber()).toBe(150);
    } finally {
      await setFlour(100);
    }
  });

  it("a product with no known cost is stamped null — never zero", async () => {
    const mystery = (
      await prisma.product.create({
        data: { organizationId: org.organizationId, name: "Без цены", sku: "C-9", unit: "PCS", type: "FINISHED_GOOD", price: 200 },
      })
    ).id;
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: mystery, quantity: 5 });
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: mystery, quantity: 1, unitPrice: 200 }],
    });
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.unitCost).toBeNull();
    expect(item.costBasis).toBeNull();
    const report = await pnl();
    expect(report.costCoverage.unknownLines).toBeGreaterThanOrEqual(1);
  });

  it("snapshotCosts on hot paths returns exactly what the full computation returns", async () => {
    const costing = new CostingService(prisma);
    const all = await costing.currentUnitCosts(org.organizationId);
    const some = await costing.snapshotCosts(org.organizationId, [breadId, flourId]);
    expect(some.get(breadId)).toEqual(all.get(breadId));
    expect(some.get(flourId)).toEqual(all.get(flourId));
  });
});

describe("returns reverse at the original snapshot", () => {
  it("a restocked return gives back cost at the SALE's cost even after prices moved", async () => {
    const sale = await sell(2);
    const before = await pnl();
    await setFlour(400);
    try {
      await services.returns.create(org.user, sale.id, { items: [{ productId: breadId, quantity: 1 }] });
      const after = await pnl();
      expect(after.returnsTotal).toBe(before.returnsTotal + 500);
      expect(after.netRevenue).toBe(before.netRevenue - 500);
      // 50 — the cost the sale booked — not 200 (today's).
      expect(after.cogs).toBe(before.cogs - 50);
      const marker = await prisma.saleReturnItem.findFirstOrThrow({ where: { saleReturn: { saleId: sale.id } } });
      expect(marker.unitCost?.toNumber()).toBe(50);
    } finally {
      await setFlour(100);
    }
  });

  it("a scrapped return reverses revenue but keeps cost of goods, and its marker is not an inventory loss", async () => {
    const sale = await sell(2);
    const before = await pnl();
    await services.returns.create(org.user, sale.id, { items: [{ productId: breadId, quantity: 1 }], restocked: false });
    const after = await pnl();
    expect(after.netRevenue).toBe(before.netRevenue - 500);
    expect(after.cogs).toBe(before.cogs);
    expect(after.inventoryLosses).toBe(before.inventoryLosses);
    expect(after.inventoryLossLines.find((l) => l.kind === "WRITE_OFF")?.amount ?? 0).toBe(
      before.inventoryLossLines.find((l) => l.kind === "WRITE_OFF")?.amount ?? 0,
    );
  });

  it("partial returns add up: two half-returns equal one full return", async () => {
    const sale = await sell(2);
    const before = await pnl();
    await services.returns.create(org.user, sale.id, { items: [{ productId: breadId, quantity: 1 }] });
    await services.returns.create(org.user, sale.id, { items: [{ productId: breadId, quantity: 1 }] });
    const after = await pnl();
    expect(after.netRevenue).toBe(before.netRevenue - 1000);
    expect(after.cogs).toBe(before.cogs - 100);
  });
});

describe("P&L identities and rounding", () => {
  it("Gross revenue − Discounts − Returns = Net revenue, and gross profit ties to it", async () => {
    await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: breadId, quantity: 1, unitPrice: 300, fullUnitPrice: 500 }],
    });
    const p = await pnl();
    expect(p.discountsTotal).toBeGreaterThanOrEqual(200);
    expect(Math.round((p.grossRevenue - p.discountsTotal - p.returnsTotal) * 100)).toBe(Math.round(p.netRevenue * 100));
    expect(Math.round((p.netRevenue - p.cogs) * 100)).toBe(Math.round(p.grossProfit * 100));
    expect(Math.round((p.grossProfit - p.inventoryLosses - p.expensesTotal - p.depreciation) * 100)).toBe(
      Math.round(p.operatingProfit * 100),
    );
    expect(p.byProduct.reduce((s, r) => s + r.revenue, 0)).toBeCloseTo(p.netRevenue, 2);
  });

  it("no floating-point artifacts: money fields have at most two decimals", async () => {
    // A price that produces a repeating unit cost: 100 / 3 per loaf.
    await prisma.recipe.update({ where: { id: recipeId }, data: { yieldQuantity: 3, items: { updateMany: { where: {}, data: { quantity: 1 } } } } });
    try {
      await sell(3);
      await sell(7);
      const p = await pnl();
      const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
      for (const field of ["grossRevenue", "discountsTotal", "returnsTotal", "netRevenue", "cogs", "grossProfit", "inventoryLosses", "operatingProfit", "netProfit"] as const) {
        expect(twoDecimals(p[field])).toBe(true);
      }
      for (const row of p.byProduct) {
        expect(twoDecimals(row.cogs)).toBe(true);
        expect(twoDecimals(row.revenue)).toBe(true);
      }
    } finally {
      await prisma.recipe.update({ where: { id: recipeId }, data: { yieldQuantity: 4, items: { updateMany: { where: {}, data: { quantity: 2 } } } } });
    }
  });

  it("net profit is preliminary while income tax is not configured and never equals a silent 0% tax", async () => {
    const p = await pnl();
    expect(p.incomeTax).toBeNull();
    expect(p.netProfitStatus).toBe("PRELIMINARY");
    expect(p.notConfigured).toContain("INCOME_TAX");
    expect(p.netProfit).toBe(p.profitBeforeTax);
  });
});

describe("inventory losses", () => {
  it("write-offs and stocktake shortages are losses at the cost stamped on the movement; surplus nets against them", async () => {
    const before = await pnl();
    await services.inventory.writeOff(org.user, {
      locationId: org.storeId, productId: flourId, quantity: 2, reason: "Порча", writeOffReason: "DAMAGED" as never,
    });
    await setFlour(1000);
    try {
      const st = await services.stocktake.create(org.user, { locationId: org.storeId });
      const line = st.lines.find((l) => l.productId === flourId)!;
      await services.stocktake.updateLine(org.user, st.id, line.id, { countedQuantity: line.systemQuantity - 3 });
      await services.stocktake.submit(org.user, st.id);
      await services.stocktake.approve(org.user, st.id);
      const after = await pnl();
      // write-off 2 × 100 (its stamp) = 200; the count of −3 kg was valued at the price THEN (1000) = 3000.
      const wo = after.inventoryLossLines.find((l) => l.kind === "WRITE_OFF")!;
      const sc = after.inventoryLossLines.find((l) => l.kind === "STOCKTAKE")!;
      expect(wo.amount - (before.inventoryLossLines.find((l) => l.kind === "WRITE_OFF")?.amount ?? 0)).toBe(200);
      expect(sc.amount).toBe(3000);
    } finally {
      await setFlour(100);
    }
    // History does not move when the price comes back.
    const later = await pnl();
    expect(later.inventoryLossLines.find((l) => l.kind === "STOCKTAKE")?.amount).toBe(3000);
  });
});

describe("transfers and production", () => {
  it("both legs of a route transfer carry the same cost", async () => {
    const route = await services.logistics.create(org.user, {
      originLocationId: org.storeId,
      stops: [{ destinationLocationId: org.warehouseId, items: [{ productId: breadId, quantity: 2 }] }],
    } as never);
    await services.logistics.deliverStop(org.user, route.id, route.stops[0].id);
    const legs = await prisma.stockMovement.findMany({ where: { routeStopId: route.stops[0].id } });
    expect(legs).toHaveLength(2);
    expect(legs[0].unitCost).not.toBeNull();
    expect(legs[0].unitCost?.toNumber()).toBe(legs[1].unitCost?.toNumber());
    expect(legs[0].costBasis).toBe(legs[1].costBasis);
  });

  it("a completed batch stamps ingredient cost on consumption and output and stores only the INGREDIENT component", async () => {
    const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: 8 });
    await services.production.start(org.user, batch.id);
    const done = await services.production.complete(org.user, batch.id, { actualQuantity: 8 });
    // 8 loaves = 4 kg flour × 100 = 400 → 50 per loaf.
    const costs = await prisma.productionBatchCost.findMany({ where: { batchId: batch.id } });
    expect(costs).toHaveLength(1);
    expect(costs[0].component).toBe(ProductionCostComponent.INGREDIENT);
    expect(costs[0].amount.toNumber()).toBe(400);
    const output = await prisma.stockMovement.findFirstOrThrow({ where: { batchId: batch.id, type: "PRODUCTION_OUTPUT" } });
    expect(output.unitCost?.toNumber()).toBe(50);
    expect(output.costBasis).toBe(CostBasis.PRODUCTION_INGREDIENTS);
    const consumption = await prisma.stockMovement.findFirstOrThrow({ where: { batchId: batch.id, type: "PRODUCTION_CONSUMPTION" } });
    expect(consumption.unitCost?.toNumber()).toBe(100);
    // Every other component is listed as not configured — not zero, not omitted.
    expect(done.costComponents).toHaveLength(7);
    for (const c of done.costComponents!) {
      if (c.component === ProductionCostComponent.INGREDIENT) {
        expect(c).toMatchObject({ status: "ACTIVE", amount: 400 });
      } else {
        expect(c).toMatchObject({ status: "NOT_CONFIGURED", amount: null });
      }
    }
    // Batch cost is history: a price change afterwards does not touch it.
    await setFlour(999);
    try {
      const again = await prisma.productionBatchCost.findFirstOrThrow({ where: { batchId: batch.id } });
      expect(again.amount.toNumber()).toBe(400);
    } finally {
      await setFlour(100);
    }
  });

  it("purchase-order receipts are valued at what the order line cost", async () => {
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "П" } });
    const po = await services.procurement.create(org.user, {
      supplierId: supplier.id,
      locationId: org.storeId,
      items: [{ productId: flourId, quantity: 10, unitCost: 77 }],
    } as never);
    await services.procurement.receive(org.user, po.id);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    expect(movement.unitCost?.toNumber()).toBe(77);
    expect(movement.costBasis).toBe(CostBasis.PURCHASE_ACTUAL);
  });
});
