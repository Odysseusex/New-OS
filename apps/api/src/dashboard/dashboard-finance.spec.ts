import { PaymentMethod } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { CashAccountsService } from "../finance/cash-accounts.service";
import { DebtsService } from "../debts/debts.service";
import { DashboardFinanceService } from "./dashboard-finance.service";
import { loadDirectionContext } from "../directions/direction-context";

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

  it("limits the sales figures to one direction (ТЗ §8.4), the directions adding up to the whole", async () => {
    const customerId = (await prisma.customer.create({ data: { organizationId: org.organizationId, name: "Оптовик" } })).id;
    await services.sales.create(org.user, { locationId: org.storeId, customerId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 2, unitPrice: 450 }] } as never);
    const ctx = await loadDirectionContext(prisma, org.organizationId);
    const all = await dashboard.figures(org.organizationId);
    const retail = await dashboard.figures(org.organizationId, undefined, new Date(), ctx.system.RETAIL);
    const wholesale = await dashboard.figures(org.organizationId, undefined, new Date(), ctx.system.WHOLESALE);
    expect(retail.directionId).toBe(ctx.system.RETAIL);
    expect(retail.today.netRevenue).toBe(1500);
    expect(wholesale.today.netRevenue).toBe(900);
    const sum = ctx.directions.length;
    let monthTotal = 0;
    for (const d of ctx.directions) monthTotal += (await dashboard.figures(org.organizationId, undefined, new Date(), d.id)).month.netRevenue;
    expect(sum).toBeGreaterThanOrEqual(3);
    expect(Math.round(monthTotal * 100) / 100).toBe(all.month.netRevenue);
    expect(wholesale.topProducts[0]).toMatchObject({ productName: "Батон", quantitySold: 2, revenue: 900 });
    expect(retail.topProducts[0]).toMatchObject({ productName: "Батон", quantitySold: 3, revenue: 1500 });
    // The profitability report (ТЗ §8.1) cut by direction reads the same sales.
    const dayStart = new Date(Date.now() - 86_400_000);
    const prof = await services.sales.productProfitability(org.user, dayStart, new Date(), undefined, ctx.system.WHOLESALE);
    expect(prof.rows).toHaveLength(1);
    expect(prof.rows[0]).toMatchObject({ productName: "Батон", quantity: 2, revenue: 900 });
    const profAll = await services.sales.productProfitability(org.user, dayStart, new Date());
    expect(profAll.rows[0]).toMatchObject({ quantity: 5, revenue: 2400 });
    // Money, debts and the shelf are not a direction's: unchanged.
    expect(retail.finishedGoods).toEqual(all.finishedGoods);
    expect(retail.cashTotal).toBe(all.cashTotal);
  });
});
