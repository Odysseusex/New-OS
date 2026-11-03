import { BalanceLine, DebtCounterpartyKind, PaymentMethod, ProductType, SystemAccountKey as K, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { BalanceService } from "./balance/balance.service";
import { FinancialEventProjector } from "./events/projector";
import { checkEventInvariants } from "./events/invariants";
import { checkLedgerConsistency } from "./integrity/ledger-consistency";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { LedgerService } from "../ledger/ledger.service";
import { CustomersService } from "../customers/customers.service";
import { DebtsService } from "../debts/debts.service";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";

// Авансы. A supplier paid ahead of the goods (the receipt then settles against
// it, a short delivery leaves the supplier owing us), and a wholesale customer
// paying more than they owe (the rest is an advance counted toward their next
// sale by itself). Debts, акт сверки, the balance sheet and the general ledger
// agree. Own throwaway organization, ledger ON.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balanceService = new BalanceService(prisma, services.finance);
const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, balanceService, reports, ledger);
const projector = new FinancialEventProjector(prisma);
const customers = new CustomersService(prisma);
const debts = new DebtsService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let supplierId: string;
let customerId: string;
let flourId: string;
let breadId: string;

const order = (quantity: number, unitCost: number) =>
  services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity, unitCost }] } as never);
const pay = (orderId: string, amount: number) =>
  services.procurement.recordPayment(org.user, orderId, { amount, accountId: org.bankAccountId } as never);
const sellOnCredit = (quantity: number) =>
  services.sales.create(org.user, {
    locationId: org.storeId,
    customerId,
    amountPaid: 0,
    paymentMethod: PaymentMethod.TRANSFER,
    items: [{ productId: breadId, quantity, unitPrice: 500 }],
  } as never);

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "advances");
  const id = org.organizationId;
  await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { isDefault: true } });
  supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Мельница" } })).id;
  customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Оптовик" } })).id;
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "AV-1", type: ProductType.RAW_MATERIAL, price: 400, unit: Unit.KG } })).id;
  breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "AV-2", type: ProductType.FINISHED_GOOD, price: 500, unit: Unit.PCS } })).id;
  await startLedger(ledger, org, 2);
  await services.procurement.activateCutover(org.user);
  // Bread on the shelf through an order, so it is in the books too.
  const stock = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: breadId, quantity: 50, unitCost: 200 }] } as never);
  await services.procurement.receive(org.user, stock.id);
  await pay(stock.id, 10_000);
});
afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("an advance to a supplier", () => {
  it("is paid on an order not yet received and settles at the receipt", async () => {
    const po = await order(10, 400); // 4 000
    const paid = await pay(po.id, 3000);
    expect(paid).toMatchObject({ advance: 3000, balanceDue: 0, amountPaid: 3000 });
    await expect(pay(po.id, 2000)).rejects.toThrow(/больше суммы заказа/);
    await expect(services.procurement.cancel(org.user, po.id)).rejects.toThrow(/аванс/);
    expect((await services.finance.getAdvances(org.organizationId)).paid).toBe(3000);
    const owedToUs = await debts.receivables(org.organizationId);
    expect(owedToUs.advances).toEqual([{ kind: DebtCounterpartyKind.SUPPLIER, counterpartyId: supplierId, name: "Мельница", amount: 3000 }]);

    const received = await services.procurement.receive(org.user, po.id);
    expect(received).toMatchObject({ balanceDue: 1000, advance: 0 });
    expect((await services.finance.getAdvances(org.organizationId)).paid).toBe(0);
  });

  it("a short delivery leaves the supplier owing us", async () => {
    const po = await order(5, 400); // 2 000 ordered, all paid ahead
    await pay(po.id, 2000);
    const items = (await services.procurement.findAll(org.user)).find((o) => o.id === po.id)!.items;
    const done = await services.procurement.receive(org.user, po.id, { items: [{ itemId: items[0].id, quantity: 4 }] } as never);
    expect(done).toMatchObject({ receivedTotal: 1600, balanceDue: 0, advance: 400 });
    expect((await services.finance.getAdvances(org.organizationId)).paid).toBe(400);
  });

  it("the supplier's акт сверки shows the advance", async () => {
    const act = await debts.statement(org.organizationId, DebtCounterpartyKind.SUPPLIER, supplierId);
    // Owed: 4 000 − 3 000 = 1 000 on the first order; −400 on the short one.
    expect(act.closing).toBe(-600);
  });
});

describe("an advance from a customer", () => {
  it("pays the open sale first and keeps the rest as an advance", async () => {
    const open = await sellOnCredit(3); // 1 500 owed
    const result = await services.sales.recordCustomerPayment(org.user, { customerId, amount: 4000, accountId: org.bankAccountId });
    expect(result.appliedToSales).toEqual([expect.objectContaining({ saleId: open.id, amount: 1500 })]);
    expect(result).toMatchObject({ advance: 2500, advanceBalance: 2500 });
    expect((await services.sales.findOne(org.user, open.id)).balanceDue).toBe(0);
    expect((await customers.findOne(org.organizationId, customerId)).advanceBalance).toBe(2500);
    const weOwe = await debts.payables(org.organizationId);
    expect(weOwe.advances).toEqual([{ kind: DebtCounterpartyKind.CUSTOMER, counterpartyId: customerId, name: "Оптовик", amount: 2500 }]);
  });

  it("counts toward the next sale by itself, moving no money", async () => {
    const bankBefore = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.bankAccountId } })).currentBalance.toNumber();
    const sale = await sellOnCredit(4); // 2 000
    expect(sale).toMatchObject({ amountPaid: 2000, balanceDue: 0 });
    expect((await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.bankAccountId } })).currentBalance.toNumber()).toBe(bankBefore);
    expect((await customers.findOne(org.organizationId, customerId)).advanceBalance).toBe(500);
    // A bigger one takes what is left and stays owing the rest.
    const next = await sellOnCredit(2); // 1 000: 500 from the advance
    expect(next).toMatchObject({ amountPaid: 500, balanceDue: 500 });
    expect((await customers.findOne(org.organizationId, customerId)).advanceBalance).toBe(0);

    const act = await debts.statement(org.organizationId, DebtCounterpartyKind.CUSTOMER, customerId);
    expect(act.closing).toBe(500);
    // The advance appears once, as the money that came in.
    expect(act.lines.filter((l) => l.document === "Аванс от покупателя").map((l) => l.credit)).toEqual([2500]);
  });
});

describe("the books", () => {
  it("balance sheet, events, diagnostics and the ledger agree", async () => {
    // One more customer advance left standing for the balance sheet.
    await services.sales.recordCustomerPayment(org.user, { customerId, amount: 800, accountId: org.bankAccountId });
    const advances = await services.finance.getAdvances(org.organizationId);
    expect(advances).toEqual({ paid: 400, received: 300 });

    const sheet = await balanceService.getBalanceSheet(org.organizationId);
    expect(sheet.assets.lines.find((l) => l.line === BalanceLine.ADVANCES_PAID)?.amount).toBe(400);
    expect(sheet.liabilities.lines.find((l) => l.line === BalanceLine.ADVANCES_RECEIVED)?.amount).toBe(300);
    expect(sheet.control.lines.filter((c) => /задолженность/.test(c.label))).toEqual([]);

    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    const diag = await diagnostics.run(org.organizationId);
    expect(diag.checks.filter((c) => c.status !== "PASS")).toEqual([]);
    expect((await checkLedgerConsistency(prisma, org.organizationId)).cash.drifts).toEqual([]);
    expect(await glBalance(ledger, org, K.RECEIVABLES)).toBe(-300);
    expect(await glBalance(ledger, org, K.SUPPLIER_PAYABLES)).toBe(600);

    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.customerPayments.filter((a) => !logged.has(a))).toEqual([]);
  });
});
