import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { FinancialEventProjector } from "../finance/events/projector";
import { checkEventInvariants } from "../finance/events/invariants";
import { supplierReturnEvent } from "../finance/events/purchase-events";
import { checkLedgerConsistency } from "../finance/integrity/ledger-consistency";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";

// Purchasing: Order → Receive → Inventory → Pay supplier. Placing an order owes
// nothing; receiving recognises the payable; paying reduces it; a payment is
// undone by a reversal, never by an edit. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const projector = new FinancialEventProjector(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let flourId: string;
let sugarId: string;
let supplierId: string;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "purchasing");
  const mk = (name: string, sku: string) =>
    prisma.product.create({ data: { organizationId: org.organizationId, name, sku, unit: "KG", type: "RAW_MATERIAL", price: 100 } });
  flourId = (await mk("Мука", "P-1")).id;
  sugarId = (await mk("Сахар", "P-2")).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Мельница" } })).id;
  const opening = await services.cash.recordMovement(prisma, {
    organizationId: org.organizationId, accountId: org.bankAccountId, type: "OPENING_BALANCE" as never, amount: 1_000_000, createdById: org.user.id,
  });
  await prisma.cashMovement.update({ where: { id: opening.id }, data: { occurredAt: new Date(Date.now() - 30 * 86400_000) } });
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

const order = (items: { productId: string; quantity: number; unitCost: number }[]) =>
  services.procurement.create(org.user, { supplierId, locationId: org.storeId, items } as never);
const ap = () => services.finance.getAccountsPayable(org.organizationId);
const balance = async () => (await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.bankAccountId } })).currentBalance.toNumber();
const supplierPayablesFromEvents = async () =>
  (await projector.project(org.organizationId))
    .flatMap((e) => e.balance)
    .filter((b) => b.line === "SUPPLIER_PAYABLES")
    .reduce((s, b) => s + b.delta, 0);

describe("before the cutover: the old behaviour is untouched", () => {
  it("placing an order creates no payable, and neither does receiving it", async () => {
    const before = await ap();
    const po = await order([{ productId: flourId, quantity: 10, unitCost: 100 }]);
    expect(await ap()).toBe(before);
    const received = await services.procurement.receive(org.user, po.id);
    expect(received.payableRecognized).toBe(false);
    expect(received.paymentStatus).toBeNull();
    expect(await ap()).toBe(before);
    await expect(
      services.procurement.recordPayment(org.user, po.id, { accountId: org.bankAccountId, amount: 100 }),
    ).rejects.toThrow(/нет задолженности/);
    // New invoices may still be created (not deprecated yet).
    const invoice = await services.invoices.create(org.user, {
      supplierId, locationId: org.storeId, number: "OLD-1", items: [{ productId: sugarId, quantity: 5, unitCost: 200 }],
    } as never);
    expect(invoice.status).toBe("DRAFT");
  });
});

describe("the cutover", () => {
  it("is a one-way, idempotent switch and is audited once", async () => {
    expect((await services.procurement.getWorkflow(org.organizationId)).activated).toBe(false);
    const first = await services.procurement.activateCutover(org.user);
    const second = await services.procurement.activateCutover(org.user);
    expect(first.activated).toBe(true);
    expect(second.cutoverAt).toBe(first.cutoverAt);
    const logs = await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "procurement.cutover" } });
    expect(logs).toBe(1);
  });

  it("refuses NEW supplier invoices, while an existing one stays confirmable and payable", async () => {
    await expect(
      services.invoices.create(org.user, { supplierId, locationId: org.storeId, number: "NEW-1", items: [{ productId: sugarId, quantity: 1, unitCost: 1 }] } as never),
    ).rejects.toThrow(/через заказ/);
    const legacy = await prisma.invoice.findFirstOrThrow({ where: { organizationId: org.organizationId, number: "OLD-1" } });
    const before = await ap();
    await services.invoices.confirm(org.user, legacy.id);
    expect(await ap()).toBe(before + 1000);
    await services.invoices.recordPayment(org.user, legacy.id, { accountId: org.bankAccountId, amount: 400 });
    expect(await ap()).toBe(before + 600);
  });
});

describe("Order → Receive → Inventory → Pay", () => {
  let poId: string;

  it("a placed order still owes nothing; receipt recognises the payable at the DELIVERED amount", async () => {
    const before = await ap();
    const po = await order([
      { productId: flourId, quantity: 100, unitCost: 100 },
      { productId: sugarId, quantity: 50, unitCost: 200 },
    ]);
    poId = po.id;
    expect(po.totalCost).toBe(20000);
    expect(await ap()).toBe(before);

    const itemFlour = po.items.find((i) => i.productId === flourId)!;
    const received = await services.procurement.receive(org.user, poId, { items: [{ itemId: itemFlour.id, quantity: 90, unitCost: 110 }] });
    // 90 × 110 + 50 × 200 = 9 900 + 10 000
    expect(received.receivedTotal).toBe(19900);
    expect(received.payableRecognized).toBe(true);
    expect(received.balanceDue).toBe(19900);
    expect(await ap()).toBe(before + 19900);

    // Stock and the movement cost follow the delivery, not the order.
    const level = await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: flourId } } });
    expect(level.quantity.toNumber()).toBeGreaterThanOrEqual(90);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { purchaseOrderId: poId, productId: flourId } });
    expect(movement.quantity.toNumber()).toBe(90);
    expect(movement.unitCost?.toNumber()).toBe(110);
  });

  it("pays in parts, refuses an overpayment, and derives what is still owed", async () => {
    const cashBefore = await balance();
    let dto = await services.procurement.recordPayment(org.user, poId, { accountId: org.bankAccountId, amount: 5000 });
    expect(dto).toMatchObject({ amountPaid: 5000, balanceDue: 14900, paymentStatus: "PARTIALLY_PAID" });
    await expect(
      services.procurement.recordPayment(org.user, poId, { accountId: org.bankAccountId, amount: 15000 }),
    ).rejects.toThrow(/превышает/);
    expect(await balance()).toBe(cashBefore - 5000);
    dto = await services.procurement.recordPayment(org.user, poId, { accountId: org.bankAccountId, amount: 14900 });
    expect(dto).toMatchObject({ balanceDue: 0, paymentStatus: "PAID" });
    expect(await balance()).toBe(cashBefore - 19900);
  });

  it("reversing a payment keeps the row, adds a correcting movement, and the order owes the amount again", async () => {
    const before = await services.procurement.findAll(org.user);
    const po = before.find((o) => o.id === poId)!;
    const first = po.payments[0];
    const cashBefore = await balance();
    const apBefore = await ap();
    const after = await services.procurement.reversePayment(org.user, poId, first.id, "Ошибочный платёж");
    const reversed = after.payments.find((p) => p.id === first.id)!;
    expect(reversed.amount).toBe(first.amount); // history is not edited
    expect(reversed.reversedAt).not.toBeNull();
    expect(after.balanceDue).toBe(5000);
    expect(after.paymentStatus).toBe("PARTIALLY_PAID");
    expect(await ap()).toBe(apBefore + 5000);
    expect(await balance()).toBe(cashBefore + 5000);
    const correction = await prisma.cashMovement.findFirstOrThrow({ where: { purchaseOrderPaymentId: first.id, type: "ADJUSTMENT" } });
    expect(correction.correctsMovementId).not.toBeNull();
    await expect(services.procurement.reversePayment(org.user, poId, first.id, "Ещё раз")).rejects.toThrow(/уже отменён/);
  });

  it("two simultaneous reversals of the same payment reverse it once", async () => {
    const po = (await services.procurement.findAll(org.user)).find((o) => o.id === poId)!;
    const target = po.payments.find((p) => !p.reversedAt)!;
    const cashBefore = await balance();
    const results = await Promise.allSettled([
      services.procurement.reversePayment(org.user, poId, target.id, "Гонка А"),
      services.procurement.reversePayment(org.user, poId, target.id, "Гонка Б"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance()).toBe(cashBefore + target.amount);
  });

  it("two simultaneous payments cannot together overpay", async () => {
    const po = await order([{ productId: flourId, quantity: 10, unitCost: 1000 }]);
    await services.procurement.receive(org.user, po.id);
    const cashBefore = await balance();
    const results = await Promise.allSettled([
      services.procurement.recordPayment(org.user, po.id, { accountId: org.bankAccountId, amount: 6000 }),
      services.procurement.recordPayment(org.user, po.id, { accountId: org.bankAccountId, amount: 6000 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance()).toBe(cashBefore - 6000);
    const fresh = (await services.procurement.findAll(org.user)).find((o) => o.id === po.id)!;
    expect(fresh.amountPaid).toBe(6000);
    expect(fresh.balanceDue).toBe(4000);
  });

  it("two simultaneous receipts put the goods on the shelf once", async () => {
    const po = await order([{ productId: sugarId, quantity: 7, unitCost: 10 }]);
    const levelBefore = (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: org.storeId, productId: sugarId } } }))?.quantity.toNumber() ?? 0;
    const results = await Promise.allSettled([
      services.procurement.receive(org.user, po.id),
      services.procurement.receive(org.user, po.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const levelAfter = (await prisma.stockLevel.findUniqueOrThrow({ where: { locationId_productId: { locationId: org.storeId, productId: sugarId } } })).quantity.toNumber();
    expect(levelAfter).toBe(levelBefore + 7);
  });

  it("two simultaneous payments of a legacy invoice cannot overpay either", async () => {
    // A DRAFT invoice that pre-dates the cutover can still be confirmed and paid.
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: org.organizationId, locationId: org.storeId, supplierId, number: "OLD-2", totalCost: 1000, createdById: org.user.id,
        items: { create: [{ productId: sugarId, quantity: 10, unitCost: 100, subtotal: 1000 }] },
      },
    });
    await services.invoices.confirm(org.user, invoice.id);
    const results = await Promise.allSettled([
      services.invoices.recordPayment(org.user, invoice.id, { accountId: org.bankAccountId, amount: 700 }),
      services.invoices.recordPayment(org.user, invoice.id, { accountId: org.bankAccountId, amount: 700 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(fresh.amountPaid.toNumber()).toBe(700);
  });

  it("two simultaneous confirmations of a legacy invoice receive it once", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: org.organizationId, locationId: org.storeId, supplierId, number: "OLD-3", totalCost: 300, createdById: org.user.id,
        items: { create: [{ productId: flourId, quantity: 3, unitCost: 100, subtotal: 300 }] },
      },
    });
    const results = await Promise.allSettled([
      services.invoices.confirm(org.user, invoice.id),
      services.invoices.confirm(org.user, invoice.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.stockMovement.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });
});

describe("accounts payable and events agree", () => {
  it("legacy invoices and received orders are each counted once, and the event-derived payable equals the reported one", async () => {
    // Supplier payable = confirmed invoices (unpaid part) + received-after-cutover orders (unpaid part).
    const invoices = await prisma.invoice.findMany({ where: { organizationId: org.organizationId, status: "CONFIRMED" } });
    const invoiceOpen = invoices.reduce((s, i) => s + i.totalCost.toNumber() - i.amountPaid.toNumber(), 0);
    const orderOpen = await services.finance.getPurchaseOrderPayables(org.organizationId);
    expect(await ap()).toBeCloseTo(invoiceOpen + orderOpen, 2);
    // Expenses/consignment are absent in this fixture, so the events' supplier payable is the whole figure.
    expect(await supplierPayablesFromEvents()).toBeCloseTo(await ap(), 2);
  });

  it("every classified purchasing event balances, keys are unique, and replay is identical", async () => {
    const events = await projector.project(org.organizationId);
    const report = checkEventInvariants(events);
    expect(report.violations).toEqual([]);
    expect(JSON.stringify(events)).toBe(JSON.stringify(await projector.project(org.organizationId)));
    // The order received BEFORE the cutover is reported as incomplete, not given a counter-side.
    const legacy = events.filter((e) => e.type === "PURCHASE_RECEIPT" && e.unclassified);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].balance.map((b) => b.line)).toEqual(["INVENTORY"]);
  });

  it("supplier returns have reserved semantics (inventory ↓, payable ↓, cash ↑ if paid) but no workflow", async () => {
    const event = supplierReturnEvent({ returnId: "r1", occurredAt: new Date(), creditedAmount: 1000, refundedCash: 400, cashAccountId: org.bankAccountId });
    expect(event.balance).toEqual([
      { line: "INVENTORY", delta: -1000 },
      { line: "SUPPLIER_PAYABLES", delta: -600 },
      { line: "CASH_AND_BANK", delta: 400 },
    ]);
    expect(checkEventInvariants([event]).violations).toEqual([]);
    // The projector never invents one: nothing in the ledgers is a supplier return.
    const events = await projector.project(org.organizationId);
    expect(events.some((e) => e.type === "SUPPLIER_RETURN")).toBe(false);
  });

  it("the ledgers and caches still agree after all of it", async () => {
    const report = await checkLedgerConsistency(prisma, org.organizationId);
    expect(report.stock.drifts).toEqual([]);
    expect(report.cash.drifts).toEqual([]);
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.procurement.filter((a) => !logged.has(a))).toEqual([]);
  });
});
