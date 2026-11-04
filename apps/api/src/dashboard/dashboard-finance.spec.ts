import { PaymentMethod } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { CashAccountsService } from "../finance/cash-accounts.service";
import { DebtsService } from "../debts/debts.service";
import { DashboardFinanceService } from "./dashboard-finance.service";

// The dashboard's money block reads each figure from its own report, so it
// must equal them. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const dashboard = new DashboardFinanceService(prisma, services.finance, new CashAccountsService(prisma), new DebtsService(prisma), services.costing);
let org: IsolatedOrg;
let breadId: string;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "dashboard-finance");
  breadId = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Батон", sku: "DF-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 10 } as never);
  await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 3, unitPrice: 500 }] } as never);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("dashboard money block", () => {
  it("equals the P&L, the shelf and the top products", async () => {
    const d = await dashboard.figures(org.organizationId);
    expect(d.today.netRevenue).toBe(1500);
    expect(d.month.netRevenue).toBeGreaterThanOrEqual(1500);
    expect(d.topProducts[0]).toMatchObject({ productName: "Батон", quantitySold: 3, revenue: 1500 });
    // 7 loaves left on the shop's shelf at 500.
    expect(d.finishedGoods.atSalePrice).toBe(3500);
    const store = await dashboard.figures(org.organizationId, org.storeId);
    expect(store.today.netRevenue).toBe(1500);
    const warehouse = await dashboard.figures(org.organizationId, org.warehouseId);
    expect(warehouse.today.netRevenue).toBe(0);
    expect(warehouse.finishedGoods.atSalePrice).toBe(0);
    expect(d.cashTotal).toBe(d.cashAccounts.reduce((s, a) => s + a.balance, 0));
  });
});
