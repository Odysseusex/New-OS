import { PaymentMethod, WriteOffReason } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { checkLedgerConsistency } from "../finance/integrity/ledger-consistency";

// CONCURRENCY: operations that take stock away, fired at the same time against
// the same shelf. Under the current BLOCK behaviour stock must never go below
// zero, exactly as many operations succeed as the stock covers, the refused
// ones fail with the same message the read-check always produced, and the
// ledger still explains the cached level afterwards.

const prisma = new PrismaService();
const services = buildServices(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let n = 0;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "race");
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

async function product(type: "FINISHED_GOOD" | "RAW_MATERIAL", stock: number, locationId = org.storeId) {
  n += 1;
  const created = await prisma.product.create({
    data: {
      organizationId: org.organizationId,
      name: `Товар ${n}`,
      sku: `RACE-${n}`,
      unit: "PCS",
      type,
      price: 100,
    },
  });
  if (stock > 0) {
    await services.inventory.receive(org.user, { locationId, productId: created.id, quantity: stock });
  }
  return created.id;
}

async function level(productId: string, locationId = org.storeId) {
  const row = await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId } } });
  return row?.quantity.toNumber() ?? 0;
}

function outcome(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  return {
    ok: results.length - rejected.length,
    errors: rejected.map((r) => (r.reason as Error).message),
  };
}

const sell = (productId: string, quantity = 1) =>
  services.sales.create(org.user, {
    locationId: org.storeId,
    paymentMethod: PaymentMethod.CASH,
    items: [{ productId, quantity, unitPrice: 100 }],
  });

describe("atomic stock decrements under concurrency", () => {
  it("two simultaneous sales of the last unit: exactly one succeeds, stock ends at 0", async () => {
    const productId = await product("FINISHED_GOOD", 1);
    const result = outcome(await Promise.allSettled([sell(productId), sell(productId)]));

    expect(result.ok).toBe(1);
    expect(result.errors).toEqual(["Недостаточно товара «Товар 1» на складе точки"]);
    expect(await level(productId)).toBe(0);
    expect(await prisma.stockMovement.count({ where: { productId, type: "SALE" } })).toBe(1);
    // The losing sale left nothing behind: no sale row, no money.
    expect(await prisma.sale.count({ where: { organizationId: org.organizationId, items: { some: { productId } } } })).toBe(1);
  });

  it("eight simultaneous sales against 3 units: exactly 3 succeed", async () => {
    const productId = await product("FINISHED_GOOD", 3);
    const result = outcome(await Promise.allSettled(Array.from({ length: 8 }, () => sell(productId))));

    expect(result.ok).toBe(3);
    expect(result.errors).toHaveLength(5);
    expect(await level(productId)).toBe(0);
  });

  it("simultaneous write-offs cannot take more than is on the shelf", async () => {
    const productId = await product("RAW_MATERIAL", 5);
    const writeOff = () =>
      services.inventory.writeOff(org.user, {
        locationId: org.storeId,
        productId,
        quantity: 3,
        writeOffReason: WriteOffReason.DAMAGED,
      });
    const result = outcome(await Promise.allSettled([writeOff(), writeOff(), writeOff()]));

    expect(result.ok).toBe(1);
    expect(new Set(result.errors)).toEqual(new Set(["Недостаточно товара на складе для списания"]));
    expect(await level(productId)).toBe(2);
    // A refused write-off also leaves no movement row behind.
    expect(await prisma.stockMovement.count({ where: { productId, type: "WRITE_OFF" } })).toBe(1);
  });

  it("a sale racing a write-off for the same last units: one of them is refused", async () => {
    const productId = await product("FINISHED_GOOD", 2);
    const result = outcome(
      await Promise.allSettled([
        sell(productId, 2),
        services.inventory.writeOff(org.user, {
          locationId: org.storeId,
          productId,
          quantity: 2,
          writeOffReason: WriteOffReason.EXPIRED,
        }),
      ]),
    );
    expect(result.ok).toBe(1);
    expect(await level(productId)).toBe(0);
  });

  it("two production batches competing for the same flour: one is refused, flour never negative", async () => {
    const flourId = await product("RAW_MATERIAL", 10);
    const breadId = await product("FINISHED_GOOD", 0);
    const recipe = await prisma.recipe.create({
      data: {
        organizationId: org.organizationId,
        productId: breadId,
        yieldQuantity: 1,
        items: { create: [{ ingredientProductId: flourId, quantity: 6 }] },
      },
    });
    const batches = [];
    for (let i = 0; i < 2; i += 1) {
      const batch = await services.production.create(org.user, {
        locationId: org.storeId,
        recipeId: recipe.id,
        plannedQuantity: 1,
      });
      await services.production.start(org.user, batch.id);
      batches.push(batch.id);
    }
    const result = outcome(
      await Promise.allSettled(batches.map((id) => services.production.complete(org.user, id, { actualQuantity: 1 }))),
    );

    expect(result.ok).toBe(1);
    expect(result.errors[0]).toMatch(/Недостаточно ингредиента/);
    expect(await level(flourId)).toBe(4);
    expect(await level(breadId)).toBe(1);
    expect(await prisma.productionBatch.count({ where: { recipeId: recipe.id, status: "COMPLETED" } })).toBe(1);
  });

  it("two deliveries shipping the same stock at once: one is refused", async () => {
    const productId = await product("FINISHED_GOOD", 4);
    const route = await services.logistics.create(org.user, {
      originLocationId: org.storeId,
      stops: [
        { destinationLocationId: org.warehouseId, items: [{ productId, quantity: 3 }] },
        { destinationLocationId: org.warehouseId, items: [{ productId, quantity: 3 }] },
      ],
    });
    const result = outcome(
      await Promise.allSettled(route.stops.map((s) => services.logistics.deliverStop(org.user, route.id, s.id))),
    );

    expect(result.ok).toBe(1);
    expect(result.errors[0]).toMatch(/в точке отправления/);
    expect(await level(productId)).toBe(1);
    expect(await level(productId, org.warehouseId)).toBe(3);
  });

  it("a correction down to zero racing a sale cannot push stock negative", async () => {
    const productId = await product("RAW_MATERIAL", 5);
    const results = await Promise.allSettled([
      sell(productId, 5),
      services.inventory.adjust(org.user, { locationId: org.storeId, productId, actualQuantity: 0, reason: "Пересчёт" }),
    ]);
    expect(await level(productId)).toBeGreaterThanOrEqual(0);
    expect(outcome(results).ok).toBeGreaterThanOrEqual(1);
  });

  it("ordinary single operations behave exactly as before", async () => {
    const productId = await product("FINISHED_GOOD", 3);
    await sell(productId, 2);
    expect(await level(productId)).toBe(1);
    const { name } = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    await expect(sell(productId, 2)).rejects.toThrow(`Недостаточно товара «${name}» на складе точки`);
    await expect(
      services.inventory.writeOff(org.user, {
        locationId: org.storeId,
        productId,
        quantity: 5,
        writeOffReason: WriteOffReason.DAMAGED,
      }),
    ).rejects.toThrow("Недостаточно товара на складе для списания");
    await services.inventory.adjust(org.user, { locationId: org.storeId, productId, actualQuantity: 0, reason: "Пересчёт" });
    expect(await level(productId)).toBe(0);
  });

  it("after every race the ledger still explains every cached level", async () => {
    const report = await checkLedgerConsistency(prisma, org.organizationId);
    expect(report.stock.drifts).toEqual([]);
    expect(report.stock.negativeLevels).toEqual([]);
    expect(report.cash.drifts).toEqual([]);
  });
});
