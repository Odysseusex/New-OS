import { BusinessDirection, PaymentMethod } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { loadDirectionContext } from "../directions/direction-context";

// ДДС for one account or one point (ТЗ §6.3). Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
let org: IsolatedOrg;
let sys: Record<BusinessDirection, string>;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "cash-flow-scope");
  const breadId = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Батон", sku: "CS-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 10 } as never);
  // 1 000 cash at the shop's till, then 400 of it taken to the bank.
  await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 2, unitPrice: 500 }] } as never);
  await services.cash.transfer(org.user, { fromAccountId: org.cashAccountId, toAccountId: org.bankAccountId, amount: 400, reason: "Инкассация" } as never);
  // A wholesale customer pays 1 500 for three loaves at once; a direct expense of the «Заказы» direction.
  const customerId = (await prisma.customer.create({ data: { organizationId: org.organizationId, name: "Кофейня", creditLimit: 100000 } })).id;
  await services.sales.create(org.user, { locationId: org.storeId, customerId, amountPaid: 1500, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 3, unitPrice: 500 }] } as never);
  sys = (await loadDirectionContext(prisma, org.organizationId)).system;
  await services.finance.createExpense(org.user, { amount: 200, description: "Коробки для тортов", paidImmediately: true, accountId: org.cashAccountId, directionId: sys.ORDERS } as never);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const range = () => [new Date(Date.now() - 3_600_000), new Date(Date.now() + 60_000)] as const;

describe("ДДС by point and by account", () => {
  it("one account: its own flows and transfers, closing = its balance", async () => {
    const [from, to] = range();
    const till = await services.finance.getCashFlow(org.organizationId, from, to, { accountId: org.cashAccountId });
    expect(till.totalInflow).toBe(2500);
    expect(till.internalTransfers.net).toBe(-400);
    expect(till.closingBalance - till.openingBalance).toBe(1900);
    expect(till.reconciliation?.reconciles).toBe(true);
    const bank = await services.finance.getCashFlow(org.organizationId, from, to, { accountId: org.bankAccountId });
    expect(bank.totalInflow).toBe(0);
    expect(bank.internalTransfers.net).toBe(400);
  });

  it("one point: the sale is the shop's; the warehouse has none", async () => {
    const [from, to] = range();
    const shop = await services.finance.getCashFlow(org.organizationId, from, to, { locationId: org.storeId });
    expect(shop.totalInflow).toBe(2500);
    expect(shop.reconciliation).toBeNull();
    const warehouse = await services.finance.getCashFlow(org.organizationId, from, to, { locationId: org.warehouseId });
    expect(warehouse.totalInflow).toBe(0);
    const all = await services.finance.getCashFlow(org.organizationId, from, to);
    expect(all.totalInflow).toBe(2500);
    expect(all.internalTransfers.net).toBe(0);
  });

  it("one direction: retail till sale, wholesale customer sale, the direction's own expense; no transfers", async () => {
    const [from, to] = range();
    const retail = await services.finance.getCashFlow(org.organizationId, from, to, { direction: sys.RETAIL });
    expect(retail.totalInflow).toBe(1000);
    expect(retail.totalOutflow).toBe(0);
    expect(retail.internalTransfers.net).toBe(0);
    expect(retail.reconciliation).toBeNull();
    const wholesale = await services.finance.getCashFlow(org.organizationId, from, to, { direction: sys.WHOLESALE });
    expect(wholesale.totalInflow).toBe(1500);
    const orders = await services.finance.getCashFlow(org.organizationId, from, to, { direction: sys.ORDERS });
    expect(orders.totalInflow).toBe(0);
    expect(orders.totalOutflow).toBe(200);
    const monthly = await services.finance.getCashFlowByDate(org.organizationId, "day", from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), { direction: sys.WHOLESALE });
    expect(monthly).toBeDefined();
  });
});
