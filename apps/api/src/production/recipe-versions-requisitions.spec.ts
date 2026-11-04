import { debtDateKey, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { RecipesService } from "../recipes/recipes.service";
import { MaterialRequisitionsService } from "./requisitions.service";

// ТЗ §4: брутто / % потерь / нетто per ingredient, a new recipe version on each
// change of composition (a completed batch names its version), and the
// «требование-накладная» that issues the plan's raw materials from the warehouse
// to the workshop as a transfer. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const recipes = new RecipesService(prisma);
const requisitions = new MaterialRequisitionsService(prisma, services.costing);
let org: IsolatedOrg;
let flourId: string;
let sugarId: string;
let waterId: string;
let cakeId: string;
let recipeId: string;

const level = async (locationId: string, productId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId } } }))?.quantity.toNumber() ?? 0;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "recipe-versions");
  const id = org.organizationId;
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "RV-1", type: ProductType.RAW_MATERIAL, price: 400, unit: Unit.KG } })).id;
  sugarId = (await prisma.product.create({ data: { organizationId: id, name: "Сахар", sku: "RV-2", type: ProductType.RAW_MATERIAL, price: 600, unit: Unit.KG } })).id;
  waterId = (await prisma.product.create({ data: { organizationId: id, name: "Вода", sku: "RV-3", type: ProductType.RAW_MATERIAL, price: 0, unit: Unit.L, trackInventory: false } })).id;
  cakeId = (await prisma.product.create({ data: { organizationId: id, name: "Торт", sku: "RV-4", type: ProductType.FINISHED_GOOD, price: 9000, unit: Unit.PCS } })).id;
  await services.inventory.receive(org.user, { locationId: org.warehouseId, productId: flourId, quantity: 20 } as never);
  await services.inventory.receive(org.user, { locationId: org.warehouseId, productId: sugarId, quantity: 10 } as never);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("recipe losses and versions", () => {
  it("keeps брутто, shows нетто by the ingredient's loss, and writes version 1", async () => {
    const r = await recipes.create(org.user, {
      productId: cakeId,
      yieldQuantity: 10,
      items: [
        { ingredientProductId: flourId, quantity: 5, lossPercent: 2 },
        { ingredientProductId: sugarId, quantity: 2 },
        { ingredientProductId: waterId, quantity: 3 },
      ],
    });
    recipeId = r.id;
    const flour = r.items.find((i) => i.ingredientProductId === flourId)!;
    expect(flour).toMatchObject({ quantity: 5, lossPercent: 2, netQuantity: 4.9 });
    expect(r.items.find((i) => i.ingredientProductId === sugarId)).toMatchObject({ lossPercent: null, netQuantity: 2 });
    // Cost stays on брутто: 5 × 400 + 2 × 600 = 3200 for 10.
    expect(r.unitCost).toBe(320);
    expect(r.versions).toHaveLength(1);
    expect(r.versions[0]).toMatchObject({ number: 1, yieldQuantity: 10 });
    expect(r.versions[0].items.find((i) => i.ingredientProductId === flourId)).toMatchObject({ quantity: 5, lossPercent: 2, netQuantity: 4.9 });
  });

  it("a note edit is not a new version; a change of composition is", async () => {
    let r = await recipes.update(org.user, recipeId, { generalNotes: "Печь при 180" });
    expect(r.versions).toHaveLength(1);
    r = await recipes.update(org.user, recipeId, {
      items: [
        { ingredientProductId: flourId, quantity: 6, lossPercent: 2 },
        { ingredientProductId: sugarId, quantity: 2 },
        { ingredientProductId: waterId, quantity: 3 },
      ],
    });
    expect(r.versions.map((v) => v.number)).toEqual([2, 1]);
    expect(r.versions[0].items.find((i) => i.ingredientProductId === flourId)?.quantity).toBe(6);
    expect(r.versions[1].items.find((i) => i.ingredientProductId === flourId)?.quantity).toBe(5);
    // Loss alone also changes the composition.
    r = await recipes.update(org.user, recipeId, {
      items: [
        { ingredientProductId: flourId, quantity: 6, lossPercent: 3 },
        { ingredientProductId: sugarId, quantity: 2 },
        { ingredientProductId: waterId, quantity: 3 },
      ],
    });
    expect(r.versions[0]).toMatchObject({ number: 3 });
    // Versions cannot be rewritten.
    await expect(prisma.recipeVersion.update({ where: { id: r.versions[1].id }, data: { createdByName: "x" } })).rejects.toThrow(/append-only/);
  });

  it("a completed batch names the version it was produced by", async () => {
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: flourId, quantity: 6 } as never);
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: sugarId, quantity: 2 } as never);
    const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: 10 });
    expect(batch.recipeVersionNumber).toBeNull();
    await services.production.start(org.user, batch.id);
    const done = await services.production.complete(org.user, batch.id, { actualQuantity: 10 } as never);
    expect(done.recipeVersionNumber).toBe(3);
  });
});

describe("требование-накладная", () => {
  const today = debtDateKey(new Date());

  it("computes the need of the day's plan by the recipes, tracked ingredients only", async () => {
    const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: 20 });
    const need = await requisitions.need(org.user, { fromLocationId: org.warehouseId, toLocationId: org.storeId, date: today });
    expect(need.batches.map((b) => b.id)).toContain(batch.id);
    // 20 cakes: 12 kg flour, 4 kg sugar; water is not held as stock.
    expect(need.lines.map((l) => [l.productName, l.requiredQuantity, l.fromStock])).toEqual([
      ["Мука", 12, 20],
      ["Сахар", 4, 10],
    ]);
    const none = await requisitions.need(org.user, { fromLocationId: org.warehouseId, toLocationId: org.storeId, date: today, batchIds: [] });
    expect(none.lines).toEqual([]);
  });

  it("posts the issued quantity as a transfer warehouse → workshop, once", async () => {
    const req = await requisitions.create(org.user, {
      fromLocationId: org.warehouseId,
      toLocationId: org.storeId,
      planDate: today,
      lines: [
        { productId: flourId, requiredQuantity: 12, quantity: 13 },
        { productId: sugarId, requiredQuantity: 4, quantity: 4 },
      ],
    });
    expect(req).toMatchObject({ status: "DRAFT", planDate: today });
    const edited = await requisitions.update(org.user, req.id, {
      lines: [
        { productId: flourId, requiredQuantity: 12, quantity: 12.5 },
        { productId: sugarId, requiredQuantity: 4, quantity: 4 },
      ],
    });
    expect(edited.lines.find((l) => l.productId === flourId)?.quantity).toBe(12.5);

    const storeFlourBefore = await level(org.storeId, flourId);
    const posted = await requisitions.post(org.user, req.id);
    expect(posted).toMatchObject({ status: "POSTED", postedByName: org.user.fullName });
    expect(await level(org.warehouseId, flourId)).toBe(7.5);
    expect(await level(org.storeId, flourId)).toBe(storeFlourBefore + 12.5);
    const moves = await prisma.stockMovement.findMany({ where: { materialRequisitionId: req.id } });
    expect(moves.map((m) => m.type).sort()).toEqual(["TRANSFER_IN", "TRANSFER_IN", "TRANSFER_OUT", "TRANSFER_OUT"]);
    // Both legs at the same cost.
    const flourMoves = moves.filter((m) => m.productId === flourId);
    expect(flourMoves[0].unitCost?.toNumber()).toBe(flourMoves[1].unitCost?.toNumber());

    await expect(requisitions.post(org.user, req.id)).rejects.toThrow(/уже проведено/);
    await expect(requisitions.update(org.user, req.id, { lines: [{ productId: flourId, quantity: 1 }] })).rejects.toThrow(/не меняется/);
    await expect(requisitions.remove(org.user, req.id)).rejects.toThrow(/удалить нельзя/);
  });

  it("refuses to issue more than the warehouse holds, and an untracked item", async () => {
    await expect(
      requisitions.create(org.user, { fromLocationId: org.warehouseId, toLocationId: org.storeId, planDate: today, lines: [{ productId: waterId, quantity: 1 }] }),
    ).rejects.toThrow(/Не выдаётся/);
    const req = await requisitions.create(org.user, {
      fromLocationId: org.warehouseId,
      toLocationId: org.storeId,
      planDate: today,
      lines: [{ productId: sugarId, quantity: 100 }],
    });
    await expect(requisitions.post(org.user, req.id)).rejects.toThrow(/Недостаточно «Сахар»/);
    expect((await requisitions.findOne(org.user, req.id)).status).toBe("DRAFT");
    await requisitions.remove(org.user, req.id);
    expect((await requisitions.list(org.user)).map((r) => r.number)).toEqual([1]);
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.materialRequisitions.filter((a) => !logged.has(a))).toEqual([]);
  });
});
