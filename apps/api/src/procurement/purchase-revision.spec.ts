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
import { monthOf } from "../common/reporting-period";

// Correcting a received purchase order inside the document, with the general
// ledger ON: the posted receipt entry is never rewritten, the difference posts
// beside it, the moving average and the supplier debt follow, and the history
// says who changed what. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balanceService = new BalanceService(prisma, services.finance);
const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, balanceService, reports, ledger);
const projector = new FinancialEventProjector(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let flourId: string;
let supplierId: string;
let orderId: string;
let itemId: string;

const flour = () => prisma.product.findUniqueOrThrow({ where: { id: flourId } });
const stock = async () =>
  (await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: flourId } } })).quantity.toNumber();
const revise = (quantity: number, unitCost: number, reason = "Ошибка в накладной") =>
  services.procurement.revise(org.user, orderId, { items: [{ itemId, quantity, unitCost }], reason });

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "po-revision");
  flourId = (
    await prisma.product.create({
      data: { organizationId: org.organizationId, name: "Мука", sku: "R-1", unit: "KG", type: "RAW_MATERIAL", price: 100 },
    })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Мельница" } })).id;
  await startLedger(ledger, org);
  await services.procurement.activateCutover(org.user);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

describe("correcting a received order", () => {
  it("only a received order can be corrected, and only with a reason", async () => {
    const po = await services.procurement.create(org.user, {
      supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost: 500 }],
    } as never);
    orderId = po.id;
    itemId = po.items[0].id;
    await expect(revise(10, 400)).rejects.toThrow(/только принятый/);
    await services.procurement.receive(org.user, orderId);
    await expect(revise(10, 400, "ой")).rejects.toThrow(/причину/);
    await expect(revise(10, 500)).rejects.toThrow(/Ничего не изменилось/);
    expect(await stock()).toBe(10);
    expect((await flour()).averageUnitCost?.toNumber()).toBe(500);
    expect(await glBalance(ledger, org, K.INVENTORY)).toBe(5000);
    expect(await glBalance(ledger, org, K.SUPPLIER_PAYABLES)).toBe(5000);
  });

  it("a wrong price: the debt, the book and the average follow; the receipt entry is untouched", async () => {
    // 4 kg already used at the booked 500.
    await services.inventory.writeOff(org.user, { locationId: org.storeId, productId: flourId, quantity: 4, writeOffReason: "DAMAGED" as never });
    expect(await glBalance(ledger, org, K.INVENTORY)).toBe(3000);
    const receiptEntry = await prisma.accountingEvent.findFirstOrThrow({
      where: { organizationId: org.organizationId, eventKey: `purchaseOrder:${orderId}:receipt` },
      include: { journalEntry: { include: { lines: true } } },
    });

    const dto = await revise(10, 400);
    expect(dto.receivedTotal).toBe(4000);
    expect(dto.balanceDue).toBe(4000);
    expect(dto.revisionCount).toBe(1);
    expect(await stock()).toBe(6); // a price correction moves no goods
    // 6 kg on hand: 3000 of book value − 5000 booked + 4000 corrected = 2000 → 333.3333 a kg.
    expect((await flour()).averageUnitCost?.toNumber()).toBeCloseTo(333.3333, 4);
    expect((await flour()).price.toNumber()).toBe(400);
    expect(await glBalance(ledger, org, K.INVENTORY)).toBe(2000);
    expect(await glBalance(ledger, org, K.SUPPLIER_PAYABLES)).toBe(4000);

    const again = await prisma.accountingEvent.findFirstOrThrow({
      where: { id: receiptEntry.id },
      include: { journalEntry: { include: { lines: true } } },
    });
    expect(again.status).toBe("POSTED");
    expect(again.journalEntry!.id).toBe(receiptEntry.journalEntry!.id);
    const correction = await prisma.accountingEvent.findFirstOrThrow({
      where: { organizationId: org.organizationId, eventKey: `purchaseOrder:${orderId}:revision:1` },
    });
    expect(correction.status).toBe("POSTED");
  });

  it("refuses to cut the total below what is paid, and to take off goods that are gone", async () => {
    await services.procurement.recordPayment(org.user, orderId, { accountId: org.bankAccountId, amount: 3000 });
    await expect(revise(5, 400)).rejects.toThrow(/меньше уже оплаченной/);
    // 10 → 3 would take 7 kg off a shelf holding 6.
    await expect(revise(3, 1000)).rejects.toThrow(/часть уже израсходована/);
    expect(await stock()).toBe(6);
    expect((await prisma.purchaseOrderRevision.count({ where: { purchaseOrderId: orderId } }))).toBe(1);
  });

  it("a wrong quantity: the difference is its own movement on the order", async () => {
    const dto = await revise(12, 400, "Довезли 2 кг, не внесли");
    expect(dto.receivedTotal).toBe(4800);
    expect(dto.balanceDue).toBe(1800);
    expect(await stock()).toBe(8);
    const movements = await prisma.stockMovement.findMany({ where: { purchaseOrderId: orderId }, orderBy: { createdAt: "asc" } });
    expect(movements.map((m) => m.quantity.toNumber())).toEqual([10, 2]);
    // 2000 + (4800 − 4000) over 8 kg.
    expect((await flour()).averageUnitCost?.toNumber()).toBe(350);
    expect(await glBalance(ledger, org, K.INVENTORY)).toBe(2800);
    expect(await glBalance(ledger, org, K.SUPPLIER_PAYABLES)).toBe(1800);
  });

  it("the books, the events and the ledgers all agree afterwards", async () => {
    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    const purchase = events.filter((e) => e.sourceId === orderId && e.type === "PURCHASE_RECEIPT");
    expect(purchase.map((e) => e.balance.find((b) => b.line === "INVENTORY")!.delta).sort((a, b) => a - b)).toEqual([-1000, 800, 5000]);
    const report = await diagnostics.run(org.organizationId);
    expect(report.checks.filter((c) => c.status !== "PASS")).toEqual([]);
    const consistency = await checkLedgerConsistency(prisma, org.organizationId);
    expect(consistency.stock.drifts).toEqual([]);
  });

  it("the history says who changed what, and a correction row cannot be rewritten", async () => {
    const history = await services.procurement.history(org.user, orderId);
    expect(history.map((h) => h.kind)).toEqual(["CREATED", "RECEIVED", "REVISED", "PAID", "REVISED"]);
    const received = history[1];
    expect(received.amountAfter).toBe(5000);
    expect(received.actorName).toBe(org.user.fullName);
    const [first, second] = history.filter((h) => h.kind === "REVISED");
    expect(first).toMatchObject({ amountBefore: 5000, amountAfter: 4000, reason: "Ошибка в накладной" });
    expect(first.lines).toEqual([
      { productName: "Мука", unit: "KG", quantityBefore: 10, quantityAfter: 10, unitCostBefore: 500, unitCostAfter: 400 },
    ]);
    expect(second.lines[0]).toMatchObject({ quantityBefore: 10, quantityAfter: 12 });
    const revision = await prisma.purchaseOrderRevision.findFirstOrThrow({ where: { purchaseOrderId: orderId } });
    await expect(
      prisma.$executeRaw`UPDATE "purchase_order_revisions" SET "reason" = 'подмена' WHERE "id" = ${revision.id}`,
    ).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "purchaseOrder.revise" } })).toBe(2);
  });

  it("a receipt in a closed month cannot be corrected", async () => {
    const { year, month } = monthOf(new Date());
    const before = await prisma.financialPeriod.findUnique({
      where: { organizationId_year_month: { organizationId: org.organizationId, year, month } },
    });
    await prisma.financialPeriod.upsert({
      where: { organizationId_year_month: { organizationId: org.organizationId, year, month } },
      update: { status: "CLOSED" },
      create: { organizationId: org.organizationId, year, month, status: "CLOSED", periodStart: new Date(0), periodEnd: new Date(0) },
    });
    try {
      await expect(revise(12, 300)).rejects.toThrow(/закрыт/);
    } finally {
      await prisma.financialPeriod.update({
        where: { organizationId_year_month: { organizationId: org.organizationId, year, month } },
        data: { status: before?.status ?? "OPEN" },
      });
      if (!before) {
        await prisma.financialPeriod.delete({ where: { organizationId_year_month: { organizationId: org.organizationId, year, month } } });
      }
    }
  });
});
