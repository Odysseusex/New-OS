import { addDaysToKey, buildStatementLines, debtDateKey, DebtCounterpartyKind, PaymentMethod, ProductType, statementConclusion, StatementLineKind, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { DebtsService } from "./debts.service";

// Debts by document on any day: due dates from the deferral, age, overdue,
// the counterparty card's running balance — and today's totals equal what
// Финансы already shows for receivables and payables.

const prisma = new PrismaService();
const services = buildServices(prisma);
const debts = new DebtsService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
const DAY = 86_400_000;

let org: IsolatedOrg;
let customerId: string;
let supplierId: string;
let breadId: string;
let flourId: string;
let cheeseId: string;
const today = debtDateKey(new Date());

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "debts");
  const id = org.organizationId;
  customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Мерей", bin: "123456789012", paymentTermDays: 3 } })).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Мельница", paymentTermDays: 2 } })).id;
  breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "DB-1", type: ProductType.FINISHED_GOOD, price: 500, unit: Unit.PCS } })).id;
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "DB-2", type: ProductType.RAW_MATERIAL, price: 300, unit: Unit.KG } })).id;
  cheeseId = (
    await prisma.product.create({
      data: { organizationId: id, name: "Сыр", sku: "DB-3", type: ProductType.FINISHED_GOOD, price: 500, unit: Unit.PCS, consignmentSupplierId: supplierId },
    })
  ).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 50 });
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: cheeseId, quantity: 10 });
  await services.procurement.activateCutover(org.user);
  await prisma.organization.update({ where: { id }, data: { purchaseCutoverAt: new Date(Date.now() - 30 * DAY) } });
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const sell = (quantity: number, extra: Record<string, unknown> = {}) =>
  services.sales.create(org.user, {
    locationId: org.storeId,
    customerId,
    paymentMethod: PaymentMethod.CASH,
    items: [{ productId: breadId, quantity, unitPrice: 500 }],
    ...extra,
  } as never);

describe("receivables", () => {
  let oldSaleId: string;

  it("stamps the due date from the customer's deferral, or as stated", async () => {
    const sale = await sell(2, { amountPaid: 0 });
    expect(sale.paymentDueDate).toBe(addDaysToKey(today, 3));
    oldSaleId = sale.id;
    // Ten days old, with no stated due date: it follows the customer's terms.
    await prisma.sale.update({ where: { id: sale.id }, data: { soldAt: new Date(Date.now() - 10 * DAY), paymentDueAt: null } });

    const stated = await sell(1, { amountPaid: 200, paymentDueDate: addDaysToKey(today, 5) });
    expect(stated.paymentDueDate).toBe(addDaysToKey(today, 5));
    await expect(sell(1, { amountPaid: 0, paymentDueDate: addDaysToKey(today, -1) })).rejects.toThrow("раньше даты продажи");
  });

  it("lists what is open by age and overdue, today and on a past day", async () => {
    await services.sales.recordPayment(org.user, oldSaleId, { amount: 100 } as never);
    const now = await debts.receivables(org.organizationId);
    const row = now.counterparties.find((c) => c.counterpartyId === customerId)!;
    expect(row.bin).toBe("123456789012");
    expect(row.outstanding).toBe(1200); // 1 000 − 100 + 500 − 200
    expect(row.overdue).toBe(900);
    expect(row.maxOverdueDays).toBe(7); // due 3 days after a sale 10 days old
    expect(row.byAge).toEqual({ D0_1: 300, D2_7: 0, D8_30: 900, D31_PLUS: 0 });
    expect(now.total).toBe(await services.finance.getAccountsReceivable(org.organizationId));

    // Yesterday: today's payment and today's sale did not exist yet.
    const before = await debts.receivables(org.organizationId, addDaysToKey(today, -1));
    expect(before.counterparties.find((c) => c.counterpartyId === customerId)?.outstanding).toBe(1000);
  });

  it("keeps a running balance on the card, opening from before the period", async () => {
    const card = await debts.statement(org.organizationId, DebtCounterpartyKind.CUSTOMER, customerId, addDaysToKey(today, -30), today);
    expect(card.counterparty.bin).toBe("123456789012");
    expect(card.opening).toBe(0);
    expect(card.closing).toBe(1200);
    expect(card.lines.at(-1)?.balance).toBe(1200);
    expect(card.turnoverDebit).toBe(1500);
    expect(card.turnoverCredit).toBe(300);

    const lastDays = await debts.statement(org.organizationId, DebtCounterpartyKind.CUSTOMER, customerId, today, today);
    expect(lastDays.opening).toBe(1000);
    expect(lastDays.closing).toBe(1200);
    expect(statementConclusion(card.closing, "ИП Ар-Амир", "Мерей")).toMatch(/^Задолженность в пользу ИП Ар-Амир составляет 1\s200,00 ₸\.$/);
  });
});

describe("payables", () => {
  it("covers deliveries, goods sold «под реализацию» and accrued expenses, and agrees with Финансы", async () => {
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost: 300 }] } as never);
    await services.procurement.receive(org.user, po.id);
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { receivedAt: new Date(Date.now() - 5 * DAY) } });
    await services.procurement.recordPayment(org.user, po.id, { amount: 1000, accountId: org.cashAccountId } as never);

    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: cheeseId, quantity: 2, unitPrice: 500 }] } as never);
    await prisma.consignmentPayment.create({ data: { organizationId: org.organizationId, supplierId, amount: 400, paidAt: new Date(), createdById: org.user.id } });
    await prisma.expense.create({
      data: { organizationId: org.organizationId, status: "CONFIRMED", amount: 700, amountPaid: 0, incurredOn: new Date(), description: "Аренда", createdById: org.user.id },
    });

    const report = await debts.payables(org.organizationId);
    const supplier = report.counterparties.find((c) => c.counterpartyId === supplierId)!;
    expect(supplier.outstanding).toBe(2600); // 3 000 − 1 000 + 1 000 − 400
    expect(supplier.overdue).toBe(2000); // the delivery was due 3 days ago
    expect(supplier.maxOverdueDays).toBe(3);
    expect(supplier.items.map((i) => i.outstanding).sort()).toEqual([2000, 600]);
    const none = report.counterparties.find((c) => c.kind === DebtCounterpartyKind.NONE)!;
    expect(none.outstanding).toBe(700);
    expect(report.total).toBe(await services.finance.getAccountsPayable(org.organizationId));

    // Four days ago the delivery was in and nothing was paid or sold yet.
    const earlier = await debts.payables(org.organizationId, addDaysToKey(today, -4));
    expect(earlier.counterparties.find((c) => c.counterpartyId === supplierId)?.outstanding).toBe(3000);

    const card = await debts.statement(org.organizationId, DebtCounterpartyKind.SUPPLIER, supplierId, addDaysToKey(today, -30), today);
    expect(card.closing).toBe(-2600); // we owe them
    expect(card.lines.map((l) => l.kind)).toEqual(
      expect.arrayContaining([StatementLineKind.DELIVERY, StatementLineKind.PAYMENT_MADE, StatementLineKind.CONSIGNMENT_SOLD]),
    );
    expect(statementConclusion(card.closing, "ИП Ар-Амир", "Мельница")).toContain("в пользу Мельница");
  });

  it("puts a reversed payment back", async () => {
    const order = await prisma.purchaseOrder.findFirstOrThrow({ where: { organizationId: org.organizationId, supplierId }, include: { payments: true } });
    await services.procurement.reversePayment(org.user, order.id, order.payments[0].id, "Ошибочная оплата");
    const report = await debts.payables(org.organizationId);
    expect(report.counterparties.find((c) => c.counterpartyId === supplierId)?.outstanding).toBe(3600);
    const card = await debts.statement(org.organizationId, DebtCounterpartyKind.SUPPLIER, supplierId, addDaysToKey(today, -30), today);
    expect(card.closing).toBe(-3600);
  });
});

describe("statement maths", () => {
  it("folds what came before the period into the opening balance", () => {
    const at = (key: string) => `${key}T06:00:00.000Z`;
    const result = buildStatementLines(
      [
        { at: at("2026-10-01"), kind: StatementLineKind.SALE, document: "1", debit: 1000, credit: 0 },
        { at: at("2026-10-05"), kind: StatementLineKind.PAYMENT_RECEIVED, document: "2", debit: 0, credit: 400 },
        { at: at("2026-10-12"), kind: StatementLineKind.SALE, document: "3", debit: 250, credit: 0 },
        { at: at("2026-11-01"), kind: StatementLineKind.SALE, document: "4", debit: 99, credit: 0 },
      ],
      "2026-10-05",
      "2026-10-31",
    );
    expect(result.opening).toBe(1000);
    expect(result.lines.map((l) => l.balance)).toEqual([600, 850]);
    expect([result.turnoverDebit, result.turnoverCredit, result.closing]).toEqual([250, 400, 850]);
  });
});
