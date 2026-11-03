import { DebtCounterpartyKind, PaymentMethod, ProductType, splitSaleReturn, SystemAccountKey as K, Unit } from "@bakery-os/shared";
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
import { CustomersService } from "../customers/customers.service";
import { DebtsService } from "../debts/debts.service";

// A wholesale buyer brings back goods from a sale on credit: what they still
// owe on the sale is cancelled first and no money moves for it; money goes back
// only for the rest. Every figure of the debt (sale, customer card, debts
// report, акт сверки, receivables, the general ledger) agrees. Own throwaway
// organization, ledger ON.

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
let customerId: string;
let breadId: string;

const till = async () => (await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.cashAccountId } })).currentBalance.toNumber();
const sell = (quantity: number, amountPaid: number, customer = true) =>
  services.sales.create(org.user, {
    locationId: org.storeId,
    ...(customer ? { customerId, amountPaid } : {}),
    paymentMethod: PaymentMethod.CASH,
    items: [{ productId: breadId, quantity, unitPrice: 500 }],
  } as never);
const giveBack = (saleId: string, quantity: number) =>
  services.returns.create(org.user, saleId, { items: [{ productId: breadId, quantity }], reason: "Не продали" });

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "return-credit");
  const id = org.organizationId;
  customerId = (await prisma.customer.create({ data: { organizationId: id, name: "Оптовик", paymentTermDays: 3 } })).id;
  breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "RC-1", type: ProductType.FINISHED_GOOD, price: 500, unit: Unit.PCS } })).id;
  await startLedger(ledger, org, 2);
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 100 });
});
afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("the split rule", () => {
  it("cancels the debt first and pays back only the rest", () => {
    const sale = { totalAmount: 5000, amountPaid: 2000, creditedAmount: 0 };
    expect(splitSaleReturn(2000, sale)).toEqual({ creditedAmount: 2000, refundedAmount: 0 });
    expect(splitSaleReturn(2000, { ...sale, creditedAmount: 2000 })).toEqual({ creditedAmount: 1000, refundedAmount: 1000 });
    expect(splitSaleReturn(500, { totalAmount: 500, amountPaid: 500, creditedAmount: 0 })).toEqual({ creditedAmount: 0, refundedAmount: 500 });
  });
});

describe("a return against a sale on credit", () => {
  let saleId: string;

  it("cancels what is owed without touching the till", async () => {
    const sale = await sell(10, 2000); // 5 000, 2 000 paid in cash
    saleId = sale.id;
    expect(sale.balanceDue).toBe(3000);
    const before = await till();

    const first = await giveBack(saleId, 4); // 2 000 of goods
    expect(first).toMatchObject({ totalAmount: 2000, creditedAmount: 2000, refundedAmount: 0 });
    expect(await till()).toBe(before);
    expect((await services.sales.findOne(org.user, saleId)).balanceDue).toBe(1000);
    expect(await prisma.cashMovement.count({ where: { saleReturnId: first.id } })).toBe(0);

    // The next 2 000: 1 000 still owed is cancelled, 1 000 goes back in cash.
    const second = await giveBack(saleId, 4);
    expect(second).toMatchObject({ creditedAmount: 1000, refundedAmount: 1000 });
    expect(await till()).toBe(before - 1000);
    const detail = await services.sales.findOne(org.user, saleId);
    expect(detail).toMatchObject({ balanceDue: 0, creditedAmount: 3000, amountPaid: 2000 });

    // Nothing left to pay, and the rest comes back only in money already paid.
    await expect(services.sales.recordPayment(org.user, saleId, { amount: 1 } as never)).rejects.toThrow(/превышает/);
    const third = await giveBack(saleId, 2);
    expect(third).toMatchObject({ creditedAmount: 0, refundedAmount: 1000 });
    expect(await till()).toBe(before - 2000);
  });

  it("a paid retail sale is refunded in money exactly as before", async () => {
    const retail = await sell(2, 0, false);
    const before = await till();
    const ret = await giveBack(retail.id, 1);
    expect(ret).toMatchObject({ creditedAmount: 0, refundedAmount: 500 });
    expect(await till()).toBe(before - 500);
  });

  it("every figure of the debt agrees, the ledger too", async () => {
    // One more sale left partly open: 1 000 on credit, 400 brought back.
    const open = await sell(2, 0);
    await giveBack(open.id, 0.8);

    const card = await customers.findOne(org.organizationId, customerId);
    expect(card.outstandingBalance).toBe(600);
    expect(card.orders.find((o) => o.saleId === saleId)?.balanceDue).toBe(0);
    expect(await services.finance.getAccountsReceivable(org.organizationId)).toBe(600);

    const report = await debts.receivables(org.organizationId);
    expect(report.counterparties.find((c) => c.counterpartyId === customerId)?.outstanding).toBe(600);

    const act = await debts.statement(org.organizationId, DebtCounterpartyKind.CUSTOMER, customerId);
    expect(act.closing).toBe(600);
    // Only money actually paid back appears as «Возврат денег»: 1 000 + 1 000.
    const refunds = act.lines.filter((l) => l.kind === "REFUND_PAID");
    expect(refunds.map((l) => l.debit).sort()).toEqual([1000, 1000]);

    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    expect(await glBalance(ledger, org, K.RECEIVABLES)).toBe(600);
    const diag = await diagnostics.run(org.organizationId);
    expect(diag.checks.filter((c) => c.status !== "PASS")).toEqual([]);
    const consistency = await checkLedgerConsistency(prisma, org.organizationId);
    expect(consistency.cash.drifts).toEqual([]);
  });
});
