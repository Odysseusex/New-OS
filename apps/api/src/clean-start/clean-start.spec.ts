import { PaymentMethod, ProductType, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { CleanStartService } from "./clean-start.service";
import { CLEAN_START_KEPT_TABLES, CLEAN_START_REMOVED_TABLES } from "./clean-start-plan";

// «Начать учёт с чистого листа» on an organization with purchases, production, sales, a
// return, money and points: the history goes, recipes and the catalogue stay. Own org.

const prisma = new PrismaService();
const services = buildServices(prisma);
const cleanStart = new CleanStartService(prisma);
let org: IsolatedOrg;
let flourId: string;
let cakeId: string;
let recipeId: string;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "clean-start");
  const id = org.organizationId;
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "CS-1", type: ProductType.RAW_MATERIAL, price: 400, unit: Unit.KG } })).id;
  cakeId = (await prisma.product.create({ data: { organizationId: id, name: "Торт", sku: "CS-2", type: ProductType.FINISHED_GOOD, price: 1000, unit: Unit.PCS } })).id;
  recipeId = (await prisma.recipe.create({ data: { organizationId: id, productId: cakeId, yieldQuantity: 1, items: { create: [{ ingredientProductId: flourId, quantity: 0.5 }] } } })).id;
  await prisma.recipeVersion.create({ data: { organizationId: id, recipeId, number: 1, validFrom: new Date(), createdByName: "Тест", yieldQuantity: 1, items: [] } });
  const supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Мельница" } })).id;
  const customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Мерей" } })).id;

  // Two months of «history», in miniature.
  const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost: 450 }] } as never);
  await services.procurement.receive(org.user, po.id);
  const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: 4 });
  await services.production.start(org.user, batch.id);
  await services.production.complete(org.user, batch.id, { actualQuantity: 4 });
  const sale = await services.sales.create(org.user, {
    locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: cakeId, quantity: 2, unitPrice: 1000 }],
  } as never);
  await services.returns.create(org.user, sale.id, { items: [{ productId: cakeId, quantity: 1 }], restocked: true } as never);
  await services.sales.create(org.user, {
    locationId: org.storeId, customerId, amountPaid: 0, paymentMethod: PaymentMethod.TRANSFER, items: [{ productId: cakeId, quantity: 1, unitPrice: 1000 }],
  } as never);
  await services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 0, reason: "Пересчёт", ownerWithdrawal: true });
  await prisma.organization.update({ where: { id }, data: { financeInitializedAt: new Date(), openingInventoryValue: 5 } });
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const count = async (table: string) =>
  Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table}" WHERE "organizationId" = $1`, org.organizationId))[0].n);

it("every table of an organization is either wiped or kept — none forgotten", async () => {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId' AND table_name <> 'organizations'`;
  const all = rows.map((r) => r.table_name).sort();
  const classified = [...CLEAN_START_REMOVED_TABLES, ...CLEAN_START_KEPT_TABLES].sort();
  expect(all).toEqual(classified);
  expect(CLEAN_START_REMOVED_TABLES.filter((t) => CLEAN_START_KEPT_TABLES.includes(t))).toEqual([]);
});

it("refuses anyone but the owner, without a fresh backup, and without the word", async () => {
  await expect(cleanStart.preview({ ...org.user, role: Role.ADMIN })).rejects.toThrow("собственника");
  const preview = await cleanStart.preview(org.user);
  expect(preview.backupFresh).toBe(false);
  expect(preview.remove.find((g) => g.label === "Продажи и чеки")?.count).toBe(2);
  await expect(cleanStart.execute(org.user, "ОЧИСТИТЬ")).rejects.toThrow("резервную копию");
  await prisma.auditLog.create({ data: { organizationId: org.organizationId, actorId: org.user.id, action: "dataExport.download", entityType: "DataExport", entityId: "all" } });
  await expect(cleanStart.execute(org.user, "да")).rejects.toThrow("ОЧИСТИТЬ");
  expect(await count("sales")).toBe(2);
});

it("wipes the history, keeps recipes and the catalogue, and starts the money from zero", async () => {
  const keptBefore = Object.fromEntries(await Promise.all(CLEAN_START_KEPT_TABLES.filter((t) => t !== "audit_logs").map(async (t) => [t, await count(t)])));
  const result = await cleanStart.execute(org.user, "очистить");
  expect(result.removed.find((g) => g.label === "Продажи и чеки")?.count).toBe(2);

  for (const table of CLEAN_START_REMOVED_TABLES) expect([table, await count(table)]).toEqual([table, 0]);
  for (const [table, n] of Object.entries(keptBefore)) expect([table, await count(table)]).toEqual([table, n]);
  expect(await prisma.recipeItem.count({ where: { recipeId } })).toBe(1);

  const accounts = await prisma.cashAccount.findMany({ where: { organizationId: org.organizationId } });
  expect(accounts.every((a) => a.currentBalance.toNumber() === 0)).toBe(true);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: flourId } })).averageUnitCost).toBeNull();
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });
  expect(organization.financeInitializedAt).toBeNull();
  expect(organization.openingInventoryValue).toBeNull();
  expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "organization.cleanStart" } })).toBe(1);

  // Business goes on: a new receipt and sale work on the clean books.
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: cakeId, quantity: 3 } as never);
  await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: cakeId, quantity: 1, unitPrice: 1000 }] } as never);
  expect((await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.cashAccountId } })).currentBalance.toNumber()).toBe(1000);
  // The opening stock entered as a receipt is not a gain in the P&L (a stocktake surplus would be).
  const pnl = await services.finance.getProfitAndLoss(org.organizationId, new Date(Date.now() - 60_000), new Date());
  expect(pnl.inventoryLosses).toBe(0);
});
