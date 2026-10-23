import { ProductType, Unit, WriteOffReason } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { InventoryService } from "./inventory.service";

// Склад: receive / write off / correct several products in ONE document, all-or-nothing.

const prisma = new PrismaService();
const inventory = new InventoryService(prisma);
let org: IsolatedOrg;
let breadId: string;
let bunId: string;
let n = 0;

const product = (name: string, extra: object = {}) =>
  prisma.product.create({
    data: { organizationId: org.organizationId, name, sku: `SB-${++n}`, unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 300, ...extra } as never,
  });
const level = async (productId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: org.storeId, productId } } }))?.quantity.toNumber() ?? 0;
const movementCount = () => prisma.stockMovement.count({ where: { organizationId: org.organizationId } });

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "stock-batch");
  breadId = (await product("Хлеб")).id;
  bunId = (await product("Булочка")).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("receives several products at once", async () => {
  const result = await inventory.applyBatch(org.user, "receive", {
    locationId: org.storeId,
    lines: [
      { productId: breadId, quantity: 10 },
      { productId: bunId, quantity: 5 },
    ],
  });
  expect(result).toEqual({ created: 2, unchanged: [] });
  expect([await level(breadId), await level(bunId)]).toEqual([10, 5]);
  const rows = await prisma.stockMovement.findMany({ where: { organizationId: org.organizationId, type: "RECEIPT" } });
  expect(rows.map((r) => r.reason)).toEqual(["Поступление", "Поступление"]);
});

it("writes off nothing at all when one line is short, and names that product", async () => {
  const before = await movementCount();
  await expect(
    inventory.applyBatch(org.user, "write-off", {
      locationId: org.storeId,
      writeOffReason: WriteOffReason.EXPIRED,
      lines: [
        { productId: breadId, quantity: 3 },
        { productId: bunId, quantity: 50 },
      ],
    }),
  ).rejects.toThrow("Недостаточно товара на складе для списания: Булочка");
  // The bread line was rolled back together with it.
  expect([await level(breadId), await level(bunId)]).toEqual([10, 5]);
  expect(await movementCount()).toBe(before);
});

it("writes off several products with one reason", async () => {
  const result = await inventory.applyBatch(org.user, "write-off", {
    locationId: org.storeId,
    writeOffReason: WriteOffReason.EXPIRED,
    reason: "Вчерашние",
    lines: [
      { productId: breadId, quantity: 2 },
      { productId: bunId, quantity: 1 },
    ],
  });
  expect(result.created).toBe(2);
  expect([await level(breadId), await level(bunId)]).toEqual([8, 4]);
  const rows = await prisma.stockMovement.findMany({ where: { organizationId: org.organizationId, type: "WRITE_OFF" } });
  expect(rows.every((r) => r.writeOffReason === "EXPIRED" && r.reason === "Вчерашние")).toBe(true);
});

it("corrects to the counted quantities, skipping lines that already match", async () => {
  const result = await inventory.applyBatch(org.user, "adjustment", {
    locationId: org.storeId,
    reason: "Пересчёт",
    lines: [
      { productId: breadId, quantity: 8 }, // already right
      { productId: bunId, quantity: 1 },
    ],
  });
  expect(result).toEqual({ created: 1, unchanged: ["Хлеб"] });
  expect([await level(breadId), await level(bunId)]).toEqual([8, 1]);
  const adj = await prisma.stockMovement.findFirstOrThrow({ where: { organizationId: org.organizationId, type: "ADJUSTMENT" } });
  expect(adj.quantity.toNumber()).toBe(-3);
  await expect(
    inventory.applyBatch(org.user, "adjustment", { locationId: org.storeId, reason: "Пересчёт", lines: [{ productId: breadId, quantity: 8 }] }),
  ).rejects.toThrow("совпадают");
});

it("refuses a product twice, an unstocked product and a semi-finished receipt", async () => {
  await expect(
    inventory.applyBatch(org.user, "receive", {
      locationId: org.storeId,
      lines: [
        { productId: breadId, quantity: 1 },
        { productId: breadId, quantity: 2 },
      ],
    }),
  ).rejects.toThrow("дважды");
  const water = await product("Вода", { trackInventory: false });
  await expect(inventory.applyBatch(org.user, "receive", { locationId: org.storeId, lines: [{ productId: water.id, quantity: 1 }] })).rejects.toThrow("Вода");
  const cream = await product("Крем", { type: ProductType.SEMI_FINISHED, trackInventory: true, unit: Unit.KG });
  await expect(inventory.applyBatch(org.user, "receive", { locationId: org.storeId, lines: [{ productId: cream.id, quantity: 1 }] })).rejects.toThrow("Полуфабрикат");
  await expect(inventory.applyBatch(org.user, "receive", { locationId: org.storeId, lines: [{ productId: breadId, quantity: 0 }] })).rejects.toThrow("больше нуля");
});
