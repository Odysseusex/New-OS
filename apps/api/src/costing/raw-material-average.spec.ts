import { CostBasis, PaymentMethod, ProductType, Unit, WriteOffReason } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { CostingService } from "./costing.service";
import { LedgerService } from "../ledger/ledger.service";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { BalanceService } from "../finance/balance/balance.service";
import { RecipesService } from "../recipes/recipes.service";

// Raw materials at a moving weighted average of what they were bought for: every
// priced receipt (Склад → Приёмка, a purchase order) moves it, everything costed
// from then on uses it, history keeps the cost it was stamped with, and the books
// still agree with the stock.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const costing = new CostingService(prisma);
const recipes = new RecipesService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let supplierId: string;
let flourId: string;
let saltId: string;
let breadId: string;
let recipeId: string;

const product = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });
const avgOf = async (id: string) => (await product(id)).averageUnitCost?.toNumber() ?? null;
const receivePo = async (productId: string, quantity: number, unitCost: number) => {
  const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId, quantity, unitCost }] } as never);
  await services.procurement.receive(org.user, po.id);
};
const receive = (lines: { productId: string; quantity: number; unitPrice?: number }[]) =>
  services.inventory.applyBatch(org.user, "receive", { locationId: org.storeId, lines });

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "raw-average");
  await startLedger(ledger, org);
  const id = org.organizationId;
  supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Мельница" } })).id;
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "RA-1", type: ProductType.RAW_MATERIAL, price: 300, unit: Unit.KG } })).id;
  saltId = (await prisma.product.create({ data: { organizationId: id, name: "Соль", sku: "RA-2", type: ProductType.RAW_MATERIAL, price: 100, unit: Unit.KG } })).id;
  breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "RA-3", type: ProductType.FINISHED_GOOD, price: 500, unit: Unit.PCS } })).id;
  recipeId = (await prisma.recipe.create({ data: { organizationId: id, productId: breadId, yieldQuantity: 10, items: { create: [{ ingredientProductId: flourId, quantity: 5 }] } } })).id;
  await services.procurement.activateCutover(org.user);
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("the average moves with what was paid", () => {
  it("a purchase order and a priced receipt average out; the card keeps the latest price", async () => {
    await receivePo(flourId, 10, 300);
    expect(await avgOf(flourId)).toBe(300);
    await receive([{ productId: flourId, quantity: 10, unitPrice: 360 }]);
    expect(await avgOf(flourId)).toBe(330); // (10 × 300 + 10 × 360) ÷ 20
    expect((await product(flourId)).price.toNumber()).toBe(360);

    const row = await prisma.stockMovement.findFirstOrThrow({ where: { productId: flourId, purchaseOrderId: null, type: "RECEIPT" } });
    expect(row.unitCost?.toNumber()).toBe(360);
    expect(row.costBasis).toBe(CostBasis.PURCHASE_ACTUAL);

    const costs = await costing.currentUnitCosts(org.organizationId);
    expect(costs.get(flourId)).toEqual({ unitCost: 330, basis: CostBasis.RAW_MATERIAL_AVERAGE });
    expect((await recipes.findAllForOrganization(org.organizationId)).find((r) => r.id === recipeId)?.unitCost).toBe(165); // 5 kg × 330 ÷ 10
  });

  it("stock already on the shelf enters at the card's price, and a receipt without a price leaves the average alone", async () => {
    await receive([{ productId: saltId, quantity: 10 }]); // no price: the old way
    expect(await avgOf(saltId)).toBeNull();
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: saltId, quantity: 10, unitPrice: 200 });
    expect(await avgOf(saltId)).toBe(150); // 10 at the card's 100 + 10 at 200

    await receive([{ productId: saltId, quantity: 5 }]);
    expect(await avgOf(saltId)).toBe(150);
    const unpriced = await prisma.stockMovement.findFirstOrThrow({ where: { productId: saltId }, orderBy: { createdAt: "desc" } });
    expect(unpriced.unitCost?.toNumber()).toBe(150);
  });

  it("a price is only for a raw material, and only on a receipt", async () => {
    await expect(receive([{ productId: breadId, quantity: 1, unitPrice: 100 }])).rejects.toThrow("только для сырья: Хлеб");
    await expect(
      services.inventory.applyBatch(org.user, "write-off", {
        locationId: org.storeId,
        writeOffReason: WriteOffReason.OTHER,
        lines: [{ productId: flourId, quantity: 1, unitPrice: 100 }],
      }),
    ).rejects.toThrow("только при приёмке");
  });
});

describe("production, sales and the books", () => {
  it("bakes at the average, keeps what was stamped, and the ledger agrees with the stock", async () => {
    const batch = await services.production.create(org.user, { recipeId, plannedQuantity: 10, locationId: org.storeId } as never);
    await services.production.start(org.user, batch.id);
    await services.production.complete(org.user, batch.id, { actualQuantity: 10 } as never);
    const consumed = await prisma.stockMovement.findFirstOrThrow({ where: { batchId: batch.id, type: "PRODUCTION_CONSUMPTION" } });
    expect(consumed.unitCost?.toNumber()).toBe(330);
    expect(consumed.costBasis).toBe(CostBasis.RAW_MATERIAL_AVERAGE);
    const output = await prisma.stockMovement.findFirstOrThrow({ where: { batchId: batch.id, type: "PRODUCTION_OUTPUT" } });
    expect(output.unitCost?.toNumber()).toBe(165);

    // Flour gets dearer: 15 kg on hand at 330, 5 kg arrive at 400.
    await receivePo(flourId, 5, 400);
    expect(await avgOf(flourId)).toBe(347.5);

    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 4, unitPrice: 500 }] } as never);
    const sold = await prisma.saleItem.findFirstOrThrow({ where: { productId: breadId } });
    expect(sold.unitCost?.toNumber()).toBe(173.75); // today's recipe: 5 × 347.5 ÷ 10
    await services.inventory.writeOff(org.user, { productId: flourId, quantity: 1, locationId: org.storeId, writeOffReason: WriteOffReason.EXPIRED } as never);

    // The moving-average identity, per raw material: what came in at its cost minus
    // what went out at the average then = what is left × today's average. The
    // stock side and the movements' own values never drift apart.
    for (const id of [flourId, saltId]) {
      const moves = await prisma.stockMovement.findMany({ where: { productId: id } });
      const value = moves.reduce((sum, m) => {
        const amount = m.quantity.toNumber() * (m.unitCost?.toNumber() ?? 0);
        return m.type === "RECEIPT" || m.type === "ADJUSTMENT" ? sum + amount : sum - amount;
      }, 0);
      const level = await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: id } } });
      expect(value).toBeCloseTo(level.quantity.toNumber() * ((await avgOf(id)) as number), 2);
    }

    // With the general ledger on, everything bought through a purchase order is in it at what it cost.
    const reports = new LedgerReportsService(prisma, services.finance);
    const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), reports, ledger);
    const result = await diagnostics.run(org.organizationId);
    expect(result.checks.filter((c) => c.status === "FAIL").map((c) => c.check)).toEqual(["INVENTORY_SUBLEDGER"]);
    // …the difference being exactly what was never posted (manual receipts with no supplier
    // document, unclassified as before) plus the baked bread on the shelf revalued at today's
    // recipe (10 loaves × (173.75 − 165)), which is how finished goods were always valued.
    const inventory = result.checks.find((c) => c.check === "INVENTORY_SUBLEDGER")!;
    expect(inventory.difference).toBeCloseTo(-(3600 + 1000 + 2000 + 750 + 87.5), 2);
  });
});
