import { PaymentMethod, WriteOffReason } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../../test/support/isolated-org";
import { buildServices } from "../../../test/support/services";
import { stockEffectOf } from "../../common/ledger-effects";
import { checkLedgerConsistency } from "./ledger-consistency";

// CONTRACT TEST for the read-only consistency diagnostic. It drives every
// stock-moving and cash-moving flow through the REAL services, so it proves the
// sign rules in common/ledger-effects.ts are the rules the services actually
// obey — if a service ever changes how it writes a movement, this fails.
//
// Runs in its own throwaway organization (test/support/isolated-org.ts).

const prisma = new PrismaService();
const services = buildServices(prisma);

let org: IsolatedOrg;
let flourId: string;
let breadId: string;
let supplierId: string;
let customerId: string;
const originalFiscal = process.env.FISCALIZATION_ENABLED;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "ledger");
  const { user, organizationId, storeId, warehouseId, bankAccountId } = org;

  const flour = await prisma.product.create({
    data: { organizationId, name: "Мука", sku: "ING-1", unit: "KG", type: "RAW_MATERIAL", price: 100 },
  });
  const bread = await prisma.product.create({
    data: { organizationId, name: "Хлеб", sku: "PRD-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 },
  });
  flourId = flour.id;
  breadId = bread.id;
  const recipe = await prisma.recipe.create({
    data: {
      organizationId,
      productId: breadId,
      yieldQuantity: 4,
      items: { create: [{ ingredientProductId: flourId, quantity: 2 }] },
    },
  });
  supplierId = (await prisma.supplier.create({ data: { organizationId, name: "Поставщик" } })).id;
  customerId = (await prisma.customer.create({ data: { organizationId, name: "Оптовик" } })).id;

  // ── stock flows ──────────────────────────────────────────────────────────
  await services.inventory.receive(user, { locationId: storeId, productId: flourId, quantity: 50 });
  await services.inventory.writeOff(user, {
    locationId: storeId,
    productId: flourId,
    quantity: 5,
    reason: "Порча",
    writeOffReason: WriteOffReason.DAMAGED,
  });
  await services.inventory.adjust(user, { locationId: storeId, productId: flourId, actualQuantity: 40, reason: "Пересчёт" });
  await services.inventory.adjust(user, { locationId: storeId, productId: flourId, actualQuantity: 42, reason: "Пересчёт" });

  const po = await services.procurement.create(user, {
    supplierId,
    locationId: storeId,
    items: [{ productId: flourId, quantity: 10, unitCost: 100 }],
  });
  await services.procurement.receive(user, po.id);

  const invoice = await services.invoices.create(user, {
    supplierId,
    locationId: storeId,
    number: "T-1",
    items: [{ productId: flourId, quantity: 5, unitCost: 100 }],
  });
  await services.invoices.confirm(user, invoice.id);
  await services.invoices.recordPayment(user, invoice.id, { accountId: bankAccountId, amount: 200 });

  const batch = await services.production.create(user, { locationId: storeId, recipeId: recipe.id, plannedQuantity: 8 });
  await services.production.start(user, batch.id);
  await services.production.complete(user, batch.id, { actualQuantity: 8 });

  // ── sales, returns (restocked and scrapped), transfer ────────────────────
  const cashSale = await services.sales.create(user, {
    locationId: storeId,
    paymentMethod: PaymentMethod.CASH,
    items: [{ productId: breadId, quantity: 3, unitPrice: 500 }],
  });
  const cardSale = await services.sales.create(user, {
    locationId: storeId,
    paymentMethod: PaymentMethod.CARD,
    items: [{ productId: breadId, quantity: 2, unitPrice: 500 }],
  });
  await services.sales.create(user, {
    locationId: storeId,
    customerId,
    amountPaid: 0,
    items: [{ productId: breadId, quantity: 1, unitPrice: 500 }],
  });
  await services.returns.create(user, cashSale.id, { items: [{ productId: breadId, quantity: 1 }] });
  await services.returns.create(user, cardSale.id, { items: [{ productId: breadId, quantity: 1 }], restocked: false });

  const route = await services.logistics.create(user, {
    originLocationId: storeId,
    stops: [{ destinationLocationId: warehouseId, items: [{ productId: breadId, quantity: 1 }] }],
  });
  await services.logistics.deliverStop(user, route.id, route.stops[0].id);

  // ── cash flows on top of the sale receipts and the invoice payment ───────
  await services.cash.deposit(user, { accountId: org.cashAccountId, amount: 1000, reason: "Пополнение" });
  await services.cash.withdraw(user, { accountId: org.cashAccountId, amount: 200, reason: "Снятие" });
  await services.cash.transfer(user, { fromAccountId: org.cashAccountId, toAccountId: bankAccountId, amount: 300 });
  await services.finance.createExpense(user, { amount: 150, paidImmediately: true, accountId: org.cashAccountId });
  const cashNow = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.cashAccountId } })).currentBalance.toNumber();
  await services.cash.adjust(user, { accountId: org.cashAccountId, actualBalance: cashNow - 40, reason: "Недостача" });
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

describe("checkLedgerConsistency", () => {
  it("finds no drift after every real stock and cash flow has run", async () => {
    const report = await checkLedgerConsistency(prisma, org.organizationId);
    expect(report.stock.drifts).toEqual([]);
    expect(report.cash.drifts).toEqual([]);
    expect(report.isConsistent).toBe(true);
    expect(report.stock.levelsChecked).toBeGreaterThanOrEqual(3);
    expect(report.cash.accountsChecked).toBe(2);
  });

  it("counts the scrapped-return write-off as a marker, not a removal", async () => {
    const report = await checkLedgerConsistency(prisma, org.organizationId);
    expect(report.stock.returnScrapMarkers).toBe(1);

    // Proof the special case is load-bearing: summing that same row as an
    // ordinary write-off would put the ledger one unit BELOW the shelf.
    const rows = await prisma.stockMovement.findMany({
      where: { organizationId: org.organizationId, productId: breadId, locationId: org.storeId },
    });
    const naive = rows.reduce((sum, m) => sum + stockEffectOf({ type: m.type, quantity: m.quantity.toNumber() }), 0);
    const level = await prisma.stockLevel.findUniqueOrThrow({
      where: { locationId_productId: { locationId: org.storeId, productId: breadId } },
    });
    expect(level.quantity.toNumber() - naive).toBe(1);
  });

  it("reports a hand-edited stock quantity with the exact difference", async () => {
    const where = { locationId_productId: { locationId: org.storeId, productId: flourId } };
    await prisma.stockLevel.update({ where, data: { quantity: { increment: 3 } } });
    try {
      const report = await checkLedgerConsistency(prisma, org.organizationId);
      const drift = report.stock.drifts.find((d) => d.productId === flourId && d.locationId === org.storeId);
      expect(drift?.difference).toBe(3);
      expect(drift?.hasLevelRow).toBe(true);
      expect(report.isConsistent).toBe(false);
    } finally {
      await prisma.stockLevel.update({ where, data: { quantity: { decrement: 3 } } });
    }
  });

  it("reports a hand-edited cash balance with the exact difference", async () => {
    await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { currentBalance: { decrement: 25 } } });
    try {
      const report = await checkLedgerConsistency(prisma, org.organizationId);
      expect(report.cash.drifts).toHaveLength(1);
      expect(report.cash.drifts[0]).toMatchObject({ accountId: org.bankAccountId, difference: -25 });
    } finally {
      await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { currentBalance: { increment: 25 } } });
    }
  });

  it("reports a movement that has no stock level behind it", async () => {
    const movement = await prisma.stockMovement.create({
      data: {
        organizationId: org.organizationId,
        locationId: org.warehouseId,
        productId: flourId,
        type: "RECEIPT",
        quantity: 4,
        createdById: org.user.id,
      },
    });
    try {
      const report = await checkLedgerConsistency(prisma, org.organizationId);
      const drift = report.stock.drifts.find((d) => d.productId === flourId && d.locationId === org.warehouseId);
      expect(drift).toMatchObject({ hasLevelRow: false, cachedQuantity: 0, ledgerQuantity: 4, difference: -4 });
    } finally {
      await prisma.stockMovement.delete({ where: { id: movement.id } });
    }
  });

  it("lists negative balances separately from drift", async () => {
    const where = { locationId_productId: { locationId: org.storeId, productId: flourId } };
    const before = await prisma.stockLevel.findUniqueOrThrow({ where });
    await prisma.stockLevel.update({ where, data: { quantity: -2 } });
    try {
      const report = await checkLedgerConsistency(prisma, org.organizationId);
      expect(report.stock.negativeLevels).toEqual([{ locationName: "Точка А", productName: "Мука", quantity: -2 }]);
    } finally {
      await prisma.stockLevel.update({ where, data: { quantity: before.quantity } });
    }
  });

  it("is read-only: running it changes no balance", async () => {
    const snapshot = async () => ({
      levels: await prisma.stockLevel.findMany({ where: { organizationId: org.organizationId }, orderBy: { id: "asc" } }),
      accounts: await prisma.cashAccount.findMany({ where: { organizationId: org.organizationId }, orderBy: { id: "asc" } }),
      stockRows: await prisma.stockMovement.count({ where: { organizationId: org.organizationId } }),
      cashRows: await prisma.cashMovement.count({ where: { organizationId: org.organizationId } }),
    });
    const before = await snapshot();
    await checkLedgerConsistency(prisma, org.organizationId);
    expect(await snapshot()).toEqual(before);
  });
});
