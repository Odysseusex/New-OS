import { SystemAccountKey as K } from "@bakery-os/shared";
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
import { StockTurnoverService } from "../finance/cost-correction/stock-turnover.service";
import { DebtsService } from "../debts/debts.service";

// «Возврат поставщику» with the general ledger ON: goods leave at the price they
// came in at, the moving average gives that price back, the supplier debt
// shrinks, money handed back is its own cash entry, and every subledger agrees
// with the books. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balanceService = new BalanceService(prisma, services.finance);
const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, balanceService, reports, ledger);
const projector = new FinancialEventProjector(prisma);
const turnover = new StockTurnoverService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let flourId: string;
let supplierId: string;
let start: Date;

const flour = () => prisma.product.findUniqueOrThrow({ where: { id: flourId } });
const stock = async () =>
  (await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: flourId } } })).quantity.toNumber();
const buy = async (quantity: number, unitCost: number) => {
  const po = await services.procurement.create(org.user, {
    supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity, unitCost }],
  } as never);
  return services.procurement.receive(org.user, po.id);
};

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "supplier-return");
  flourId = (
    await prisma.product.create({
      data: { organizationId: org.organizationId, name: "Мука", sku: "SR-1", unit: "KG", type: "RAW_MATERIAL", price: 100 },
    })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Мельница" } })).id;
  await startLedger(ledger, org);
  await services.procurement.activateCutover(org.user);
  start = new Date(Date.now() - 1000);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

describe("returning goods to the supplier with the ledger on", () => {
  let orderA: string;
  let itemA: string;

  it("an unpaid order: stock, average, inventory and the debt all go down by the received price", async () => {
    const a = await buy(10, 500); // 5 000
    await buy(10, 300); // 3 000 → average 400
    orderA = a.id;
    itemA = a.items[0].id;
    expect((await flour()).averageUnitCost?.toNumber()).toBe(400);

    const dto = await services.procurement.returnToSupplier(org.user, orderA, { items: [{ itemId: itemA, quantity: 4 }], reason: "Порванные мешки" });
    expect(dto).toMatchObject({ returnedTotal: 2000, balanceDue: 3000 });
    expect(await stock()).toBe(16);
    // (20 × 400 − 4 × 500) / 16 = 375: the book value of what is left.
    expect((await flour()).averageUnitCost?.toNumber()).toBe(375);
    expect(await glBalance(ledger, org, K.INVENTORY)).toBe(6000);
    expect(await glBalance(ledger, org, K.SUPPLIER_PAYABLES)).toBe(6000);
  });

  it("a paid order: the money the supplier hands back lands on the account and in the books", async () => {
    await services.procurement.recordPayment(org.user, orderA, { accountId: org.bankAccountId, amount: 3000 });
    const cash = await glBalance(ledger, org, K.BANK);
    const dto = await services.procurement.returnToSupplier(org.user, orderA, {
      items: [{ itemId: itemA, quantity: 2 }],
      reason: "Ещё два мешка сырые",
      refundAccountId: org.bankAccountId,
    });
    expect(dto).toMatchObject({ returnedTotal: 3000, refundedTotal: 1000, balanceDue: 0 });
    expect(await glBalance(ledger, org, K.BANK)).toBe(cash + 1000);
    expect(await glBalance(ledger, org, K.INVENTORY)).toBe(5000);
    expect(await glBalance(ledger, org, K.SUPPLIER_PAYABLES)).toBe(3000);
  });

  it("refuses goods that are no longer on the shelf", async () => {
    await services.inventory.writeOff(org.user, { locationId: org.storeId, productId: flourId, quantity: 13, writeOffReason: "DAMAGED" as never });
    await expect(
      services.procurement.returnToSupplier(org.user, orderA, { items: [{ itemId: itemA, quantity: 2 }], reason: "Остаток партии", refundAccountId: org.bankAccountId }),
    ).rejects.toThrow(/на складе нет/);
    expect(await stock()).toBe(1);
  });

  it("the books, the events, the debts, the turnover statement and the ledgers all agree", async () => {
    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    expect(events.filter((e) => e.type === "SUPPLIER_RETURN")).toHaveLength(2);
    const report = await diagnostics.run(org.organizationId);
    expect(report.checks.filter((c) => c.status !== "PASS")).toEqual([]);
    const consistency = await checkLedgerConsistency(prisma, org.organizationId);
    expect(consistency.stock.drifts).toEqual([]);
    expect(consistency.cash.drifts).toEqual([]);

    const t = await turnover.turnover(org.organizationId, start, new Date(), null);
    const line = t.lines.find((l) => l.productId === flourId)!;
    // In: 20 bought; out: 6 back to the supplier + 13 written off.
    expect(line).toMatchObject({ inQuantity: 20, inValue: 8000, outQuantity: 19, closingQuantity: 1 });
    expect(line.closingValue).toBeCloseTo((await flour()).averageUnitCost!.toNumber(), 2);

    const debts = new DebtsService(prisma);
    const payables = await debts.payables(org.organizationId);
    expect(payables.total).toBeCloseTo(3000, 2);
    const statement = await debts.statement(org.organizationId, "SUPPLIER" as never, supplierId);
    expect(statement.lines.map((l) => l.kind)).toEqual(expect.arrayContaining(["SUPPLIER_RETURN", "SUPPLIER_REFUND"]));
    expect(statement.closing).toBeCloseTo(-3000, 2);
  });

  it("the history lists the returns, and a return cannot be rewritten", async () => {
    const history = await services.procurement.history(org.user, orderA);
    expect(history.map((h) => h.kind)).toEqual(["CREATED", "RECEIVED", "SUPPLIER_RETURN", "PAID", "SUPPLIER_RETURN"]);
    expect(history[4]).toMatchObject({ amountAfter: -1000, amount: 1000, reason: "Ещё два мешка сырые" });
    const doc = await prisma.supplierReturn.findFirstOrThrow({ where: { purchaseOrderId: orderA } });
    await expect(prisma.$executeRaw`UPDATE "supplier_returns" SET "reason" = 'подмена' WHERE "id" = ${doc.id}`).rejects.toThrow(/append-only/);
  });
});
